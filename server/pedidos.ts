import { Router, Request, Response } from 'express';
import { config } from './config.js';
import {
  consultar,
  consultarUm,
  executar,
  hojeISO,
  agoraISO,
  sqlBool,
  sqlData,
  sqlDataHora,
  sqlInteiro,
  sqlNumero,
  sqlTexto,
  comServidor,
  BmapiError,
  Linha,
} from './bmapi.js';
import { buscarServidor } from './servidores.js';
import { exigirNivel, nivelGerente, UsuarioSessao } from './auth.js';
import {
  ajustarReserva,
  buscarReferencia,
  disponivelReferencia,
  precoUnitario,
  sqlAjusteReserva,
} from './estoqueComum.js';

/**
 * Pedidos web das lojas (frmPedidos).
 *
 * Status do WEB_PEDIDOS: A = aberto, F = fechado (já gerou o DAV no ERP),
 * X = cancelado no ERP. Faturado = 'S' quando o DAV foi capturado por uma nota.
 *
 * Fechar o pedido grava no ERP, como o Delphi:
 *   ORCAMENTOCONTROL (numeração) -> ORCAMENTOM (DAV) -> ORCAMENTOP (itens)
 *   -> RESERVACARDEX (uma reserva por item) -> WEB_PEDIDOS.STATUS = 'F'.
 * O DAV guarda em PEDIDO_VENDEDOR o id do pedido web com 6 dígitos, que é o elo
 * usado depois para atualizar número, faturamento e cancelamento.
 */

const STATUS_ABERTO = 'A';
const STATUS_FECHADO = 'F';
const STATUS_CANCELADO = 'X';

/** A sincronização de status olha os pedidos fechados deste período para trás */
const DIAS_SINCRONIZACAO = 180;

function erro(res: Response, err: any) {
  res.status(err?.status || 400).json({ error: err?.message || 'Erro inesperado.' });
}

function arredondar(valor: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * f) / f;
}

function pedidoVendedor(idPedido: number): string {
  return String(idPedido).padStart(6, '0');
}

// ------------------------------------------------------------
// Leitura
// ------------------------------------------------------------
function mapearPedido(r: Linha) {
  return {
    id: Number(r.id),
    idCliente: Number(r.id_empresa || 0),
    clienteNome: String(r.cliente_nome ?? '').trim(),
    idPlano: Number(r.id_plano || 0),
    planoDescricao: String(r.plano_descricao ?? '').trim(),
    data: r.data,
    expiraEm: r.expira_em,
    dataFechamento: r.data_fechamento,
    descricao: String(r.descricao ?? '').trim(),
    obs: String(r.obs ?? ''),
    totalProdutos: Number(r.total_produtos || 0),
    percDescontos: Number(r.perc_descontos || 0),
    totalDescontos: Number(r.total_descontos || 0),
    totalPedido: Number(r.total_pedido || 0),
    status: String(r.status ?? '').trim() || STATUS_ABERTO,
    faturado: String(r.faturado ?? '').trim() === 'S',
    numeroPedido: String(r.numero_pedido ?? '').trim(),
    numeroNf: String(r.numero_nf ?? '').trim(),
    idUsuario: Number(r.id_usuario || 0),
    entregaData: r.entrega_data,
    entregaObs: String(r.entrega_obs ?? '').trim(),
    qtdItens: r.qtd_itens === undefined ? undefined : Number(r.qtd_itens || 0),
  };
}

const SELECT_PEDIDO = `
  SELECT W.ID id, W.ID_EMPRESA id_empresa, P.NOME cliente_nome, W.ID_PLANO id_plano, PL.DESCRICAO plano_descricao,
         W.DATA data, W.EXPIRA_EM expira_em, W.DATA_FECHAMENTO data_fechamento, W.DESCRICAO descricao,
         CAST(W.OBS AS VARCHAR(512)) obs, W.TOTAL_PRODUTOS total_produtos, W.PERC_DESCONTOS perc_descontos,
         W.TOTAL_DESCONTOS total_descontos, W.TOTAL_PEDIDO total_pedido, W.STATUS status, W.FATURADO faturado,
         W.NUMERO_PEDIDO numero_pedido, W.NUMERO_NF numero_nf, W.ID_USUARIO id_usuario,
         W.ENTREGA_DATA entrega_data, W.ENTREGA_OBS entrega_obs
    FROM WEB_PEDIDOS W
    LEFT JOIN PESSOAS P ON P.ID = W.ID_EMPRESA
    LEFT JOIN PLANOS PL ON PL.ID = W.ID_PLANO`;

/** Pedido do usuário; lojas (ID_PESSOA > 0) só enxergam os próprios pedidos */
async function carregarPedido(idPedido: number, usuario: UsuarioSessao) {
  const row = await consultarUm(`${SELECT_PEDIDO} WHERE W.ID = :id`, { id: idPedido });
  if (!row) throw new BmapiError('Pedido não encontrado.', 404);
  const pedido = mapearPedido(row);
  if (usuario.idPessoa > 0 && pedido.idCliente !== usuario.idPessoa) {
    throw new BmapiError('Pedido não encontrado.', 404);
  }
  return pedido;
}

function exigirAberto(pedido: { status: string }) {
  if (pedido.status !== STATUS_ABERTO) {
    throw new BmapiError('Este pedido já está fechado ou cancelado!');
  }
}

async function carregarItens(idPedido: number) {
  const rows = await consultar(
    `SELECT A.ID id, A.ID_PEDIDO id_pedido, A.ID_PRO id_pro, A.ID_REF id_ref, A.REFERENCIA referencia,
            A.DESCRICAO_PRO descricao_pro, A.OBS_PRO obs_pro, A.QTDADE qtdade, A.PRECO_UNIT preco_unit,
            A.PRECO_TOTAL preco_total, B.DESCRICAO descricao, B.MARCA marca, B.UNVENDA un,
            B.PESO_BRUTO peso_bruto, I.DESCRICAO imposto
       FROM WEB_PEDIDOS_PRO A
       LEFT JOIN PRODUTOSPRINCIPAL B ON B.ID = A.ID_PRO
       LEFT JOIN IMPOSTOTRIB I ON I.ID = B.ID_TRIB
      WHERE A.ID_PEDIDO = :id
      ORDER BY A.ID`,
    { id: idPedido },
  );
  return rows.map((r) => {
    const qtdade = Number(r.qtdade || 0);
    const pesoBruto = Number(r.peso_bruto || 0);
    return {
      id: Number(r.id),
      idProduto: Number(r.id_pro || 0),
      idRef: Number(r.id_ref || 0),
      referencia: String(r.referencia ?? '').trim(),
      descricao: String(r.descricao ?? r.descricao_pro ?? '').trim(),
      marca: String(r.marca ?? '').trim(),
      un: String(r.un ?? '').trim(),
      obs: String(r.obs_pro ?? '').trim(),
      qtdade,
      precoUnit: Number(r.preco_unit || 0),
      precoTotal: Number(r.preco_total || 0),
      pesoBrutoTotal: arredondar(pesoBruto * qtdade, 3),
      imposto: String(r.imposto ?? '').trim(),
    };
  });
}

export async function planosLiberados(usuario: UsuarioSessao) {
  // WEB_USUARIOS_PLANOS.ID_USUARIO guarda o ID_PESSOA da loja (frmUsuariosPlanos)
  const rows =
    usuario.idPessoa > 0
      ? await consultar(
          `SELECT A.ID id, A.DESCRICAO descricao, A.APELIDO apelido, A.JUROS juros, A.NUMEROPARCELAS parcelas
             FROM PLANOS A
             LEFT JOIN WEB_USUARIOS_PLANOS B ON B.ID_PLANO = A.ID
            WHERE B.ID_USUARIO = :p AND B.STATUS = 'S'
            ORDER BY A.DESCRICAO`,
          { p: usuario.idPessoa },
        )
      : await consultar(
          `SELECT ID id, DESCRICAO descricao, APELIDO apelido, JUROS juros, NUMEROPARCELAS parcelas
             FROM PLANOS WHERE ATIVO = TRUE ORDER BY DESCRICAO`,
        );
  return rows.map((r) => ({
    id: Number(r.id),
    descricao: String(r.descricao ?? '').trim(),
    apelido: String(r.apelido ?? '').trim(),
    juros: Number(r.juros || 0),
    parcelas: Number(r.parcelas || 0),
  }));
}

async function dadosCliente(idPessoa: number) {
  if (!idPessoa) return null;
  return consultarUm(
    `SELECT ID id, NOME nome, CPFCNPJ cpfcnpj, ID_PLANO id_plano, ID_BLOQ id_bloq, LIMITECREDITO limite_credito,
            CIDADE cidade, UF uf, FONE1 fone, EMAIL email, ENDERECO endereco, NUMERO numero, BAIRRO bairro, CEP cep
       FROM PESSOAS WHERE ID = :id`,
    { id: idPessoa },
  );
}

/**
 * Plano que o pedido é obrigado a usar: o plano do cadastro da loja, quando ele
 * está entre os liberados (tbPedidosNewRecord / tbPedidosBeforePost do Delphi).
 */
async function regraPlano(usuario: UsuarioSessao) {
  const planos = await planosLiberados(usuario);
  const cliente = await dadosCliente(usuario.idPessoa);
  const idPlanoCadastro = Number(cliente?.id_plano || 0);
  const planoForcado = planos.find((p) => p.id === idPlanoCadastro) ? idPlanoCadastro : 0;
  return { planos, planoForcado, idPlanoCadastro, cliente };
}

/** Percentual de desconto do plano: juros negativos viram desconto */
async function percDescontoPlano(idPlano: number): Promise<number | null> {
  const plano = await consultarUm('SELECT JUROS juros FROM PLANOS WHERE ID = :id', { id: idPlano });
  if (!plano) return null;
  const juros = Number(plano.juros || 0);
  return juros < 0 ? Math.abs(juros) : 0;
}

/** Recalcula os totais do pedido aberto (btnTotalizarClick) */
async function totalizar(idPedido: number) {
  const pedido = await consultarUm('SELECT STATUS status, ID_PLANO id_plano FROM WEB_PEDIDOS WHERE ID = :id', {
    id: idPedido,
  });
  // Status vazio conta como aberto (igual a mapearPedido)
  if (!pedido || (String(pedido.status ?? '').trim() || STATUS_ABERTO) !== STATUS_ABERTO) return;

  const soma = await consultarUm('SELECT SUM(PRECO_TOTAL) total FROM WEB_PEDIDOS_PRO WHERE ID_PEDIDO = :id', {
    id: idPedido,
  });
  const totalProdutos = arredondar(Number(soma?.total || 0));
  const perc = (await percDescontoPlano(Number(pedido.id_plano || 0))) ?? 0;
  const totalDescontos = arredondar(totalProdutos * (perc / 100));

  await executar(
    `UPDATE WEB_PEDIDOS SET TOTAL_PRODUTOS = :tp, PERC_DESCONTOS = :pd, TOTAL_DESCONTOS = :td, TOTAL_PEDIDO = :tt
      WHERE ID = :id`,
    { tp: totalProdutos, pd: perc, td: totalDescontos, tt: arredondar(totalProdutos - totalDescontos), id: idPedido },
  );
}

// ------------------------------------------------------------
// Consistências para abrir um pedido (navPedidosBeforeAction)
// ------------------------------------------------------------
async function consistirNovoPedido(usuario: UsuarioSessao) {
  if (usuario.idPessoa <= 0) {
    throw new BmapiError('Este usuário não está vinculado a uma loja (ID_PESSOA) e não pode lançar pedidos.');
  }

  if (config.consistirFinanceiro) {
    const atrasados = await consultarUm(
      `SELECT COUNT(*) qtd FROM DPRPRINCIPAL
        WHERE ID_CLIENTE = :c AND STATUS = 'A' AND VENCIMENTO < :d`,
      { c: usuario.idPessoa, d: hojeISO(-config.diasEmAtraso) },
    );
    if (Number(atrasados?.qtd || 0) > 0) {
      throw new BmapiError('ERRO 401: favor entrar em contato com o setor administrativo da Central.');
    }
  }

  const regra = await regraPlano(usuario);

  if (config.consistirBloqueio && Number(regra.cliente?.id_bloq || 0) > 0) {
    throw new BmapiError('ERRO 402: favor entrar em contato com o setor administrativo da Central.');
  }

  if (!regra.planoForcado && regra.idPlanoCadastro > 0) {
    throw new BmapiError('ERRO 403: favor entrar em contato com o setor administrativo da Central.');
  }

  return regra;
}

// ------------------------------------------------------------
// Fechamento: grava o DAV no ERP
// ------------------------------------------------------------
async function proximoNumeroDav(idEmpresa: number): Promise<number> {
  const emp = sqlInteiro(idEmpresa);
  const row = await consultarUm(`
    SELECT ID_EMPRESA FROM ORCAMENTOCONTROL WHERE ID_EMPRESA = ${emp};
    UPDATE ORCAMENTOCONTROL SET NUMERO = COALESCE(NUMERO,0) + 1 WHERE ID_EMPRESA = ${emp};
    SELECT NUMERO numero FROM ORCAMENTOCONTROL WHERE ID_EMPRESA = ${emp}`);
  if (row) return Number(row.numero);

  await executar('INSERT INTO ORCAMENTOCONTROL (ID_EMPRESA, NUMERO) VALUES (:e, 1)', { e: idEmpresa });
  return 1;
}

interface OpcoesFechamento {
  usuario?: UsuarioSessao;
  /** true na rotina da meia-noite: sem as consistências de crédito e estoque */
  automatico?: boolean;
}

export async function fecharPedido(idPedido: number, opcoes: OpcoesFechamento) {
  const row = await consultarUm(`${SELECT_PEDIDO} WHERE W.ID = :id`, { id: idPedido });
  if (!row) throw new BmapiError('Pedido não encontrado.', 404);
  let pedido = mapearPedido(row);
  if (opcoes.usuario && opcoes.usuario.idPessoa > 0 && pedido.idCliente !== opcoes.usuario.idPessoa) {
    throw new BmapiError('Pedido não encontrado.', 404);
  }
  exigirAberto(pedido);

  // Sem plano, a rotina da meia-noite usa o plano padrão e grava no pedido para o desconto dele entrar no recálculo
  if (opcoes.automatico && !pedido.idPlano) {
    await executar('UPDATE WEB_PEDIDOS SET ID_PLANO = :p WHERE ID = :id', {
      p: config.planoPadraoAgendador,
      id: idPedido,
    });
  }

  await totalizar(idPedido);
  pedido = mapearPedido((await consultarUm(`${SELECT_PEDIDO} WHERE W.ID = :id`, { id: idPedido }))!);
  const itens = await carregarItens(idPedido);

  if (!itens.length) throw new BmapiError('O pedido não tem itens.');

  const idPlano = pedido.idPlano;
  if (!opcoes.automatico) {
    // Limite de crédito da loja
    const credito = await consultarUm(
      `SELECT SUM(COALESCE(A.VALOR,0) - COALESCE(A.VALOR_RECEBIDO,0)) valor_aberto
         FROM DPRPRINCIPAL A WHERE A.ID_CLIENTE = :c AND A.STATUS = 'A'`,
      { c: pedido.idCliente },
    );
    const cliente = await dadosCliente(pedido.idCliente);
    const limite = Number(cliente?.limite_credito || 0);
    const aberto = Number(credito?.valor_aberto || 0);
    if (limite !== 0 && aberto + pedido.totalPedido > limite) {
      const f = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      throw new BmapiError(`Limite de crédito excedido! Limite: ${f(limite)} • Em aberto: ${f(aberto)}`);
    }

    if (!idPlano || (await percDescontoPlano(idPlano)) === null) {
      throw new BmapiError('Indique uma forma de pagamento!');
    }

    // Mais uma camada: nenhum item pode estar com estoque negativo
    for (const item of itens) {
      const est = await consultarUm(
        `SELECT COALESCE(ESTOQUE,0) - COALESCE(RESV_DAV,0) - COALESCE(RESV_OS,0) - COALESCE(RESV_PV,0) - COALESCE(RESV_EF,0) disp
           FROM PRODUTOSREFEMPRESA WHERE ID_REF = :r AND ID_EMPRESA = :e`,
        { r: item.idRef, e: config.idEmpresa },
      );
      if (Number(est?.disp || 0) < 0) {
        throw new BmapiError(
          `Inconsistência na quantidade do produto ${item.idProduto}-${item.descricao}. Entre em contato com a Central!`,
        );
      }
    }
  }

  const cliente = await dadosCliente(pedido.idCliente);
  const idEmpresa = config.idEmpresa;
  const numero = await proximoNumeroDav(idEmpresa);
  const refVendedor = pedidoVendedor(idPedido);

  // 1. Cabeçalho do DAV
  const orcamento = await consultarUm(`
    SELECT ID FROM ORCAMENTOM WHERE ID = -1;
    INSERT INTO ORCAMENTOM (ID_EMPRESA, NUMERO, DATA, GERACAO_DATA, GERACAO_HORA, ID_CLIENTE, CLIENTE_NOME, CLIENTE_DOC,
                            ID_PLANO, ID_VENDEDOR, TOTAL_PRODUTOS, TOTAL_SERVICOS, TOTAL_BRUTO, DESCONTOS_VALOR, TOTAL_LIQ,
                            OBS, OBS_INT, TIPO, TPACRE, TPDESC, PEDIDO_VENDEDOR, CONTATO, IMPORTMP, VALIDADO, ID_MP)
    VALUES (${sqlInteiro(idEmpresa)}, ${sqlInteiro(numero)}, CURRENT_DATE, CURRENT_DATE, CURRENT_TIME,
            ${sqlInteiro(pedido.idCliente)}, ${sqlTexto(cliente?.nome ?? '', 40)}, ${sqlTexto(cliente?.cpfcnpj ?? '', 20)},
            ${sqlInteiro(idPlano)}, 1, ${sqlNumero(pedido.totalProdutos)}, 0, ${sqlNumero(pedido.totalProdutos)},
            ${sqlNumero(pedido.totalDescontos)}, ${sqlNumero(pedido.totalPedido)},
            ${sqlTexto(pedido.obs)}, ${opcoes.automatico ? sqlTexto('PEDIDO FECHADO PELO SISTEMA') : 'NULL'},
            'P', 'V', 'V', ${sqlTexto(refVendedor)}, '', ${sqlBool(true)}, ${sqlBool(true)}, 0);
    SELECT ID id FROM ORCAMENTOM
     WHERE ID_EMPRESA = ${sqlInteiro(idEmpresa)} AND NUMERO = ${sqlInteiro(numero)} AND PEDIDO_VENDEDOR = ${sqlTexto(refVendedor)}
     ORDER BY ID DESC TOP 1`);

  if (!orcamento) throw new BmapiError('Não foi possível gravar o DAV no ERP.');
  const idOrc = Number(orcamento.id);

  try {
    // 2. Itens do DAV
    const obsEntrega = pedido.entregaObs ? `OBS. DA ENTREGA: ${pedido.entregaObs}` : '';
    const insertsItens = itens.map((item, i) => {
      const texto = [item.obs, obsEntrega].filter(Boolean).join('\n').trim();
      return `INSERT INTO ORCAMENTOP (ITEM, ID_ORC, ID_PRODUTO, ID_REFERENCIA, REFERENCIA, TIPO_PRODUTO, DATA_INCLUSAO,
                                     QTDADE, PRECO_LISTA, PRECO_VENDA, PRECO_TOTAL_BRUTO, DESCONTO_VALOR,
                                     PRECO_TOTAL_LIQ, TEXTO, DATA_ENTREGA)
              VALUES (${i + 1}, ${idOrc}, ${sqlInteiro(item.idProduto)}, ${sqlInteiro(item.idRef)},
                      ${sqlTexto(item.referencia, 20)}, 'R', CURRENT_DATE, ${sqlNumero(item.qtdade)},
                      ${sqlNumero(item.precoUnit)}, ${sqlNumero(item.precoUnit)}, ${sqlNumero(item.precoTotal)}, 0,
                      ${sqlNumero(item.precoTotal)}, ${texto ? sqlTexto(texto) : 'NULL'},
                      ${pedido.entregaData ? sqlData(pedido.entregaData) : 'NULL'})`;
    });
    await executar(insertsItens.join(';\n'));

    const gravados = await consultar('SELECT ID id, ITEM item FROM ORCAMENTOP WHERE ID_ORC = :o', { o: idOrc });
    const idPorItem = new Map(gravados.map((g) => [Number(g.item), Number(g.id)]));

    // 3. Reservas no cardex + pedido web fechado
    const comandos = itens.map(
      (item, i) => `INSERT INTO RESERVACARDEX (ID_EMPRESA, ID_REF, DATA, HORA, TIPO, FLUXO, QTD, QTD_PEND, LINK_TP, LINK_ID, ID_ITEM)
                    VALUES (${sqlInteiro(idEmpresa)}, ${sqlInteiro(item.idRef)}, CURRENT_DATE, CURRENT_TIME, 'D', 'R',
                            ${sqlNumero(item.qtdade)}, ${sqlNumero(item.qtdade)}, 'DA', ${idOrc},
                            ${sqlInteiro(idPorItem.get(i + 1) ?? 0)})`,
    );
    comandos.push(
      `UPDATE WEB_PEDIDOS SET STATUS = '${STATUS_FECHADO}', DATA_FECHAMENTO = CURRENT_DATE,
              NUMERO_PEDIDO = ${sqlTexto(String(numero), 10)}, DATAHORA_EVENTO = CURRENT_TIMESTAMP
        WHERE ID = ${sqlInteiro(idPedido)}`,
    );
    await executar(comandos.join(';\n'));
  } catch (err) {
    // Desfaz o que foi gravado no ERP para não deixar um DAV incompleto
    await executar(
      `DELETE FROM RESERVACARDEX WHERE LINK_TP = 'DA' AND LINK_ID = ${idOrc};
       DELETE FROM ORCAMENTOP WHERE ID_ORC = ${idOrc};
       DELETE FROM ORCAMENTOM WHERE ID = ${idOrc}`,
    ).catch((e) => console.error(`Falha ao desfazer o DAV ${idOrc} do pedido ${idPedido}:`, e.message));
    throw err;
  }

  return { numero, idOrcamento: idOrc };
}

// ------------------------------------------------------------
// Sincronização com o ERP (btnAtualizarPedidosClick)
// ------------------------------------------------------------
export async function sincronizarStatus(usuario: UsuarioSessao | null) {
  const filtroLoja = usuario && usuario.idPessoa > 0 ? `AND ID_EMPRESA = ${sqlInteiro(usuario.idPessoa)}` : '';
  const candidatos = await consultar(
    `SELECT ID id, FATURADO faturado FROM WEB_PEDIDOS
      WHERE STATUS = '${STATUS_FECHADO}' AND DATA >= ${sqlData(hojeISO(-DIAS_SINCRONIZACAO))} ${filtroLoja}`,
  );
  if (!candidatos.length) return { atualizados: 0, faturados: 0, cancelados: 0 };

  let atualizados = 0;
  let faturados = 0;
  let cancelados = 0;

  for (let i = 0; i < candidatos.length; i += 200) {
    const lote = candidatos.slice(i, i + 200);
    const refs = lote.map((c) => sqlTexto(pedidoVendedor(Number(c.id)))).join(',');

    const davs = await consultar(
      `SELECT ID id, NUMERO numero, CAPTURADO capturado, CANCELADO cancelado, PEDIDO_VENDEDOR pedido_vendedor
         FROM ORCAMENTOM
        WHERE PEDIDO_VENDEDOR IN (${refs}) AND ID_EMPRESA = ${sqlInteiro(config.idEmpresa)}
        ORDER BY ID DESC`,
    );
    // O mais recente vale, se houver mais de um DAV com a mesma referência
    const davPorRef = new Map<string, Linha>();
    for (const d of davs) {
      const ref = String(d.pedido_vendedor ?? '').trim();
      if (!davPorRef.has(ref)) davPorRef.set(ref, d);
    }

    const capturados = [...davPorRef.values()].filter((d) => String(d.capturado ?? '').trim() === 'S');
    const notas = new Map<number, string>();
    if (capturados.length) {
      const nfs = await consultar(
        `SELECT A.ID_DOC id_doc, B.SERIE serie, B.NUMERO numero
           FROM NFCAPTURAS A
           LEFT JOIN NFMESTRE B ON B.ID = A.ID_NF
          WHERE A.TIPOCAP = 'DA' AND A.ID_DOC IN (${capturados.map((d) => sqlInteiro(d.id)).join(',')})`,
      );
      for (const nf of nfs) {
        notas.set(Number(nf.id_doc), `${String(nf.serie ?? '').trim()}/${nf.numero ?? ''}`);
      }
    }

    const comandos: string[] = [];
    for (const c of lote) {
      const dav = davPorRef.get(pedidoVendedor(Number(c.id)));
      if (!dav) continue;
      const idWeb = sqlInteiro(c.id);

      if (String(dav.cancelado ?? '').trim() === 'S') {
        comandos.push(`DELETE FROM WEB_PEDIDOS_PRO WHERE ID_PEDIDO = ${idWeb}`);
        comandos.push(`UPDATE WEB_PEDIDOS SET STATUS = '${STATUS_CANCELADO}' WHERE ID = ${idWeb}`);
        cancelados++;
        continue;
      }

      if (String(c.faturado ?? '').trim() !== 'S') {
        const sets = [`NUMERO_PEDIDO = ${sqlTexto(String(dav.numero ?? ''), 10)}`];
        if (String(dav.capturado ?? '').trim() === 'S') {
          sets.push(`FATURADO = 'S'`);
          const nf = notas.get(Number(dav.id));
          if (nf) sets.push(`NUMERO_NF = ${sqlTexto(nf, 12)}`);
          faturados++;
        }
        comandos.push(`UPDATE WEB_PEDIDOS SET ${sets.join(', ')} WHERE ID = ${idWeb}`);
        atualizados++;
      }
    }

    if (comandos.length) await executar(comandos.join(';\n'));
  }

  return { atualizados, faturados, cancelados };
}

// ------------------------------------------------------------
// Rotas
// ------------------------------------------------------------
export function createPedidosRouter() {
  const router = Router();
  router.use('/pedidos', exigirNivel(nivelGerente, 'gerentes e administradores'));

  /** Planos liberados, plano obrigatório e regras da loja para a tela */
  router.get('/pedidos/contexto', async (req: Request, res: Response) => {
    try {
      const u = req.usuario!;
      const regra = await regraPlano(u);
      res.json({
        planos: regra.planos,
        planoForcado: regra.planoForcado || null,
        podeLancar: u.idPessoa > 0,
        cliente: regra.cliente
          ? { id: Number(regra.cliente.id), nome: String(regra.cliente.nome ?? '').trim() }
          : null,
      });
    } catch (err) {
      erro(res, err);
    }
  });

  router.get('/pedidos', async (req: Request, res: Response) => {
    try {
      const u = req.usuario!;
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const status = String(req.query.status || '');
      const busca = String(req.query.busca || '').trim().toUpperCase();

      const where: string[] = ['1 = 1'];
      if (u.idPessoa > 0) where.push(`W.ID_EMPRESA = ${sqlInteiro(u.idPessoa)}`);
      if (['A', 'F', 'X'].includes(status)) where.push(`W.STATUS = ${sqlTexto(status)}`);
      if (status === 'faturado') where.push(`W.FATURADO = 'S'`);
      if (busca) {
        const n = /^\d{1,9}$/.test(busca) ? Number(busca) : -1;
        where.push(
          `(W.ID = ${n} OR UPPER(W.DESCRICAO) LIKE ${sqlTexto(`%${busca}%`)} OR W.NUMERO_PEDIDO = ${sqlTexto(busca)}
            OR UPPER(P.NOME) LIKE ${sqlTexto(`%${busca}%`)})`,
        );
      }
      const whereSql = where.join(' AND ');

      const contagem = await consultarUm(
        `SELECT COUNT(*) total FROM WEB_PEDIDOS W LEFT JOIN PESSOAS P ON P.ID = W.ID_EMPRESA WHERE ${whereSql}`,
      );
      const total = Number(contagem?.total || 0);

      // DBISAM não tem OFFSET: busca até o fim da página e descarta o início
      const rows = await consultar(`${SELECT_PEDIDO} WHERE ${whereSql} ORDER BY W.ID DESC TOP ${page * limit}`);
      const pagina = rows.slice((page - 1) * limit).map(mapearPedido);

      res.json({ data: pagina, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
    } catch (err) {
      erro(res, err);
    }
  });

  router.post('/pedidos/sincronizar', async (req: Request, res: Response) => {
    try {
      res.json(await sincronizarStatus(req.usuario!));
    } catch (err) {
      erro(res, err);
    }
  });

  router.get('/pedidos/:id', async (req: Request, res: Response) => {
    try {
      const pedido = await carregarPedido(Number(req.params.id), req.usuario!);
      res.json({ ...pedido, itens: await carregarItens(pedido.id) });
    } catch (err) {
      erro(res, err);
    }
  });

  router.post('/pedidos', async (req: Request, res: Response) => {
    try {
      const u = req.usuario!;
      const regra = await consistirNovoPedido(u);

      const idPlano = regra.planoForcado || Math.trunc(Number(req.body?.idPlano) || 0);
      const perc = idPlano ? await percDescontoPlano(idPlano) : null;
      if (!idPlano || perc === null || !regra.planos.some((p) => p.id === idPlano)) {
        throw new BmapiError('Plano de pagamento inválido!');
      }

      const descricao = String(req.body?.descricao || '').trim().toUpperCase().slice(0, 120);
      const obs = String(req.body?.obs || '');

      const novo = await consultarUm(`
        SELECT ID FROM WEB_PEDIDOS WHERE ID = -1;
        INSERT INTO WEB_PEDIDOS (ID_EMPRESA, ID_PLANO, DATA, EXPIRA_EM, DESCRICAO, OBS, TOTAL_PRODUTOS, TOTAL_IPI, TOTAL_ST,
                                 TOTAL_FRETE, TOTAL_PEDIDO, STATUS, ID_USUARIO, DATAHORA_EVENTO, PERC_DESCONTOS, TOTAL_DESCONTOS)
        VALUES (${sqlInteiro(u.idPessoa)}, ${sqlInteiro(idPlano)}, CURRENT_DATE, ${sqlDataHora(`${hojeISO()} 23:59:59`)},
                ${sqlTexto(descricao)}, ${obs ? sqlTexto(obs) : 'NULL'}, 0, 0, 0, 0, 0, '${STATUS_ABERTO}',
                ${sqlInteiro(u.id)}, ${sqlDataHora(agoraISO())}, ${sqlNumero(perc)}, 0);
        SELECT ID id FROM WEB_PEDIDOS WHERE ID_USUARIO = ${sqlInteiro(u.id)} ORDER BY ID DESC TOP 1`);

      res.json({ success: true, id: Number(novo?.id) });
    } catch (err) {
      erro(res, err);
    }
  });

  router.put('/pedidos/:id', async (req: Request, res: Response) => {
    try {
      const u = req.usuario!;
      const pedido = await carregarPedido(Number(req.params.id), u);
      exigirAberto(pedido);

      const regra = await regraPlano(u);
      let idPlano = Math.trunc(Number(req.body?.idPlano ?? pedido.idPlano) || 0);
      let aviso: string | undefined;
      if (regra.planoForcado && idPlano !== regra.planoForcado) {
        idPlano = regra.planoForcado;
        aviso = 'A condição de pagamento foi alterada para a condição padrão!';
      }
      const perc = idPlano ? await percDescontoPlano(idPlano) : null;
      if (!idPlano || perc === null) throw new BmapiError('Plano de pagamento inválido!');

      const descricao = String(req.body?.descricao ?? pedido.descricao).trim().toUpperCase().slice(0, 120);
      const obs = String(req.body?.obs ?? pedido.obs);

      await executar(`
        UPDATE WEB_PEDIDOS
           SET DESCRICAO = ${sqlTexto(descricao)}, OBS = ${obs ? sqlTexto(obs) : 'NULL'},
               ID_PLANO = ${sqlInteiro(idPlano)}, DATAHORA_EVENTO = CURRENT_TIMESTAMP
         WHERE ID = ${sqlInteiro(pedido.id)}`);
      await totalizar(pedido.id);

      res.json({ success: true, aviso });
    } catch (err) {
      erro(res, err);
    }
  });

  router.delete('/pedidos/:id', async (req: Request, res: Response) => {
    try {
      const pedido = await carregarPedido(Number(req.params.id), req.usuario!);
      if (pedido.status !== STATUS_ABERTO) throw new BmapiError('Status do pedido inválido!');

      const itens = await carregarItens(pedido.id);
      const comandos = itens.filter((i) => i.idRef && i.qtdade).map((i) => sqlAjusteReserva(i.idRef, -i.qtdade));
      comandos.push(`DELETE FROM WEB_PEDIDOS_PRO WHERE ID_PEDIDO = ${sqlInteiro(pedido.id)}`);
      comandos.push(`DELETE FROM WEB_PEDIDOS WHERE ID = ${sqlInteiro(pedido.id)}`);
      await executar(comandos.join(';\n'));

      res.json({ success: true });
    } catch (err) {
      erro(res, err);
    }
  });

  /** Inclui um produto no pedido, reservando a quantidade */
  router.post('/pedidos/:id/itens', async (req: Request, res: Response) => {
    try {
      const u = req.usuario!;
      const pedido = await carregarPedido(Number(req.params.id), u);
      exigirAberto(pedido);

      const idProduto = Math.trunc(Number(req.body?.idProduto) || 0);
      const qtdade = Number(req.body?.qtdade || 0);
      if (!idProduto) throw new BmapiError('Informe o produto.');
      if (!(qtdade > 0)) throw new BmapiError('Quantidade inválida!');

      const existente = await consultarUm('SELECT ID id FROM WEB_PEDIDOS_PRO WHERE ID_PEDIDO = :p AND ID_PRO = :pro', {
        p: pedido.id,
        pro: idProduto,
      });
      if (existente) throw new BmapiError('Este produto já está no pedido. Altere a quantidade do item.');

      const ref = await buscarReferencia(idProduto, u);
      if (qtdade > ref.disponivel) {
        throw new BmapiError(`Estoque disponível (${ref.disponivel.toLocaleString('pt-BR')}) insuficiente!`);
      }
      const preco = precoUnitario(ref, u);

      await executar(
        `INSERT INTO WEB_PEDIDOS_PRO (ID_PEDIDO, ID_PRO, ID_REF, REFERENCIA, DESCRICAO_PRO, QTDADE, PRECO_UNIT, PRECO_TOTAL)
         VALUES (:p, :pro, :ref, :r, :d, :q, :pu, :pt)`,
        {
          p: pedido.id,
          pro: idProduto,
          ref: ref.idRef,
          r: ref.referencia.slice(0, 25),
          d: ref.descricao.slice(0, 50),
          q: qtdade,
          pu: preco,
          pt: arredondar(preco * qtdade),
        },
      );
      await ajustarReserva(ref.idRef, qtdade);
      await totalizar(pedido.id);

      res.json({ success: true });
    } catch (err) {
      erro(res, err);
    }
  });

  /** Altera quantidade e/ou observação do item */
  router.put('/pedidos/:id/itens/:itemId', async (req: Request, res: Response) => {
    try {
      const u = req.usuario!;
      const pedido = await carregarPedido(Number(req.params.id), u);
      exigirAberto(pedido);

      const item = await consultarUm(
        'SELECT ID id, ID_PRO id_pro, ID_REF id_ref, QTDADE qtdade FROM WEB_PEDIDOS_PRO WHERE ID = :i AND ID_PEDIDO = :p',
        { i: Number(req.params.itemId), p: pedido.id },
      );
      if (!item) throw new BmapiError('Item não encontrado.', 404);

      if (req.body?.obs !== undefined) {
        await executar('UPDATE WEB_PEDIDOS_PRO SET OBS_PRO = :o WHERE ID = :i', {
          o: String(req.body.obs || '').slice(0, 80),
          i: item.id,
        });
      }

      if (req.body?.qtdade !== undefined) {
        const qtdNova = Number(req.body.qtdade);
        const qtdAnterior = Number(item.qtdade || 0);
        if (!(qtdNova > 0)) {
          throw new BmapiError('Quantidade inválida! Para remover do pedido, exclua o item.');
        }

        const ref = await buscarReferencia(Number(item.id_pro), u);
        const saldo = ref.disponivel + qtdAnterior - qtdNova;
        if (saldo < 0) {
          throw new BmapiError(
            `Estoque disponível (${(ref.disponivel + qtdAnterior).toLocaleString('pt-BR')}) insuficiente!`,
          );
        }

        const preco = precoUnitario(ref, u);
        await executar(
          'UPDATE WEB_PEDIDOS_PRO SET QTDADE = :q, PRECO_UNIT = :pu, PRECO_TOTAL = :pt, ID_REF = :ref, REFERENCIA = :r WHERE ID = :i',
          {
            q: qtdNova,
            pu: preco,
            pt: arredondar(preco * qtdNova),
            ref: ref.idRef,
            r: ref.referencia.slice(0, 25),
            i: item.id,
          },
        );
        await ajustarReserva(ref.idRef, qtdNova - qtdAnterior);
        await totalizar(pedido.id);
      }

      res.json({ success: true });
    } catch (err) {
      erro(res, err);
    }
  });

  router.delete('/pedidos/:id/itens/:itemId', async (req: Request, res: Response) => {
    try {
      const pedido = await carregarPedido(Number(req.params.id), req.usuario!);
      if (pedido.status !== STATUS_ABERTO) throw new BmapiError('Status do pedido inválido!');

      const item = await consultarUm(
        'SELECT ID id, ID_REF id_ref, QTDADE qtdade FROM WEB_PEDIDOS_PRO WHERE ID = :i AND ID_PEDIDO = :p',
        { i: Number(req.params.itemId), p: pedido.id },
      );
      if (!item) throw new BmapiError('Item não encontrado.', 404);

      await executar('DELETE FROM WEB_PEDIDOS_PRO WHERE ID = :i', { i: item.id });
      await ajustarReserva(Number(item.id_ref || 0), -Number(item.qtdade || 0));
      await totalizar(pedido.id);

      res.json({ success: true });
    } catch (err) {
      erro(res, err);
    }
  });

  /**
   * Captura o pré-pedido do usuário para dentro do pedido (btnCapturarPreparaClick).
   * A reserva já foi feita na pesquisa, então aqui não mexe em RESV_DAV.
   */
  router.post('/pedidos/:id/capturar', async (req: Request, res: Response) => {
    try {
      const u = req.usuario!;
      const pedido = await carregarPedido(Number(req.params.id), u);
      exigirAberto(pedido);

      const prepara = await consultar(
        `SELECT A.ID id, A.ID_PRO id_pro, A.ID_REF id_ref, A.QTDADE qtdade, B.DESCRICAO descricao
           FROM WEB_PEDIDOS_PRO_PREPARA A
           LEFT JOIN PRODUTOSPRINCIPAL B ON B.ID = A.ID_PRO
          WHERE A.ID_USUARIO = :u`,
        { u: u.id },
      );
      const noPedido = new Set(
        (await consultar('SELECT ID_PRO id_pro FROM WEB_PEDIDOS_PRO WHERE ID_PEDIDO = :p', { p: pedido.id })).map((r) =>
          Number(r.id_pro),
        ),
      );

      const jaIncluidos: string[] = [];
      const comandos: string[] = [];
      let capturados = 0;

      for (const p of prepara) {
        const qtdade = Number(p.qtdade || 0);
        const idPro = Number(p.id_pro);

        if (qtdade > 0) {
          if (noPedido.has(idPro)) {
            // Fica no pré-pedido (continua reservado) para o usuário resolver
            jaIncluidos.push(`${idPro} - ${String(p.descricao ?? '').trim()}`);
            continue;
          }
          const ref = await buscarReferencia(idPro, u);
          const preco = precoUnitario(ref, u);
          comandos.push(
            `INSERT INTO WEB_PEDIDOS_PRO (ID_PEDIDO, ID_PRO, ID_REF, REFERENCIA, DESCRICAO_PRO, QTDADE, PRECO_UNIT, PRECO_TOTAL)
             VALUES (${sqlInteiro(pedido.id)}, ${sqlInteiro(idPro)}, ${sqlInteiro(p.id_ref)}, ${sqlTexto(ref.referencia, 25)},
                     ${sqlTexto(ref.descricao, 50)}, ${sqlNumero(qtdade)}, ${sqlNumero(preco)}, ${sqlNumero(arredondar(preco * qtdade))})`,
          );
          noPedido.add(idPro);
          capturados++;
        }
        comandos.push(`DELETE FROM WEB_PEDIDOS_PRO_PREPARA WHERE ID = ${sqlInteiro(p.id)}`);
      }

      if (comandos.length) await executar(comandos.join(';\n'));
      await totalizar(pedido.id);

      res.json({ success: true, capturados, jaIncluidos });
    } catch (err) {
      erro(res, err);
    }
  });

  router.put('/pedidos/:id/entrega', async (req: Request, res: Response) => {
    try {
      const pedido = await carregarPedido(Number(req.params.id), req.usuario!);
      exigirAberto(pedido);

      const data = String(req.body?.data || '').slice(0, 10);
      const obs = String(req.body?.obs || '').slice(0, 80);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < hojeISO()) throw new BmapiError('Data inválida!');

      await executar('UPDATE WEB_PEDIDOS SET ENTREGA_DATA = :d, ENTREGA_OBS = :o WHERE ID = :id', {
        d: data,
        o: obs,
        id: pedido.id,
      });
      res.json({ success: true });
    } catch (err) {
      erro(res, err);
    }
  });

  router.post('/pedidos/:id/fechar', async (req: Request, res: Response) => {
    try {
      const resultado = await fecharPedido(Number(req.params.id), { usuario: req.usuario! });
      await sincronizarStatus(req.usuario!).catch(() => {});
      res.json({ success: true, ...resultado });
    } catch (err) {
      erro(res, err);
    }
  });

  /** Dados para a impressão do pedido (relat\pedido.fr3 do Delphi) */
  router.get('/pedidos/:id/impressao', async (req: Request, res: Response) => {
    try {
      const pedido = await carregarPedido(Number(req.params.id), req.usuario!);
      const itens = await carregarItens(pedido.id);
      const cliente = await dadosCliente(pedido.idCliente);
      const empresa = await consultarUm(
        `SELECT NOMECONTRIBUINTE nome, FANTASIA fantasia, CGCMF cnpj, IE ie, LOGRADOURO logradouro, NUMERO numero,
                BAIRRO bairro, MUNICIPIO cidade, UF uf, CEP cep, FONE fone, EMAIL email
           FROM EMPRESAS WHERE ID = :id`,
        { id: config.idEmpresa },
      );
      const plano = await consultarUm('SELECT DESCRICAO descricao, NUMEROPARCELAS parcelas FROM PLANOS WHERE ID = :id', {
        id: pedido.idPlano,
      });

      // Parcelas: valor dividido igualmente, diferença de centavos na primeira (DividirMoeda)
      const nParcelas = Math.max(0, Number(plano?.parcelas || 0));
      const parcelas: { seq: number; vencimento: string; valor: number }[] = [];
      if (nParcelas > 0) {
        const prazos = await consultar('SELECT NRPARCELA nr, PRAZO prazo FROM PLANOSPARCELAS WHERE ID_PLANO = :p', {
          p: pedido.idPlano,
        });
        const prazoPorParcela = new Map(prazos.map((p) => [Number(p.nr), Number(p.prazo || 0)]));
        const base = Math.floor((pedido.totalPedido / nParcelas) * 100) / 100;
        const resto = arredondar(pedido.totalPedido - base * nParcelas);
        const dataBase = new Date(`${String(pedido.data).slice(0, 10)}T12:00:00`);
        for (let i = 1; i <= nParcelas; i++) {
          const venc = new Date(dataBase);
          venc.setDate(venc.getDate() + (prazoPorParcela.get(i) ?? 0));
          parcelas.push({
            seq: i,
            vencimento: venc.toISOString().slice(0, 10),
            valor: arredondar(i === 1 ? base + resto : base),
          });
        }
      }

      const limpar = (r: Linha | null) =>
        r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) : null;

      res.json({
        pedido,
        itens,
        cliente: limpar(cliente),
        empresa: limpar(empresa),
        plano: plano ? { descricao: String(plano.descricao ?? '').trim(), parcelas: nParcelas } : null,
        parcelas,
      });
    } catch (err) {
      erro(res, err);
    }
  });

  return router;
}

// ------------------------------------------------------------
// Rotina da meia-noite (estoqueWeb_backend.exe)
// ------------------------------------------------------------
async function rotinaMeiaNoite() {
  console.log('[agendador] Fechando pedidos abertos e desfazendo pré-reservas…');

  // Mesmo filtro do tbPedidos do backend Delphi: tudo que não é F nem X (status vazio conta como aberto)
  const abertos = await consultar(
    `SELECT W.ID id FROM WEB_PEDIDOS W
      WHERE COALESCE(W.STATUS,'') <> '${STATUS_FECHADO}' AND COALESCE(W.STATUS,'') <> '${STATUS_CANCELADO}'
        AND W.ID_EMPRESA > 0 ORDER BY W.ID`,
  );
  for (const p of abertos) {
    try {
      const itens = await consultarUm('SELECT COUNT(*) n FROM WEB_PEDIDOS_PRO WHERE ID_PEDIDO = :p', { p: p.id });
      if (!Number(itens?.n || 0)) continue;
      const r = await fecharPedido(Number(p.id), { automatico: true });
      console.log(`[agendador] Pedido ${p.id} fechado (DAV ${r.numero}).`);
    } catch (err: any) {
      console.error(`[agendador] Falha ao fechar o pedido ${p.id}:`, err.message);
    }
  }

  // btnExcluirPreReservasClick: devolve as reservas e apaga os pré-pedidos
  const prepara = await consultar('SELECT ID id, ID_REF id_ref, QTDADE qtdade FROM WEB_PEDIDOS_PRO_PREPARA');
  const comandos = prepara
    .filter((p) => Number(p.qtdade || 0) > 0)
    .map((p) => sqlAjusteReserva(Number(p.id_ref), -Number(p.qtdade)));
  comandos.push('DELETE FROM WEB_PEDIDOS_PRO_PREPARA');
  await executar(comandos.join(';\n'));

  await sincronizarStatus(null).catch(() => {});
  console.log('[agendador] Concluído.');
}

/**
 * Roda a rotina em cada servidor de AGENDADOR_SERVIDOR (ex.: "1" ou "1,3"); a falha
 * de um não impede os outros. Chamada pelo timer local e pelo Cron da Vercel.
 */
export async function executarRotinaMeiaNoite() {
  const resultado: Record<number, string> = {};
  for (const numero of config.agendadorServidores) {
    try {
      const servidor = await buscarServidor(numero);
      if (!servidor) throw new Error(`servidor ${numero} não encontrado no cadastro`);
      await comServidor(servidor, () => rotinaMeiaNoite());
      resultado[numero] = 'ok';
    } catch (err: any) {
      console.error(`[agendador] Erro no servidor ${numero}:`, err.message);
      resultado[numero] = err.message;
    }
  }
  return resultado;
}

export function iniciarAgendador() {
  if (!config.agendadorMeiaNoite) return;
  if (!config.agendadorServidores.length) {
    console.warn('[agendador] AGENDADOR_SERVIDOR não informado: rotina da meia-noite desativada.');
    return;
  }

  const agendar = () => {
    const agora = new Date();
    const proxima = new Date(agora);
    proxima.setHours(24, 0, 5, 0);
    setTimeout(async () => {
      await executarRotinaMeiaNoite();
      agendar();
    }, proxima.getTime() - agora.getTime());
  };

  agendar();
  console.log(`[agendador] Rotina da meia-noite ativada nos servidores ${config.agendadorServidores.join(', ')}.`);
}
