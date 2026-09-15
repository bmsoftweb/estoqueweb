import { config } from './config';
import {
  consultar,
  consultarUm,
  executar,
  sqlInteiro,
  sqlNumero,
  tabelaMemoria,
  servidorAtual,
  BmapiError,
} from './bmapi';
import { UsuarioSessao } from './auth';

/**
 * Regras de estoque compartilhadas pela pesquisa e pelos pedidos.
 *
 * Reserva: todo produto que entra num pré-pedido (WEB_PEDIDOS_PRO_PREPARA) ou num
 * pedido web aberto (WEB_PEDIDOS_PRO) soma em PRODUTOSREFEMPRESA.RESV_DAV, e o
 * disponível exibido é ESTOQUE - RESV_DAV - RESV_EF, como no app Delphi.
 *
 * O Delphi fazia "Locate + Edit + Post" na tabela (ler, somar e gravar). Aqui a
 * reserva é ajustada num único UPDATE com incremento, o que evita perder a
 * reserva de outro usuário gravada entre a leitura e a gravação.
 */

export interface ReferenciaProduto {
  idRef: number;
  idProduto: number;
  referencia: string;
  descricao: string;
  unVenda: string;
  precoLista: number;
  precoPromocao: number;
  disponivel: number;
}

/** Referência principal do produto, preço conforme a lista do usuário e disponível (qrRef) */
export async function buscarReferencia(idProduto: number, usuario: UsuarioSessao): Promise<ReferenciaProduto> {
  const colunaPreco = usuario.listaPreco === '2' ? 'PRECOVENDA2' : 'PRECOVENDA1';
  const row = await consultarUm(
    `SELECT A.ID id_ref, A.ID_PRODUTO id_produto, A.REFERENCIA referencia, B.DESCRICAO descricao,
            B.UNVENDA unvenda, B.${colunaPreco} preco_lista,
            IF(CURRENT_DATE BETWEEN B.PROMOCAO_DATA_INI AND B.PROMOCAO_DATA_FIM, COALESCE(B.PRECO_PROMOCAO,0), 0.00) preco_promocao,
            COALESCE(C.ESTOQUE,0) - COALESCE(C.RESV_DAV,0) - COALESCE(C.RESV_EF,0) disponivel
       FROM PRODUTOSREFERENCIA A
       LEFT JOIN PRODUTOSPRINCIPAL B ON B.ID = A.ID_PRODUTO
       LEFT JOIN PRODUTOSREFEMPRESA C ON C.ID_REF = A.ID AND C.ID_EMPRESA = :emp
      WHERE A.ID_PRODUTO = :pro
      ORDER BY A.ID TOP 1`,
    { emp: config.idEmpresa, pro: idProduto },
  );
  if (!row) {
    throw new BmapiError(`O produto ${idProduto} não possui referência cadastrada.`);
  }
  return {
    idRef: Number(row.id_ref),
    idProduto: Number(row.id_produto),
    referencia: String(row.referencia || '').trim(),
    descricao: String(row.descricao || '').trim(),
    unVenda: String(row.unvenda || '').trim(),
    precoLista: Number(row.preco_lista || 0),
    precoPromocao: Number(row.preco_promocao || 0),
    disponivel: Number(row.disponivel || 0),
  };
}

/** Preço unitário do item: promoção vale só para a lista 1 (tbPedidosProBeforePost) */
export function precoUnitario(ref: ReferenciaProduto, usuario: UsuarioSessao): number {
  if (ref.precoPromocao > 0 && usuario.listaPreco === '1') return ref.precoPromocao;
  return ref.precoLista;
}

/** Disponível atual de uma referência (ESTOQUE - RESV_DAV - RESV_EF) */
export async function disponivelReferencia(idRef: number): Promise<number> {
  const row = await consultarUm(
    `SELECT COALESCE(ESTOQUE,0) - COALESCE(RESV_DAV,0) - COALESCE(RESV_EF,0) disponivel
       FROM PRODUTOSREFEMPRESA WHERE ID_REF = :ref AND ID_EMPRESA = :emp`,
    { ref: idRef, emp: config.idEmpresa },
  );
  return Number(row?.disponivel || 0);
}

/** Soma (ou subtrai) quantidade na reserva da referência, sem deixar negativo */
export function sqlAjusteReserva(idRef: number, delta: number): string {
  const d = sqlNumero(delta);
  return `UPDATE PRODUTOSREFEMPRESA
             SET RESV_DAV = IF(COALESCE(RESV_DAV,0) + (${d}) < 0, 0, COALESCE(RESV_DAV,0) + (${d}))
           WHERE ID_REF = ${sqlInteiro(idRef)} AND ID_EMPRESA = ${sqlInteiro(config.idEmpresa)}`;
}

export async function ajustarReserva(idRef: number, delta: number) {
  if (!delta) return;
  await executar(sqlAjusteReserva(idRef, delta));
}

// ------------------------------------------------------------
// Recalcular reservas (qrRecalcularReservas do Delphi)
// ------------------------------------------------------------
// Controle do recálculo por servidor da bmAPI (cada servidor é uma base diferente)
const ultimoRecalculo = new Map<number, number>();
const recalculoEmAndamento = new Map<number, Promise<void>>();

/**
 * Refaz RESV_DAV de todas as referências a partir de:
 *  - DAVs do ERP (ORCAMENTOM/ORCAMENTOP) validados, tipo P, não cancelados nem capturados;
 *  - pedidos web ainda não fechados (WEB_PEDIDOS/WEB_PEDIDOS_PRO);
 *  - pré-pedidos (WEB_PEDIDOS_PRO_PREPARA).
 * Antes apaga itens órfãos de pedidos web.
 *
 * O Delphi rodava isto a cada abertura da pesquisa. Aqui chamadas próximas
 * (dentro de `intervaloMinimoMs`) reaproveitam o último recálculo.
 */
export async function recalcularReservas(intervaloMinimoMs = 0): Promise<{ executado: boolean }> {
  const srv = servidorAtual().numero;
  const emAndamento = recalculoEmAndamento.get(srv);
  if (emAndamento) {
    await emAndamento;
    return { executado: false };
  }
  if (intervaloMinimoMs > 0 && Date.now() - (ultimoRecalculo.get(srv) ?? 0) < intervaloMinimoMs) {
    return { executado: false };
  }

  const t1 = tabelaMemoria('RR');
  const t2 = tabelaMemoria('RR');
  const emp = sqlInteiro(config.idEmpresa);

  const script = `
    DELETE FROM WEB_PEDIDOS_PRO A
      LEFT JOIN WEB_PEDIDOS B ON B.ID = A.ID_PEDIDO
     WHERE COALESCE(B.ID_EMPRESA,0) = 0;

    SELECT B.ID_PRODUTO ID_PRO, B.ID_REFERENCIA ID_REF,
           SUM(COALESCE(B.QTDADE,0)) QTDADE_DAV_FECHADOS,
           0.00 QTDADE_DAV_ABERTOS, 0.00 QTDADE_DAV_FAZENDO
      INTO ${t1}
      FROM ORCAMENTOM A
      LEFT JOIN ORCAMENTOP B ON B.ID_ORC = A.ID
     WHERE A.CANCELADO <> 'S' AND A.CAPTURADO NOT IN ('S','D') AND A.VALIDADO = TRUE AND A.TIPO = 'P'
     GROUP BY B.ID_REFERENCIA
    UNION
    SELECT B.ID_PRO, B.ID_REF, 0.00, SUM(COALESCE(B.QTDADE,0)), 0.00
      FROM WEB_PEDIDOS A
      LEFT JOIN WEB_PEDIDOS_PRO B ON B.ID_PEDIDO = A.ID
     WHERE A.STATUS <> 'F'
     GROUP BY B.ID_REF
    UNION
    SELECT ID_PRO, ID_REF, 0.00, 0.00, SUM(COALESCE(QTDADE,0))
      FROM WEB_PEDIDOS_PRO_PREPARA
     GROUP BY ID_REF;

    SELECT ID_PRO, ID_REF,
           SUM(QTDADE_DAV_FECHADOS) QTDADE_DAV_FECHADOS,
           SUM(QTDADE_DAV_ABERTOS) QTDADE_DAV_ABERTOS,
           SUM(QTDADE_DAV_FAZENDO) QTDADE_DAV_FAZENDO
      INTO ${t2}
      FROM ${t1}
     GROUP BY ID_REF;

    UPDATE PRODUTOSREFEMPRESA SET RESV_DAV = 0 WHERE ID_EMPRESA = ${emp};

    UPDATE PRODUTOSREFEMPRESA A
       SET A.RESV_DAV = COALESCE(B.QTDADE_DAV_FECHADOS,0) + COALESCE(B.QTDADE_DAV_ABERTOS,0) + COALESCE(B.QTDADE_DAV_FAZENDO,0)
      FROM PRODUTOSREFEMPRESA A
      LEFT JOIN ${t2} B ON B.ID_REF = A.ID_REF
     WHERE A.ID_EMPRESA = ${emp};

    DROP TABLE ${t1};
    DROP TABLE ${t2}`;

  const tarefa = (async () => {
    try {
      await executar(script);
      ultimoRecalculo.set(srv, Date.now());
    } catch (err) {
      // Se o script parou no meio, as tabelas em memória podem ter ficado para trás
      await executar(`DROP TABLE ${t1}`).catch(() => {});
      await executar(`DROP TABLE ${t2}`).catch(() => {});
      throw err;
    }
  })();

  recalculoEmAndamento.set(srv, tarefa);
  try {
    await tarefa;
  } finally {
    recalculoEmAndamento.delete(srv);
  }
  return { executado: true };
}

// ------------------------------------------------------------
// Colunas opcionais conforme a versão da base
// ------------------------------------------------------------
const temInfoComplementar = new Map<number, boolean>();

/** PRODUTOSPERSONAL.INFO_COMPLEMENTAR não existe em todas as bases */
export async function baseTemInfoComplementar(): Promise<boolean> {
  const srv = servidorAtual().numero;
  const conhecido = temInfoComplementar.get(srv);
  if (conhecido !== undefined) return conhecido;
  let tem: boolean;
  try {
    await consultar('SELECT INFO_COMPLEMENTAR FROM PRODUTOSPERSONAL WHERE 1 = 0');
    tem = true;
  } catch {
    tem = false;
  }
  temInfoComplementar.set(srv, tem);
  return tem;
}
