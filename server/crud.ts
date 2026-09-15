import { Router, Request, Response } from 'express';
import { config } from './config.js';
import { consultar, consultarUm, executar, BmapiError } from './bmapi.js';
import { invalidarCacheUsuario, nivelAdministrador, nivelGerente, UsuarioSessao } from './auth.js';
import { RESOURCES, FieldDef, ResourceDef, getResource, fieldExpr, writableFields } from './schema.js';

/**
 * CRUD genérico dirigido pelo registro de metadados (server/schema.ts), no mesmo
 * padrão do b2b admin. Nenhum nome de coluna vem do cliente HTTP: tudo passa pela
 * whitelist do schema e os valores vão como parâmetros nomeados da bmAPI.
 */

function podeAcessar(resource: ResourceDef, u: UsuarioSessao): boolean {
  return resource.nivel === 'A' ? nivelAdministrador(u) : nivelGerente(u);
}

/** Converte o valor recebido do formulário para o tipo da coluna */
function coerceValue(field: FieldDef, raw: any): any {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') {
    return field.required && (field.type === 'text' || field.type === 'enum') ? '' : null;
  }
  switch (field.type) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case 'decimal': {
      const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return raw === true || raw === 1 || raw === '1' || raw === 'true';
    case 'date':
      return String(raw).slice(0, 10);
    case 'datetime':
      return String(raw).replace('T', ' ').slice(0, 19);
    default: {
      const s = String(raw);
      return field.maxLength ? s.slice(0, field.maxLength) : s;
    }
  }
}

function buildWritePayload(resource: ResourceDef, body: Record<string, any>, isUpdate: boolean) {
  const payload: Record<string, any> = {};
  for (const field of writableFields(resource)) {
    if (!(field.name in body)) continue;
    if (field.type === 'password') {
      const plain = String(body[field.name] ?? '');
      // Em branco na alteração mantém a senha atual
      if (plain === '') {
        if (!isUpdate) payload[field.name] = '';
        continue;
      }
      if (field.maxLength && plain.length > field.maxLength) {
        throw new BmapiError(`O campo "${field.label}" aceita no máximo ${field.maxLength} caracteres.`);
      }
      payload[field.name] = plain;
      continue;
    }
    payload[field.name] = coerceValue(field, body[field.name]);
  }
  return payload;
}

function validateRequired(resource: ResourceDef, payload: Record<string, any>, isUpdate: boolean) {
  const faltando: string[] = [];
  for (const field of writableFields(resource)) {
    if (!field.required || field.type === 'password') continue;
    if (isUpdate && !(field.name in payload)) continue;
    const v = payload[field.name];
    if (v === null || v === undefined || v === '') faltando.push(field.label);
  }
  if (faltando.length) throw new BmapiError(`Preencha os campos obrigatórios: ${faltando.join(', ')}.`);
}

/** Regras de negócio por recurso, aplicadas antes de gravar */
async function aplicarRegras(resource: ResourceDef, payload: Record<string, any>, id: number | null) {
  if (resource.name !== 'usuarios') return;

  // tbUsuariosBeforePost: lista tem que ser 1 ou 2
  if ('lista_preco' in payload && !['1', '2'].includes(String(payload.lista_preco))) {
    throw new BmapiError('Lista de preço tem que ser "1" ou "2".');
  }

  if ('email' in payload) {
    payload.email = String(payload.email || '').trim();
    const outro = await consultarUm(
      'SELECT ID id FROM WEB_USUARIOS WHERE UPPER(EMAIL) = :e AND ID <> :id',
      { e: payload.email.toUpperCase(), id: id ?? -1 },
    );
    if (outro) throw new BmapiError('Já existe um usuário com este e-mail.');
  }

  if (id === null) {
    // tbUsuariosNewRecord
    if (payload.id_empresa === undefined || payload.id_empresa === null) payload.id_empresa = config.idEmpresa;
    if (payload.id_bm === undefined || payload.id_bm === null) payload.id_bm = 1;
    if (payload.id_pessoa === undefined || payload.id_pessoa === null) payload.id_pessoa = 0;
    if (!payload.senha) throw new BmapiError('Defina a senha inicial do usuário.');
  }
}

function mapRow(resource: ResourceDef, row: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of resource.fields) {
    const v = row[f.name];
    out[f.name] = typeof v === 'string' ? v.trim() : v;
    if (f.type === 'password') out[f.name] = null; // senha nunca vai para o navegador
  }
  return out;
}

function selectList(resource: ResourceDef) {
  return resource.fields.map((f) => `${fieldExpr(f)} ${f.name}`).join(', ');
}

export function createCrudRouter() {
  const router = Router();

  function resolveResource(req: Request): ResourceDef {
    const resource = getResource(req.params.resource);
    if (!resource) throw new BmapiError(`Recurso "${req.params.resource}" não existe.`, 404);
    if (!podeAcessar(resource, req.usuario!)) throw new BmapiError(`Acesso restrito a ${resource.label}.`, 403);
    return resource;
  }

  function erro(res: Response, err: any) {
    res.status(err?.status || 400).json({ error: err?.message || 'Erro inesperado.' });
  }

  router.get('/meta/resources', (req: Request, res: Response) => {
    res.json(RESOURCES.filter((r) => podeAcessar(r, req.usuario!)));
  });

  router.get('/crud/:resource', async (req: Request, res: Response) => {
    try {
      const resource = resolveResource(req);
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));

      const sortField = resource.fields.find((f) => f.name === String(req.query.sort)) ||
        resource.fields.find((f) => f.name === resource.defaultSort.field)!;
      const dirParam = String(req.query.dir || '').toLowerCase();
      const dir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : resource.defaultSort.dir;

      const where: string[] = ['1 = 1'];
      const params: Record<string, any> = {};
      let n = 0;
      const param = (v: any) => {
        const nome = `p${++n}`;
        params[nome] = v;
        return `:${nome}`;
      };

      const search = String(req.query.search || '').trim();
      if (search) {
        const searchable = resource.fields.filter((f) => f.searchable);
        if (searchable.length) {
          where.push(
            `(${searchable.map((f) => `UPPER(${fieldExpr(f)}) LIKE ${param(`%${search.toUpperCase()}%`)}`).join(' OR ')})`,
          );
        }
      }

      const filtersRaw = String(req.query.filters || '').trim();
      if (filtersRaw) {
        let parsed: any[];
        try {
          parsed = JSON.parse(filtersRaw);
        } catch {
          throw new BmapiError('Parâmetro "filters" não contém um JSON válido.');
        }
        if (!Array.isArray(parsed) || parsed.length > 20) throw new BmapiError('Filtros inválidos.');

        for (const f of parsed) {
          const field = resource.fields.find((x) => x.name === String(f?.field || ''));
          if (!field) throw new BmapiError(`Filtro inválido: o campo "${f?.field}" não existe.`);
          const valor = f?.value;
          if (valor === undefined || valor === null || valor === '') continue;
          const expr = fieldExpr(field);
          const v = field.type === 'boolean' ? String(valor) === '1' : coerceValue(field, valor);

          switch (String(f?.op)) {
            case 'contains':
              where.push(`UPPER(${expr}) LIKE ${param(`%${String(valor).toUpperCase()}%`)}`);
              break;
            case 'eq':
              where.push(`${expr} = ${param(v)}`);
              break;
            case 'ne':
              where.push(`${expr} <> ${param(v)}`);
              break;
            case 'gte':
              where.push(`${expr} >= ${param(v)}`);
              break;
            case 'lte':
              // Data até: inclui o dia inteiro nos campos de data e hora
              where.push(`${expr} <= ${param(field.type === 'datetime' ? `${String(valor).slice(0, 10)} 23:59:59` : v)}`);
              break;
            default:
              throw new BmapiError(`Filtro inválido: operador "${f?.op}" não é suportado.`);
          }
        }
      }

      const from = `FROM ${resource.table} t ${resource.joins || ''} WHERE ${where.join(' AND ')}`;
      const contagem = await consultarUm(`SELECT COUNT(*) total ${from}`, params);
      const total = Number(contagem?.total || 0);

      // Sem OFFSET no DBISAM: busca até o fim da página e descarta o início
      const rows = await consultar(
        `SELECT ${selectList(resource)} ${from} ORDER BY ${fieldExpr(sortField)} ${dir.toUpperCase()} TOP ${page * limit}`,
        params,
      );

      res.json({
        data: rows.slice((page - 1) * limit).map((r) => mapRow(resource, r)),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (err) {
      erro(res, err);
    }
  });

  router.get('/crud/:resource/:id', async (req: Request, res: Response) => {
    try {
      const resource = resolveResource(req);
      const pkField = resource.fields.find((f) => f.name === resource.pk)!;
      const row = await consultarUm(
        `SELECT ${selectList(resource)} FROM ${resource.table} t ${resource.joins || ''} WHERE ${fieldExpr(pkField)} = :id`,
        { id: Number(req.params.id) },
      );
      if (!row) return res.status(404).json({ error: `${resource.labelSingular} não encontrado.` });
      res.json(mapRow(resource, row));
    } catch (err) {
      erro(res, err);
    }
  });

  router.post('/crud/:resource', async (req: Request, res: Response) => {
    try {
      const resource = resolveResource(req);
      if (!resource.canCreate) throw new BmapiError(`Não é permitido incluir registros em ${resource.label}.`, 403);

      const payload = buildWritePayload(resource, req.body || {}, false);
      validateRequired(resource, payload, false);
      await aplicarRegras(resource, payload, null);

      const fields = writableFields(resource).filter((f) => f.name in payload);
      if (!fields.length) throw new BmapiError('Nenhum campo foi informado para gravação.');

      const params: Record<string, any> = {};
      fields.forEach((f, i) => (params[`p${i + 1}`] = payload[f.name]));
      await executar(
        `INSERT INTO ${resource.table} (${fields.map((f) => f.column).join(', ')})
         VALUES (${fields.map((_, i) => `:p${i + 1}`).join(', ')})`,
        params,
      );
      res.json({ success: true });
    } catch (err) {
      erro(res, err);
    }
  });

  router.put('/crud/:resource/:id', async (req: Request, res: Response) => {
    try {
      const resource = resolveResource(req);
      if (!resource.canUpdate) throw new BmapiError(`Não é permitido alterar registros em ${resource.label}.`, 403);

      const id = Number(req.params.id);
      const payload = buildWritePayload(resource, req.body || {}, true);
      validateRequired(resource, payload, true);
      await aplicarRegras(resource, payload, id);

      const fields = writableFields(resource).filter((f) => f.name in payload);
      if (!fields.length) throw new BmapiError('Nenhuma alteração foi informada.');

      const params: Record<string, any> = { id };
      fields.forEach((f, i) => (params[`p${i + 1}`] = payload[f.name]));
      const pkColumn = resource.fields.find((f) => f.name === resource.pk)!.column;
      const afetados = await executar(
        `UPDATE ${resource.table} SET ${fields.map((f, i) => `${f.column} = :p${i + 1}`).join(', ')} WHERE ${pkColumn} = :id`,
        params,
      );
      if (afetados === 0) return res.status(404).json({ error: `${resource.labelSingular} não encontrado.` });

      if (resource.name === 'usuarios') invalidarCacheUsuario(id);
      res.json({ success: true });
    } catch (err) {
      erro(res, err);
    }
  });

  router.delete('/crud/:resource/:id', async (req: Request, res: Response) => {
    try {
      const resource = resolveResource(req);
      if (!resource.canDelete) throw new BmapiError(`Não é permitido excluir registros em ${resource.label}.`, 403);

      const id = Number(req.params.id);
      if (resource.name === 'usuarios' && id === req.usuario!.id) {
        throw new BmapiError('Você não pode excluir o próprio usuário.');
      }

      const pkColumn = resource.fields.find((f) => f.name === resource.pk)!.column;
      const afetados = await executar(`DELETE FROM ${resource.table} WHERE ${pkColumn} = :id`, { id });
      if (afetados === 0) return res.status(404).json({ error: `${resource.labelSingular} não encontrado.` });

      if (resource.name === 'usuarios') invalidarCacheUsuario(id);
      res.json({ success: true });
    } catch (err) {
      erro(res, err);
    }
  });

  // --------------------------------------------------------
  // Planos liberados por loja (frmUsuariosPlanos)
  // WEB_USUARIOS_PLANOS.ID_USUARIO guarda o ID_PESSOA da loja.
  // --------------------------------------------------------
  router.get('/lojas/:idPessoa/planos', async (req: Request, res: Response) => {
    try {
      if (!nivelAdministrador(req.usuario!)) throw new BmapiError('Acesso restrito a administradores.', 403);
      const idPessoa = Math.trunc(Number(req.params.idPessoa));
      const planos = await consultar(
        'SELECT ID id, DESCRICAO descricao, APELIDO apelido, NUMEROPARCELAS parcelas, JUROS juros, ATIVO ativo FROM PLANOS ORDER BY DESCRICAO',
      );
      const liberados = await consultar(
        'SELECT ID_PLANO id_plano, STATUS status FROM WEB_USUARIOS_PLANOS WHERE ID_USUARIO = :p',
        { p: idPessoa },
      );
      const status = new Map(liberados.map((l) => [Number(l.id_plano), String(l.status ?? '').trim()]));
      res.json(
        planos.map((p) => ({
          id: Number(p.id),
          descricao: String(p.descricao ?? '').trim(),
          apelido: String(p.apelido ?? '').trim(),
          parcelas: Number(p.parcelas || 0),
          juros: Number(p.juros || 0),
          ativo: Boolean(p.ativo),
          liberado: status.get(Number(p.id)) === 'S',
        })),
      );
    } catch (err) {
      erro(res, err);
    }
  });

  router.put('/lojas/:idPessoa/planos/:idPlano', async (req: Request, res: Response) => {
    try {
      if (!nivelAdministrador(req.usuario!)) throw new BmapiError('Acesso restrito a administradores.', 403);
      const idPessoa = Math.trunc(Number(req.params.idPessoa));
      const idPlano = Math.trunc(Number(req.params.idPlano));
      const status = req.body?.liberado ? 'S' : '';

      const afetados = await executar(
        'UPDATE WEB_USUARIOS_PLANOS SET STATUS = :s WHERE ID_USUARIO = :p AND ID_PLANO = :pl',
        { s: status, p: idPessoa, pl: idPlano },
      );
      if (afetados === 0) {
        await executar('INSERT INTO WEB_USUARIOS_PLANOS (ID_USUARIO, ID_PLANO, STATUS) VALUES (:p, :pl, :s)', {
          p: idPessoa,
          pl: idPlano,
          s: status,
        });
      }
      res.json({ success: true });
    } catch (err) {
      erro(res, err);
    }
  });

  /** Nome da loja pelo ID_PESSOA, para conferência no formulário de usuário */
  router.get('/pessoas/:id', async (req: Request, res: Response) => {
    try {
      if (!nivelAdministrador(req.usuario!)) throw new BmapiError('Acesso restrito a administradores.', 403);
      const row = await consultarUm(
        'SELECT ID id, NOME nome, FANTASIA fantasia, CPFCNPJ cpfcnpj, CIDADE cidade, UF uf FROM PESSOAS WHERE ID = :id',
        { id: Math.trunc(Number(req.params.id)) },
      );
      if (!row) return res.status(404).json({ error: 'Pessoa não encontrada.' });
      res.json(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])));
    } catch (err) {
      erro(res, err);
    }
  });

  return router;
}
