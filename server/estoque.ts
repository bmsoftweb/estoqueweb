import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import {
  consultar,
  consultarComLimite,
  consultarUm,
  executar,
  sqlInteiro,
  sqlListaInteiros,
  sqlTexto,
  tabelaMemoria,
  baixarBlob,
  BmapiError,
} from './bmapi.js';
import { exigirNivel, nivelAdministrador, nivelSupervisor, UsuarioSessao } from './auth.js';
import {
  ajustarReserva,
  baseTemInfoComplementar,
  disponivelReferencia,
  recalcularReservas,
} from './estoqueComum.js';

/** Máximo de linhas da pesquisa (a bmAPI também corta em maxRows) */
const LIMITE_PESQUISA = 500;

/** Intervalo mínimo entre recálculos disparados pela abertura da tela */
const RECALCULO_AO_ABRIR_MS = 60_000;

function erro(res: Response, err: any) {
  res.status(err?.status || 400).json({ error: err?.message || 'Erro inesperado.' });
}

/** Log de reservas em arquivo, como o estoqueWeb.log do Delphi */
function gravarLogArquivo(linha: string) {
  try {
    const dir = path.join(process.cwd(), 'log');
    fs.mkdirSync(dir, { recursive: true });
    const agora = new Date().toLocaleString('pt-BR');
    fs.appendFileSync(path.join(dir, 'estoqueWeb.log'), `${agora} - ${linha}\n`, 'utf8');
  } catch {
    // o log é auxiliar; falha de disco não interrompe a operação
  }
}

/**
 * Pesquisa de produtos (frmPesquisa / sqlPesquisaProdutos).
 *
 * Prefixos do texto, como no Delphi:
 *   ".CLASSE"    produtos da classe (começa com)
 *   "+APLICAÇÃO" produtos pela aplicação
 *   "*"          somente os produtos com pré-pedido
 *   número       também encontra pelo ID do produto
 */
export type FiltroEstoque = 'com' | 'sem' | 'todos' | 'pre';

const DISPONIVEL_SQL = 'COALESCE(C.ESTOQUE,0) - COALESCE(C.RESV_DAV,0) - COALESCE(C.RESV_EF,0)';

/**
 * Filtro de estoque (combo filtroEstoque do Delphi). Lá o filtro era aplicado na
 * grade; aqui vai para o SQL, para que o limite de linhas não esconda produtos.
 */
function sqlFiltroEstoque(filtro: FiltroEstoque): string {
  switch (filtro) {
    case 'todos':
    case 'pre': // resolvido por filtroPorIds em pesquisarProdutos
      return 'TRUE';
    case 'sem':
      return `${DISPONIVEL_SQL} <= 0`;
    default:
      return `${DISPONIVEL_SQL} > 0`;
  }
}

/**
 * Condições sobre as tabelas do JOIN (referência, estoque, pré-pedido) fazem o DBISAM
 * varrer todos os produtos (~1,5 s). Buscar antes os IDs numa consulta simples e filtrar
 * por A.ID usa o índice (~0,1–0,3 s). Devolve null se passar do limite (fica o filtro no SQL).
 */
async function filtroPorIds(sql: string, limite = 3000): Promise<string | null> {
  const rows = await consultar(`${sql} TOP ${limite + 1}`);
  if (rows.length > limite) return null;
  return rows.length ? `A.ID IN (${sqlListaInteiros(rows.map((r) => Number(r.id)))})` : 'FALSE';
}

async function pesquisarProdutos(
  usuario: UsuarioSessao,
  texto: string,
  somentePromocao: boolean,
  filtroEstoque: FiltroEstoque,
) {
  let p = texto.trim().toUpperCase();
  let filtroExtra = 'TRUE';

  if (p.startsWith('.')) {
    filtroExtra = `UPPER(A.CLASSE) LIKE ${sqlTexto(`${p.slice(1)}%`)}`;
    p = '';
  } else if (p.startsWith('+')) {
    filtroExtra = `A.APLICACAO <> '' AND UPPER(A.APLICACAO) LIKE ${sqlTexto(`${p.slice(1)}%`)}`;
    p = '';
  } else if (p.startsWith('*')) {
    filtroExtra =
      (await filtroPorIds(
        `SELECT B.ID_PRODUTO id FROM WEB_PEDIDOS_PRO_PREPARA D JOIN PRODUTOSREFERENCIA B ON B.ID = D.ID_REF
          WHERE D.ID_USUARIO = ${sqlInteiro(usuario.id)} AND D.QTDADE > 0`,
      )) ?? 'COALESCE(D.QTDADE,0) > 0';
    p = '';
  }

  const idProduto = /^\d{1,9}$/.test(p) ? Number(p) : 0;
  const padrao = sqlTexto(`${p}%`);
  const colunaPreco = usuario.listaPreco === '2' ? 'PRECOVENDA2' : 'PRECOVENDA1';
  const filtroPromocao = somentePromocao
    ? 'IF(CURRENT_DATE BETWEEN A.PROMOCAO_DATA_INI AND A.PROMOCAO_DATA_FIM, COALESCE(A.PRECO_PROMOCAO,0), 0) > 0'
    : 'TRUE';

  const infoComplementar = await baseTemInfoComplementar();

  const filtroReferencia = p
    ? (await filtroPorIds(`SELECT ID_PRODUTO id FROM PRODUTOSREFERENCIA WHERE UPPER(REFERENCIA) LIKE ${padrao}`)) ??
      `UPPER(B.REFERENCIA) LIKE ${padrao}`
    : 'FALSE';

  // Sem texto, o que limita a pesquisa é o estoque: pré-busca os produtos pelo filtro
  let filtroIdsEstoque: string | null = null;
  if (filtroEstoque === 'pre') {
    filtroIdsEstoque =
      (await filtroPorIds(
        'SELECT B.ID_PRODUTO id FROM WEB_PEDIDOS_PRO_PREPARA D JOIN PRODUTOSREFERENCIA B ON B.ID = D.ID_REF WHERE D.QTDADE > 0',
      )) ?? 'B.ID IN (SELECT ID_REF FROM WEB_PEDIDOS_PRO_PREPARA WHERE QTDADE > 0)';
  } else if (filtroEstoque === 'com' && !p) {
    filtroIdsEstoque = await filtroPorIds(
      `SELECT B.ID_PRODUTO id FROM PRODUTOSREFEMPRESA C JOIN PRODUTOSREFERENCIA B ON B.ID = C.ID_REF
        WHERE C.ID_EMPRESA = ${sqlInteiro(config.idEmpresa)} AND ${DISPONIVEL_SQL} > 0`,
    );
  }

  const sql = `
    SELECT CAST(X.CLASSE AS VARCHAR(10)) classe,
           CAST(X.DESCRICAO AS VARCHAR(30)) descricao_classe,
           A.ID id,
           B.ID id_ref,
           B.REFERENCIA referencia,
           A.DESCRICAO descricao,
           CAST(A.APLICACAO AS VARCHAR(40)) aplicacao,
           ${infoComplementar ? 'CAST(PP.INFO_COMPLEMENTAR AS VARCHAR(20))' : "CAST('' AS VARCHAR(1))"} info,
           A.MARCA marca,
           A.${colunaPreco} preco_venda,
           IF(CURRENT_DATE BETWEEN A.PROMOCAO_DATA_INI AND A.PROMOCAO_DATA_FIM, COALESCE(A.PRECO_PROMOCAO,0), 0.00) promocao,
           COALESCE(C.ESTOQUE,0) - COALESCE(C.RESV_DAV,0) - COALESCE(C.RESV_EF,0) disponivel,
           COALESCE(C.RESV_DAV,0) + COALESCE(C.RESV_EF,0) reserva,
           A.UNVENDA un,
           D.QTDADE pedido,
           I.DESCRICAO imposto
      FROM PRODUTOSPRINCIPAL A
      LEFT JOIN PRODUTOSREFERENCIA B ON B.ID_PRODUTO = A.ID
      LEFT JOIN PRODUTOSREFEMPRESA C ON C.ID_REF = B.ID AND C.ID_EMPRESA = ${sqlInteiro(config.idEmpresa)}
      ${infoComplementar ? 'LEFT JOIN PRODUTOSPERSONAL PP ON PP.ID_PRODUTO = A.ID' : ''}
      LEFT JOIN WEB_PEDIDOS_PRO_PREPARA D ON D.ID_REF = B.ID AND D.ID_USUARIO = ${sqlInteiro(usuario.id)}
      LEFT JOIN PRODUTOSCLASSE X ON X.CLASSE = A.CLASSE
      LEFT JOIN IMPOSTOTRIB I ON I.ID = A.ID_TRIB
     WHERE (A.PRECOVENDA1 > 0.01)
       AND (A.ID = ${idProduto} OR ${filtroReferencia} OR UPPER(A.DESCRICAO) LIKE ${padrao}
            OR UPPER(A.MARCA) LIKE ${padrao} OR UPPER(A.APLICACAO) LIKE ${padrao})
       AND (${filtroExtra})
       AND (${filtroPromocao})
       AND (${sqlFiltroEstoque(filtroEstoque)})
       AND (${filtroIdsEstoque ?? 'TRUE'})
       AND A.ATIVO = 'S'
     ORDER BY A.DESCRICAO
     TOP ${LIMITE_PESQUISA}`;

  const { rows, truncated } = await consultarComLimite(sql);
  const podeVerPreco = nivelSupervisor(usuario);
  const fotos = await contarFotos(rows.map((r) => Number(r.id)));

  return {
    truncated: truncated || rows.length >= LIMITE_PESQUISA,
    produtos: rows.map((r) => ({
      id: Number(r.id),
      idRef: r.id_ref === null ? null : Number(r.id_ref),
      referencia: String(r.referencia ?? '').trim(),
      classe: String(r.classe ?? '').trim(),
      descricaoClasse: String(r.descricao_classe ?? '').trim(),
      descricao: String(r.descricao ?? '').trim(),
      aplicacao: String(r.aplicacao ?? '').trim(),
      info: String(r.info ?? '').trim(),
      marca: String(r.marca ?? '').trim(),
      // Preço e promoção só para supervisor ou acima, como as colunas ocultas do Delphi
      precoVenda: podeVerPreco ? Number(r.preco_venda || 0) : null,
      promocao: podeVerPreco ? Number(r.promocao || 0) : null,
      emPromocao: Number(r.promocao || 0) > 0,
      disponivel: Number(r.disponivel || 0),
      reserva: Number(r.reserva || 0),
      un: String(r.un ?? '').trim(),
      pedido: r.pedido === null ? null : Number(r.pedido),
      imposto: String(r.imposto ?? '').trim(),
      fotos: fotos.get(Number(r.id))?.qtd ?? 0,
      fotoPrincipal: fotos.get(Number(r.id))?.primeira ?? null,
    })),
  };
}

/** Quantidade de fotos (PROFOTOS) e id da primeira foto por produto, consultados em lotes */
async function contarFotos(ids: number[]): Promise<Map<number, { qtd: number; primeira: number }>> {
  const unicos = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  const mapa = new Map<number, { qtd: number; primeira: number }>();
  for (let i = 0; i < unicos.length; i += 500) {
    const lote = unicos.slice(i, i + 500);
    const rows = await consultar(
      `SELECT ID_PRODUTO id_produto, COUNT(*) qtd, MIN(ID) primeira FROM PROFOTOS
        WHERE ID_PRODUTO IN (${sqlListaInteiros(lote)}) GROUP BY ID_PRODUTO`,
    );
    for (const r of rows) mapa.set(Number(r.id_produto), { qtd: Number(r.qtd || 0), primeira: Number(r.primeira) });
  }
  return mapa;
}

export function createEstoqueRouter() {
  const router = Router();

  router.get('/estoque/pesquisa', async (req: Request, res: Response) => {
    try {
      const texto = String(req.query.q ?? '');
      const somentePromocao = req.query.promocao === '1' && req.usuario!.listaPreco === '1';
      const filtro = String(req.query.estoque || 'com') as FiltroEstoque;
      const filtroValido: FiltroEstoque = ['com', 'sem', 'todos', 'pre'].includes(filtro) ? filtro : 'com';
      res.json(await pesquisarProdutos(req.usuario!, texto, somentePromocao, filtroValido));
    } catch (err) {
      erro(res, err);
    }
  });

  /**
   * Ao abrir a pesquisa o Delphi recalculava as reservas. Chamadas repetidas em
   * menos de um minuto reaproveitam o último recálculo.
   */
  router.post('/estoque/recalcular-ao-abrir', async (req: Request, res: Response) => {
    try {
      const r = await recalcularReservas(RECALCULO_AO_ABRIR_MS);
      if (r.executado) gravarLogArquivo(`Recalculando ao entrar na pesquisa. Loja: ${req.usuario!.nomePessoa || req.usuario!.nome}`);
      res.json(r);
    } catch (err) {
      erro(res, err);
    }
  });

  /** Recálculo forçado (botão da tela de usuários, só administrador) */
  router.post(
    '/estoque/recalcular',
    exigirNivel(nivelAdministrador, 'administradores'),
    async (req: Request, res: Response) => {
      try {
        await recalcularReservas(0);
        gravarLogArquivo(`Recálculo manual das reservas por ${req.usuario!.email}`);
        res.json({ success: true });
      } catch (err) {
        erro(res, err);
      }
    },
  );

  /**
   * Quantidade do pré-pedido de um produto (coluna "Pedido" editável da pesquisa).
   * Valida contra o disponível, grava WEB_PEDIDOS_PRO_PREPARA e ajusta a reserva.
   */
  router.put(
    '/estoque/pre-pedido',
    exigirNivel(nivelSupervisor, 'supervisores, gerentes e administradores'),
    async (req: Request, res: Response) => {
      try {
        const u = req.usuario!;
        const idPro = Math.trunc(Number(req.body?.idProduto));
        const idRef = Math.trunc(Number(req.body?.idRef));
        const qtdade = Math.trunc(Number(req.body?.qtdade ?? 0));

        if (!idPro || !idRef) throw new BmapiError('Produto não identificado.');
        if (!Number.isFinite(qtdade) || qtdade < 0) throw new BmapiError('Quantidade inválida.');

        const atual = await consultarUm(
          'SELECT ID id, QTDADE qtdade FROM WEB_PEDIDOS_PRO_PREPARA WHERE ID_USUARIO = :u AND ID_REF = :r',
          { u: u.id, r: idRef },
        );
        const qtdAnterior = Number(atual?.qtdade || 0);

        // O que o próprio usuário já reservou volta a contar como disponível
        const disponivel = (await disponivelReferencia(idRef)) + qtdAnterior;
        if (qtdade > disponivel) {
          throw new BmapiError(
            `Quantidade disponível (${disponivel.toLocaleString('pt-BR')}) menor que a quantidade que você está pedindo!`,
          );
        }

        if (atual) {
          if (qtdade === 0) {
            await executar('DELETE FROM WEB_PEDIDOS_PRO_PREPARA WHERE ID = :id', { id: atual.id });
          } else {
            await executar('UPDATE WEB_PEDIDOS_PRO_PREPARA SET QTDADE = :q, ID_PRO = :p WHERE ID = :id', {
              q: qtdade,
              p: idPro,
              id: atual.id,
            });
          }
        } else if (qtdade > 0) {
          await executar(
            'INSERT INTO WEB_PEDIDOS_PRO_PREPARA (ID_USUARIO, ID_PRO, ID_REF, QTDADE) VALUES (:u, :p, :r, :q)',
            { u: u.id, p: idPro, r: idRef, q: qtdade },
          );
        }

        await ajustarReserva(idRef, qtdade - qtdAnterior);

        const disponivelAgora = await disponivelReferencia(idRef);
        gravarLogArquivo(
          `Loja: ${u.idPessoa}-${u.nomePessoa} / Usuário: ${u.email} / Produto: ${idPro} / Ref: ${idRef} / Old: ${qtdAnterior} / Digitado: ${qtdade} / Disponivel: ${disponivelAgora}`,
        );

        res.json({ success: true, qtdade: qtdade || null, disponivel: disponivelAgora });
      } catch (err) {
        erro(res, err);
      }
    },
  );

  /** Resumo do pré-pedido do usuário (para o botão "capturar" dos pedidos e o painel) */
  router.get('/estoque/pre-pedido', async (req: Request, res: Response) => {
    try {
      const rows = await consultar(
        `SELECT A.ID id, A.ID_PRO id_pro, A.ID_REF id_ref, A.QTDADE qtdade, B.DESCRICAO descricao, B.UNVENDA un
           FROM WEB_PEDIDOS_PRO_PREPARA A
           LEFT JOIN PRODUTOSPRINCIPAL B ON B.ID = A.ID_PRO
          WHERE A.ID_USUARIO = :u AND A.QTDADE > 0
          ORDER BY B.DESCRICAO`,
        { u: req.usuario!.id },
      );
      res.json(
        rows.map((r) => ({
          id: Number(r.id),
          idProduto: Number(r.id_pro),
          idRef: Number(r.id_ref),
          qtdade: Number(r.qtdade || 0),
          descricao: String(r.descricao ?? '').trim(),
          un: String(r.un ?? '').trim(),
        })),
      );
    } catch (err) {
      erro(res, err);
    }
  });

  /** Produtos similares (PRODUTOSSIMD) */
  router.get('/estoque/similares/:idProduto', async (req: Request, res: Response) => {
    try {
      const idPro = Math.trunc(Number(req.params.idProduto));
      const grupo = await consultarUm('SELECT ID_SIM id_sim FROM PRODUTOSSIMD WHERE ID_PRO = :p', { p: idPro });
      if (!grupo) return res.json([]);

      const colunaPreco = req.usuario!.listaPreco === '2' ? 'PRECOVENDA2' : 'PRECOVENDA1';
      const rows = await consultar(
        `SELECT A.ID_PRO id_pro, B.DESCRICAO descricao, B.${colunaPreco} preco, B.UNVENDA un,
                COALESCE(C.ESTOQUE,0) - COALESCE(C.RESV_DAV,0) - COALESCE(C.RESV_EF,0) disponivel
           FROM PRODUTOSSIMD A
           LEFT JOIN PRODUTOSPRINCIPAL B ON B.ID = A.ID_PRO
           LEFT JOIN PRODUTOSREFERENCIA R ON R.ID_PRODUTO = B.ID
           LEFT JOIN PRODUTOSREFEMPRESA C ON C.ID_REF = R.ID AND C.ID_EMPRESA = ${sqlInteiro(config.idEmpresa)}
          WHERE A.ID_SIM = :s AND A.ID_PRO <> :p
          ORDER BY B.DESCRICAO`,
        { s: grupo.id_sim, p: idPro },
      );
      const podeVerPreco = nivelSupervisor(req.usuario!);
      res.json(
        rows.map((r) => ({
          idProduto: Number(r.id_pro),
          descricao: String(r.descricao ?? '').trim(),
          preco: podeVerPreco ? Number(r.preco || 0) : null,
          un: String(r.un ?? '').trim(),
          disponivel: Number(r.disponivel || 0),
        })),
      );
    } catch (err) {
      erro(res, err);
    }
  });

  /**
   * Reservas de uma referência por cliente (sqlReservas):
   * DAVs fechados no ERP, pedidos web abertos e pré-pedidos em digitação.
   */
  router.get('/estoque/reservas/:idRef', async (req: Request, res: Response) => {
    const t = tabelaMemoria('RS');
    try {
      const ref = sqlInteiro(Math.trunc(Number(req.params.idRef)));
      const rows = await consultar(`
        SELECT A.ID_CLIENTE ID_CLIENTE, B.ID_REFERENCIA ID_REF,
               SUM(COALESCE(B.QTDADE,0)) FECHADOS, 0.00 ABERTOS, 0.00 FAZENDO
          INTO ${t}
          FROM ORCAMENTOM A
          LEFT JOIN ORCAMENTOP B ON B.ID_ORC = A.ID
         WHERE A.CANCELADO <> 'S' AND A.CAPTURADO NOT IN ('S','D') AND A.VALIDADO = TRUE
           AND B.ID_REFERENCIA = ${ref}
         GROUP BY A.ID_CLIENTE
        UNION
        SELECT A.ID_EMPRESA, B.ID_REF, 0.00, SUM(COALESCE(B.QTDADE,0)), 0.00
          FROM WEB_PEDIDOS A
          LEFT JOIN WEB_PEDIDOS_PRO B ON B.ID_PEDIDO = A.ID
         WHERE A.STATUS <> 'F' AND B.ID_REF = ${ref}
         GROUP BY A.ID_EMPRESA
        UNION
        SELECT U.ID_PESSOA, A.ID_REF, 0.00, 0.00, SUM(COALESCE(A.QTDADE,0))
          FROM WEB_PEDIDOS_PRO_PREPARA A
          LEFT JOIN WEB_USUARIOS U ON U.ID = A.ID_USUARIO
         WHERE A.QTDADE > 0 AND A.ID_REF = ${ref}
         GROUP BY U.ID_PESSOA;

        SELECT A.ID_CLIENTE id_cliente, P.NOME nome,
               SUM(A.FECHADOS) fechados, SUM(A.ABERTOS) abertos, SUM(A.FAZENDO) fazendo
          FROM ${t} A
          LEFT JOIN PESSOAS P ON P.ID = A.ID_CLIENTE
         GROUP BY A.ID_CLIENTE
         ORDER BY P.NOME`);

      res.json(
        rows.map((r) => {
          const fechados = Number(r.fechados || 0);
          const abertos = Number(r.abertos || 0);
          const fazendo = Number(r.fazendo || 0);
          return {
            idCliente: Number(r.id_cliente || 0),
            nome: String(r.nome ?? '').trim() || '(sem cliente)',
            fechados,
            abertos,
            fazendo,
            total: fechados + abertos + fazendo,
          };
        }),
      );
    } catch (err) {
      erro(res, err);
    } finally {
      executar(`DROP TABLE ${t}`).catch(() => {});
    }
  });

  /** Fotos cadastradas do produto (PROFOTOS), sem o conteúdo */
  router.get('/estoque/fotos/:idProduto', async (req: Request, res: Response) => {
    try {
      const rows = await consultar(
        'SELECT ID id, DESCRICAO descricao FROM PROFOTOS WHERE ID_PRODUTO = :p ORDER BY ID',
        { p: Math.trunc(Number(req.params.idProduto)) },
      );
      res.json(rows.map((r) => ({ id: Number(r.id), descricao: String(r.descricao ?? '').trim() })));
    } catch (err) {
      erro(res, err);
    }
  });

  /** Imagem de uma foto (PROFOTOS.FOTO), lida pela rota /blob da bmAPI */
  router.get('/estoque/foto/:idFoto', async (req: Request, res: Response) => {
    try {
      const foto = await baixarBlob('SELECT FOTO FROM PROFOTOS WHERE ID = :id', {
        id: Math.trunc(Number(req.params.idFoto)),
      });
      if (!foto) return res.status(404).json({ error: 'Foto não encontrada.' });
      res.setHeader('Content-Type', foto.contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(foto.conteudo);
    } catch (err) {
      erro(res, err);
    }
  });

  /** Classes de produto (frmPesquisaClasses) */
  router.get('/estoque/classes', async (req: Request, res: Response) => {
    try {
      const texto = String(req.query.q ?? '').trim().toUpperCase();
      const rows = await consultar(
        `SELECT ID id, CLASSE classe, DESCRICAO descricao
           FROM PRODUTOSCLASSE
          WHERE UPPER(DESCRICAO) LIKE :d1 OR UPPER(CLASSE) LIKE :d2
          ORDER BY CLASSE`,
        // a bmAPI preenche só a primeira ocorrência de cada parâmetro: um nome por uso
        { d1: `${texto}%`, d2: `${texto}%` },
      );
      res.json(
        rows.map((r) => ({
          id: Number(r.id),
          classe: String(r.classe ?? '').trim(),
          descricao: String(r.descricao ?? '').trim(),
        })),
      );
    } catch (err) {
      erro(res, err);
    }
  });

  return router;
}
