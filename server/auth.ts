import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { config } from './config';
import { consultarUm, executar, comServidor, servidorAtual, verificarBmapi, BmapiError } from './bmapi';
import { buscarServidor, Servidor } from './servidores';

/**
 * Autenticação do EstoqueWEB.
 *
 * O login é o mesmo do app Delphi: e-mail + senha da tabela WEB_USUARIOS (a senha
 * fica em texto puro, num campo de 15 caracteres, e continua assim para que o app
 * Delphi e o EstoqueWEB possam conviver na mesma base).
 *
 * Diferente do b2b admin (que confia no id enviado no header), aqui a sessão é um
 * token assinado com HMAC: o usuário é sempre relido da base pelo id do token, então
 * trocar o nível ou apagar o usuário vale na próxima requisição (após o cache curto).
 */

/** Níveis do WEB_USUARIOS.NIVEL; o Delphi considerava só a primeira letra */
export type Nivel = 'A' | 'G' | 'S' | 'V' | 'C';

export interface UsuarioSessao {
  id: number;
  idPessoa: number;
  idEmpresa: number;
  nome: string;
  email: string;
  nomePessoa: string;
  nivel: Nivel;
  nivelDescricao: string;
  listaPreco: string;
  paginaInicial: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioSessao;
    }
  }
}

const VALIDADE_MS = 1000 * 60 * 60 * 12; // 12 horas

const NIVEL_DESCRICAO: Record<Nivel, string> = {
  A: 'Administrador',
  G: 'Gerente',
  S: 'Supervisor',
  V: 'Vendedor',
  C: 'Consulta',
};

export function nivelAdministrador(u: UsuarioSessao) {
  return u.nivel === 'A';
}
export function nivelGerente(u: UsuarioSessao) {
  return u.nivel === 'A' || u.nivel === 'G';
}
export function nivelSupervisor(u: UsuarioSessao) {
  return u.nivel === 'A' || u.nivel === 'G' || u.nivel === 'S';
}

function segredo(): string {
  if (!config.sessionSecret) {
    throw new BmapiError('SESSION_SECRET não configurado no .env do EstoqueWEB.', 500);
  }
  return config.sessionSecret;
}

function assinar(conteudo: string): string {
  return crypto.createHmac('sha256', segredo()).update(conteudo).digest('base64url');
}

/** O token leva o usuário e o número do servidor da bmAPI escolhido no login */
export function criarToken(idUsuario: number, numeroServidor: number): string {
  const corpo = Buffer.from(
    JSON.stringify({ uid: idUsuario, srv: numeroServidor, exp: Date.now() + VALIDADE_MS }),
  ).toString('base64url');
  return `${corpo}.${assinar(corpo)}`;
}

function lerToken(token: string): { uid: number; srv: number } | null {
  const [corpo, assinatura] = String(token || '').split('.');
  if (!corpo || !assinatura) return null;
  const esperada = assinar(corpo);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (!dados?.uid || !dados?.srv || Number(dados.exp) < Date.now()) return null;
    return { uid: Number(dados.uid), srv: Number(dados.srv) };
  } catch {
    return null;
  }
}

const SQL_USUARIO = `
  SELECT A.ID id, A.ID_BM id_bm, A.ID_EMPRESA id_empresa, A.ID_PESSOA id_pessoa,
         A.LISTA_PRECO lista_preco, A.NOME_USUARIO nome_usuario, A.EMAIL email,
         A.SENHA senha, A.NIVEL nivel, A.PAGINA_INICIAL pagina_inicial, P.NOME nome_pessoa
    FROM WEB_USUARIOS A
    LEFT JOIN PESSOAS P ON P.ID = A.ID_PESSOA`;

function montarUsuario(row: Record<string, any>): UsuarioSessao {
  const letra = String(row.nivel || 'C').trim().charAt(0).toUpperCase();
  const nivel = (['A', 'G', 'S', 'V', 'C'].includes(letra) ? letra : 'C') as Nivel;
  return {
    id: Number(row.id),
    idPessoa: Number(row.id_pessoa || 0),
    idEmpresa: Number(row.id_empresa || config.idEmpresa),
    nome: String(row.nome_usuario || '').trim(),
    email: String(row.email || '').trim(),
    nomePessoa: String(row.nome_pessoa || '').trim(),
    nivel,
    nivelDescricao: NIVEL_DESCRICAO[nivel],
    listaPreco: String(row.lista_preco || '1').trim() === '2' ? '2' : '1',
    paginaInicial: String(row.pagina_inicial || '').trim(),
  };
}

// Cache curto do usuário, por servidor + id, para não reler WEB_USUARIOS a cada requisição
const cacheUsuarios = new Map<string, { usuario: UsuarioSessao | null; ate: number }>();
const CACHE_MS = 30_000;

const chaveCache = (id: number) => `${servidorAtual().numero}:${id}`;

/** Invalida o usuário no servidor da requisição atual */
export function invalidarCacheUsuario(id: number) {
  cacheUsuarios.delete(chaveCache(id));
}

async function carregarUsuario(id: number): Promise<UsuarioSessao | null> {
  const emCache = cacheUsuarios.get(chaveCache(id));
  if (emCache && emCache.ate > Date.now()) return emCache.usuario;
  const row = await consultarUm(`${SQL_USUARIO} WHERE A.ID = :id`, { id });
  const usuario = row ? montarUsuario(row) : null;
  cacheUsuarios.set(chaveCache(id), { usuario, ate: Date.now() + CACHE_MS });
  return usuario;
}

function numeroServidor(valor: unknown): number {
  const n = Number(String(valor ?? '').trim());
  if (!Number.isInteger(n) || n < 1 || n > 999) {
    throw new BmapiError('Informe o número do servidor (1 a 999).');
  }
  return n;
}

async function resolverServidor(numero: number): Promise<Servidor> {
  let servidor: Servidor | null;
  try {
    servidor = await buscarServidor(numero);
  } catch (err: any) {
    throw new BmapiError(`Não foi possível consultar o cadastro de servidores (${err.code || err.message}).`, 503);
  }
  if (!servidor) throw new BmapiError(`Servidor ${numero} não encontrado.`, 404);
  return servidor;
}

export function dadosPublicosServidor(s: Servidor) {
  return { numero: s.numero, identificacao: s.identificacao };
}

/**
 * Exige sessão válida: fixa o servidor da bmAPI do token para o resto da
 * requisição e preenche req.usuario.
 */
export async function exigirSessao(req: Request, res: Response, next: NextFunction) {
  try {
    const bruto = req.header('authorization') || '';
    const token = bruto.startsWith('Bearer ') ? bruto.slice(7) : '';
    const dados = lerToken(token);
    if (!dados) {
      return res.status(401).json({ error: 'Sessão expirada ou inválida. Entre novamente.' });
    }

    let servidor: Servidor;
    try {
      servidor = await resolverServidor(dados.srv);
    } catch (err: any) {
      // Servidor removido do cadastro invalida a sessão; falha no MySQL não
      return res.status(err.status === 404 ? 401 : err.status || 503).json({ error: err.message });
    }

    comServidor(servidor, async () => {
      try {
        const usuario = await carregarUsuario(dados.uid);
        if (!usuario) {
          return res.status(401).json({ error: 'Usuário não encontrado. Entre novamente.' });
        }
        req.usuario = usuario;
        next();
      } catch (err: any) {
        res.status(err?.status || 500).json({ error: err.message });
      }
    });
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err.message });
  }
}

export function exigirNivel(teste: (u: UsuarioSessao) => boolean, descricao: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario || !teste(req.usuario)) {
      return res.status(403).json({ error: `Acesso restrito a ${descricao}.` });
    }
    next();
  };
}

export async function registrarLog(usuario: string, mensagem: string) {
  await executar('INSERT INTO WEB_LOG (DATAHORA, USUARIO, MENSAGEM) VALUES (CURRENT_TIMESTAMP, :u, :m)', {
    u: String(usuario).slice(0, 50),
    m: String(mensagem).slice(0, 50),
  }).catch((err) => console.warn('Falha ao gravar WEB_LOG:', err.message));
}

async function dadosEmpresa() {
  const e = await consultarUm(
    'SELECT ID id, NOMECONTRIBUINTE nome, FANTASIA fantasia, APELIDO apelido, CGCMF cnpj, MUNICIPIO cidade, UF uf FROM EMPRESAS WHERE ID = :id',
    { id: config.idEmpresa },
  );
  return {
    id: config.idEmpresa,
    nome: String(e?.nome || '').trim(),
    fantasia: String(e?.fantasia || '').trim(),
    // O Delphi exibia o APELIDO como nome comercial
    apelido: String(e?.apelido || e?.fantasia || e?.nome || 'EstoqueWEB').trim(),
    cnpj: String(e?.cnpj || '').trim(),
    cidade: String(e?.cidade || '').trim(),
    uf: String(e?.uf || '').trim(),
  };
}

export function createAuthRouter() {
  const router = Router();

  /**
   * Identificação do servidor digitado no login (público): nome e se a bmAPI
   * responde. URL, porta e token não saem do servidor.
   */
  router.get('/servidores/:numero', async (req: Request, res: Response) => {
    try {
      const servidor = await resolverServidor(numeroServidor(req.params.numero));
      const status = await comServidor(servidor, () => verificarBmapi());
      res.json({ ...dadosPublicosServidor(servidor), connected: status.connected, error: status.error });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  router.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const numero = numeroServidor(req.body?.servidor);
      const email = String(req.body?.email || '').trim();
      const senha = String(req.body?.senha ?? '');
      if (!email || !senha) {
        return res.status(400).json({ error: 'Informe o e-mail e a senha.' });
      }

      const servidor = await resolverServidor(numero);

      await comServidor(servidor, async () => {
        // E-mail sem diferenciar maiúsculas; senha exata, como no Delphi
        const row = await consultarUm(`${SQL_USUARIO} WHERE UPPER(A.EMAIL) = :email AND A.SENHA = :senha`, {
          email: email.toUpperCase(),
          senha,
        }).catch((err) => {
          // Tabela ou coluna inexistente: a base não tem a estrutura do EstoqueWEB
          if (/#\s*(11949|11010)/.test(err.message)) {
            throw new BmapiError(
              `A base do servidor ${servidor.numero} (${servidor.identificacao}) não tem as tabelas do EstoqueWEB (WEB_USUARIOS). Detalhe: ${err.message}`,
            );
          }
          throw err;
        });
        if (!row) {
          return res.status(401).json({ error: 'Usuário/senha inválido(s).' });
        }

        const usuario = montarUsuario(row);
        cacheUsuarios.set(chaveCache(usuario.id), { usuario, ate: Date.now() + CACHE_MS });
        await registrarLog(usuario.email, 'ENTRADA NO SISTEMA');

        res.json({
          token: criarToken(usuario.id, servidor.numero),
          usuario,
          empresa: await dadosEmpresa(),
          servidor: dadosPublicosServidor(servidor),
        });
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  /** Revalida a sessão guardada no navegador e devolve os dados atualizados */
  router.get('/auth/sessao', exigirSessao, async (req: Request, res: Response) => {
    try {
      res.json({
        usuario: req.usuario,
        empresa: await dadosEmpresa(),
        servidor: dadosPublicosServidor(servidorAtual()),
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  /** Meus dados: e-mail, página inicial e senha do próprio usuário (frmUsuariosDados) */
  router.put('/auth/meus-dados', exigirSessao, async (req: Request, res: Response) => {
    try {
      const u = req.usuario!;
      const email = String(req.body?.email || '').trim();
      const paginaInicial = String(req.body?.paginaInicial || '').trim();
      const senha = String(req.body?.senha ?? '');
      const senhaConfirma = String(req.body?.senhaConfirma ?? '');

      if (!email) return res.status(400).json({ error: 'Informe o e-mail de acesso.' });
      if (email.length > 80) return res.status(400).json({ error: 'O e-mail pode ter no máximo 80 caracteres.' });
      if (paginaInicial.length > 80) {
        return res.status(400).json({ error: 'A página inicial pode ter no máximo 80 caracteres.' });
      }
      if (senha !== '' && senha !== senhaConfirma) {
        return res.status(400).json({ error: 'As senhas não conferem.' });
      }
      if (senha.length > 15) return res.status(400).json({ error: 'A senha pode ter no máximo 15 caracteres.' });

      const outro = await consultarUm('SELECT ID id FROM WEB_USUARIOS WHERE UPPER(EMAIL) = :email AND ID <> :id', {
        email: email.toUpperCase(),
        id: u.id,
      });
      if (outro) return res.status(400).json({ error: 'Este e-mail já é usado por outro usuário.' });

      if (senha !== '') {
        await executar('UPDATE WEB_USUARIOS SET EMAIL = :email, PAGINA_INICIAL = :hp, SENHA = :senha WHERE ID = :id', {
          email,
          hp: paginaInicial,
          senha,
          id: u.id,
        });
      } else {
        await executar('UPDATE WEB_USUARIOS SET EMAIL = :email, PAGINA_INICIAL = :hp WHERE ID = :id', {
          email,
          hp: paginaInicial,
          id: u.id,
        });
      }

      invalidarCacheUsuario(u.id);
      const atualizado = await carregarUsuario(u.id);
      res.json({ success: true, usuario: atualizado });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  return router;
}
