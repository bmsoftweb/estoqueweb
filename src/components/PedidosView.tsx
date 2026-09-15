import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Loader2,
  Inbox,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  ShoppingBasket,
  Truck,
  Lock,
  Printer,
  PackagePlus,
  MessageSquareText,
  RefreshCw,
  X,
  Receipt,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { ContextoPedidos, ItemPedido, Pedido, PedidoDetalhe, ProdutoPesquisa, Usuario } from '../types';
import {
  alterarItem,
  alterarPedido,
  capturarPrePedido,
  criarPedido,
  excluirItem,
  excluirPedido,
  fecharPedido,
  fetchContextoPedidos,
  fetchPedido,
  incluirItem,
  listarPedidos,
  pesquisarEstoque,
  salvarEntrega,
  sincronizarPedidos,
} from '../services/api';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import {
  CLASSE_FATURADO,
  STATUS_PEDIDO,
  formatCurrencyBRL,
  formatDateBR,
  formatDecimal,
  formatQtd,
  hojeISO,
} from '../utils/formatters';
import { ConfirmDialog, MensagemErro, Modal, BOTAO_PRIMARIO, BOTAO_SECUNDARIO, BOTAO_SUCESSO } from './Modal';
import { DateField } from './DateField';
import { ImpressaoPedidoModal } from './ImpressaoPedido';

interface PedidosViewProps {
  usuario: Usuario;
  /** false enquanto a tela está escondida por trás de outra (mantém lista e pedido aberto) */
  ativo: boolean;
  refreshToken: number;
  createToken: number;
  onToast: (msg: string) => void;
  onPrePedidoAlterado: () => void;
}

type Confirmacao =
  | { tipo: 'excluirPedido' }
  | { tipo: 'fechar' }
  | { tipo: 'excluirItem'; item: ItemPedido };

export const BadgeStatus: React.FC<{ status: string; faturado?: boolean }> = ({ status, faturado }) => {
  const s = STATUS_PEDIDO[status] ?? STATUS_PEDIDO.A;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${s.classe}`}>{s.label}</span>
      {faturado && (
        <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${CLASSE_FATURADO}`}>
          Faturado
        </span>
      )}
    </span>
  );
};

export const PedidosView: React.FC<PedidosViewProps> = ({ usuario, ativo, refreshToken, createToken, onToast, onPrePedidoAlterado }) => {
  const [contexto, setContexto] = useState<ContextoPedidos | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaInput, setBuscaInput] = useState('');
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);

  const [idSelecionado, setIdSelecionado] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<PedidoDetalhe | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [erroDetalhe, setErroDetalhe] = useState<string | null>(null);

  const [formPedido, setFormPedido] = useState<'novo' | 'editar' | null>(null);
  const [buscaProduto, setBuscaProduto] = useState(false);
  const [entregaAberta, setEntregaAberta] = useState(false);
  const [obsItem, setObsItem] = useState<ItemPedido | null>(null);
  const [impressao, setImpressao] = useState<number | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erroConfirmacao, setErroConfirmacao] = useState<string | null>(null);

  const carregarLista = useCallback(async () => {
    setCarregandoLista(true);
    setErroLista(null);
    try {
      const r = await listarPedidos({ page, limit: 50, status, busca });
      setPedidos(r.data);
      setTotal(r.total);
      setTotalPages(r.totalPages);
      setIdSelecionado((atual) => atual ?? r.data[0]?.id ?? null);
    } catch (e: any) {
      setErroLista(e.message);
    } finally {
      setCarregandoLista(false);
    }
  }, [page, status, busca]);

  const carregarDetalhe = useCallback(async (id: number | null) => {
    if (!id) {
      setDetalhe(null);
      return;
    }
    setCarregandoDetalhe(true);
    setErroDetalhe(null);
    try {
      setDetalhe(await fetchPedido(id));
    } catch (e: any) {
      setErroDetalhe(e.message);
      setDetalhe(null);
    } finally {
      setCarregandoDetalhe(false);
    }
  }, []);

  /** Atualiza número, faturamento e cancelamento a partir do ERP (btnAtualizarPedidos) */
  const sincronizar = useCallback(
    async (silencioso = false) => {
      setSincronizando(true);
      try {
        const r = await sincronizarPedidos();
        if (!silencioso) {
          onToast(`Status atualizados: ${r.faturados} faturado(s), ${r.cancelados} cancelado(s).`);
        }
      } catch (e: any) {
        if (!silencioso) onToast(e.message);
      } finally {
        setSincronizando(false);
      }
    },
    [onToast],
  );

  useEffect(() => {
    fetchContextoPedidos()
      .then(setContexto)
      .catch((e) => onToast(e.message));
    sincronizar(true).then(() => carregarLista());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    carregarLista();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, busca]);

  useEffect(() => {
    // Atualizar e "Novo" disparados em outra tela não mexem na tela escondida
    if (refreshToken > 0 && ativo) {
      carregarLista();
      carregarDetalhe(idSelecionado);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => {
    carregarDetalhe(idSelecionado);
  }, [idSelecionado, carregarDetalhe]);

  useEffect(() => {
    if (createToken > 0 && ativo) setFormPedido('novo');
  }, [createToken]);

  const recarregarTudo = async (id: number | null = idSelecionado) => {
    await Promise.all([carregarLista(), carregarDetalhe(id)]);
  };

  const executarConfirmacao = async () => {
    if (!confirmacao || !detalhe) return;
    setOcupado(true);
    setErroConfirmacao(null);
    try {
      if (confirmacao.tipo === 'excluirPedido') {
        await excluirPedido(detalhe.id);
        onToast(`Pedido ${detalhe.id} excluído.`);
        setIdSelecionado(null);
        setDetalhe(null);
        await carregarLista();
      } else if (confirmacao.tipo === 'fechar') {
        const r = await fecharPedido(detalhe.id);
        onToast(`Pedido ${detalhe.id} fechado: DAV nº ${r.numero} gerado no ERP.`);
        await recarregarTudo();
      } else if (confirmacao.tipo === 'excluirItem') {
        await excluirItem(detalhe.id, confirmacao.item.id);
        onToast('Item excluído do pedido.');
        await recarregarTudo();
      }
      setConfirmacao(null);
    } catch (e: any) {
      setErroConfirmacao(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const capturar = async () => {
    if (!detalhe) return;
    setOcupado(true);
    try {
      const r = await capturarPrePedido(detalhe.id);
      if (r.jaIncluidos.length) {
        onToast(`Já estavam no pedido e continuam no pré-pedido: ${r.jaIncluidos.join('; ')}`);
      } else {
        onToast(r.capturados ? `${r.capturados} produto(s) capturado(s) do pré-pedido.` : 'O pré-pedido está vazio.');
      }
      onPrePedidoAlterado();
      await recarregarTudo();
    } catch (e: any) {
      onToast(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const aberto = detalhe?.status === 'A';
  const podeLancar = contexto?.podeLancar ?? usuario.idPessoa > 0;

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0">
      {/* ================= Lista de pedidos ================= */}
      <div className="lg:w-[42%] xl:w-[38%] flex flex-col min-h-0 max-h-[45vh] lg:max-h-none bg-white dark:bg-stone-900 border-b lg:border-b-0 lg:border-r border-stone-200 dark:border-stone-800">
        <div className="px-3 py-2.5 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center gap-2 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setBusca(buscaInput.trim());
            }}
            className="relative flex-1 min-w-[150px]"
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
            <input
              value={buscaInput}
              onChange={(e) => setBuscaInput(e.target.value)}
              placeholder="Nº, descrição ou loja…"
              className={`${INPUT_CLASS} w-full pl-9`}
            />
          </form>
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
            className={`${INPUT_CLASS} cursor-pointer`}
          >
            <option value="">Todos</option>
            <option value="A">Abertos</option>
            <option value="F">Fechados</option>
            <option value="faturado">Faturados</option>
            <option value="X">Cancelados</option>
          </select>
          <button
            onClick={async () => {
              await sincronizar();
              await recarregarTudo();
            }}
            disabled={sincronizando}
            title="Atualizar número do DAV, faturamento e cancelamentos a partir do ERP"
            className="p-2 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${sincronizando ? 'animate-spin' : ''}`} />
          </button>
          {podeLancar && (
            <button onClick={() => setFormPedido('novo')} className={BOTAO_PRIMARIO}>
              <Plus className="w-3.5 h-3.5" /> Novo
            </button>
          )}
        </div>

        {erroLista && <MensagemErro texto={erroLista} className="m-3 shrink-0" />}

        <div className="flex-1 overflow-auto min-h-0">
          {carregandoLista && pedidos.length === 0 ? (
            <div className="py-12 flex items-center justify-center gap-2 text-xs text-stone-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando pedidos…
            </div>
          ) : pedidos.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-2 text-stone-400">
              <Inbox className="w-7 h-7" />
              <span className="text-xs text-stone-600 dark:text-stone-300">Nenhum pedido encontrado</span>
            </div>
          ) : (
            <ul>
              {pedidos.map((p) => {
                const ativo = p.id === idSelecionado;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => setIdSelecionado(p.id)}
                      className={`w-full text-left px-3 py-2.5 border-b border-stone-100 dark:border-stone-800/60 transition-colors cursor-pointer ${
                        ativo ? 'bg-blue-100 dark:bg-blue-950' : 'hover:bg-stone-50 dark:hover:bg-stone-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs font-bold text-stone-800 dark:text-stone-100">#{p.id}</span>
                          <BadgeStatus status={p.status} faturado={p.faturado} />
                        </div>
                        <span className="font-mono text-xs font-semibold text-stone-800 dark:text-stone-100">
                          {formatCurrencyBRL(p.totalPedido)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                        <span className="truncate">
                          {formatDateBR(p.data)}
                          {p.descricao && ` • ${p.descricao}`}
                          {usuario.idPessoa === 0 && p.clienteNome && ` • ${p.clienteNome}`}
                        </span>
                        {p.numeroPedido && <span className="shrink-0 font-mono">DAV {p.numeroPedido}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-3 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-stone-500 dark:text-stone-400">
            {total} pedido(s) • página {page} de {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ================= Detalhe do pedido ================= */}
      <div className="flex-1 flex flex-col min-h-0 bg-stone-50/60 dark:bg-stone-950">
        {erroDetalhe && <MensagemErro texto={erroDetalhe} className="m-4" />}
        {!detalhe && !erroDetalhe && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-stone-400 p-8">
            {carregandoDetalhe ? <Loader2 className="w-5 h-5 animate-spin" /> : <Receipt className="w-8 h-8" />}
            <span className="text-sm text-stone-600 dark:text-stone-300">
              {carregandoDetalhe ? 'Carregando pedido…' : 'Selecione um pedido na lista'}
            </span>
          </div>
        )}

        {detalhe && (
          <>
            {/* Cabeçalho */}
            <div className="p-4 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 shrink-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">Pedido #{detalhe.id}</h3>
                    <BadgeStatus status={detalhe.status} faturado={detalhe.faturado} />
                    {carregandoDetalhe && <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />}
                  </div>
                  <div className="text-xs text-stone-500 dark:text-stone-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{formatDateBR(detalhe.data)}</span>
                    {detalhe.descricao && <span className="font-semibold text-stone-700 dark:text-stone-200">{detalhe.descricao}</span>}
                    <span>{detalhe.clienteNome}</span>
                    <span>Plano: {detalhe.planoDescricao || '—'}</span>
                    {detalhe.numeroPedido && <span>DAV nº {detalhe.numeroPedido}</span>}
                    {detalhe.numeroNf && <span>NF {detalhe.numeroNf}</span>}
                    {detalhe.entregaData && (
                      <span className="text-blue-700 dark:text-blue-400">
                        Entrega {formatDateBR(detalhe.entregaData)}
                        {detalhe.entregaObs && ` • ${detalhe.entregaObs}`}
                      </span>
                    )}
                  </div>
                  {detalhe.obs && <p className="text-[11px] text-stone-500 mt-1 whitespace-pre-line">Obs.: {detalhe.obs}</p>}
                </div>

                <div className="grid grid-cols-3 gap-2 text-right shrink-0">
                  <Totalizador label="Produtos" valor={detalhe.totalProdutos} />
                  <Totalizador
                    label={detalhe.percDescontos ? `Desconto ${formatDecimal(detalhe.percDescontos)}%` : 'Desconto'}
                    valor={detalhe.totalDescontos}
                  />
                  <Totalizador label="Total" valor={detalhe.totalPedido} destaque />
                </div>
              </div>

              {/* Ações */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {aberto && (
                  <>
                    <button onClick={() => setBuscaProduto(true)} disabled={ocupado} className={BOTAO_PRIMARIO}>
                      <PackagePlus className="w-3.5 h-3.5" /> Incluir produto
                    </button>
                    <button onClick={capturar} disabled={ocupado} className={BOTAO_SECUNDARIO} title="Traz para o pedido os produtos que você reservou na pesquisa de estoque">
                      {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingBasket className="w-3.5 h-3.5" />} Capturar pré-pedido
                    </button>
                    <button onClick={() => setFormPedido('editar')} disabled={ocupado} className={BOTAO_SECUNDARIO}>
                      <Pencil className="w-3.5 h-3.5" /> Dados
                    </button>
                    <button onClick={() => setEntregaAberta(true)} disabled={ocupado} className={BOTAO_SECUNDARIO}>
                      <Truck className="w-3.5 h-3.5" /> Entrega
                    </button>
                  </>
                )}
                <button onClick={() => setImpressao(detalhe.id)} className={BOTAO_SECUNDARIO}>
                  <Printer className="w-3.5 h-3.5" /> Imprimir
                </button>
                {aberto && (
                  <>
                    <button
                      onClick={() => {
                        setErroConfirmacao(null);
                        setConfirmacao({ tipo: 'excluirPedido' });
                      }}
                      disabled={ocupado}
                      className={`${BOTAO_SECUNDARIO} hover:!text-rose-600 hover:!border-rose-300`}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Excluir
                    </button>
                    <button
                      onClick={() => {
                        setErroConfirmacao(null);
                        setConfirmacao({ tipo: 'fechar' });
                      }}
                      disabled={ocupado || detalhe.itens.length === 0}
                      className={`${BOTAO_SUCESSO} ml-auto`}
                    >
                      <Lock className="w-3.5 h-3.5" /> Fechar pedido
                    </button>
                  </>
                )}
                {!aberto && (
                  <span className="ml-auto text-[11px] text-stone-500 dark:text-stone-400 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {detalhe.status === 'X' ? 'Pedido cancelado no ERP.' : 'Pedido fechado: não pode mais ser alterado.'}
                  </span>
                )}
              </div>
            </div>

            {/* Itens */}
            <div className="flex-1 overflow-auto min-h-0 bg-white dark:bg-stone-900">
              {detalhe.itens.length === 0 ? (
                <div className="py-14 flex flex-col items-center gap-2 text-stone-400">
                  <Inbox className="w-7 h-7" />
                  <span className="text-xs text-stone-600 dark:text-stone-300">Pedido sem itens.</span>
                  {aberto && (
                    <span className="text-[11px]">Inclua produtos ou capture o pré-pedido feito na pesquisa de estoque.</span>
                  )}
                </div>
              ) : (
                <table className="w-full text-xs border-separate border-spacing-0">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-stone-50 dark:bg-stone-950">
                      {['Código', 'Descrição', 'Marca', 'UN', 'Qtdade', 'Preço unit.', 'Total', 'Peso', ''].map((c, i) => (
                        <th
                          key={i}
                          className={`px-3 py-2 font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap border-b border-stone-200 dark:border-stone-800 ${
                            i >= 4 && i <= 7 ? 'text-right' : 'text-left'
                          }`}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detalhe.itens.map((item) => (
                      <tr key={item.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/50">
                        <td className="px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 font-mono text-stone-500">{item.idProduto}</td>
                        <td className="px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 text-stone-800 dark:text-stone-100">
                          <div className="font-medium">{item.descricao}</div>
                          {item.obs && <div className="text-[10px] text-stone-500">Obs.: {item.obs}</div>}
                        </td>
                        <td className="px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 text-stone-500">{item.marca}</td>
                        <td className="px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 text-stone-500">{item.un}</td>
                        <td className="px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 text-right">
                          {aberto ? (
                            <QuantidadeItem
                              item={item}
                              onGravar={async (qtd) => {
                                try {
                                  await alterarItem(detalhe.id, item.id, { qtdade: qtd });
                                  await recarregarTudo();
                                  return true;
                                } catch (e: any) {
                                  onToast(e.message);
                                  return false;
                                }
                              }}
                            />
                          ) : (
                            <span className="font-mono font-semibold">{formatQtd(item.qtdade)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 text-right font-mono">{formatDecimal(item.precoUnit)}</td>
                        <td className="px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 text-right font-mono font-semibold">
                          {formatDecimal(item.precoTotal)}
                        </td>
                        <td className="px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 text-right font-mono text-stone-500">
                          {item.pesoBrutoTotal ? formatQtd(item.pesoBrutoTotal) : ''}
                        </td>
                        <td className="px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 text-right whitespace-nowrap">
                          {aberto && (
                            <>
                              <button
                                onClick={() => setObsItem(item)}
                                title="Observação do item"
                                className="p-1.5 rounded text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
                              >
                                <MessageSquareText className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setErroConfirmacao(null);
                                  setConfirmacao({ tipo: 'excluirItem', item });
                                }}
                                title="Excluir item"
                                className="p-1.5 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0">
                    <tr className="bg-stone-50 dark:bg-stone-950 font-semibold text-stone-700 dark:text-stone-200">
                      <td className="px-3 py-2 border-t border-stone-200 dark:border-stone-800" colSpan={4}>
                        {detalhe.itens.length} item(ns)
                      </td>
                      <td className="px-3 py-2 border-t border-stone-200 dark:border-stone-800 text-right font-mono">
                        {formatQtd(detalhe.itens.reduce((s, i) => s + i.qtdade, 0))}
                      </td>
                      <td className="px-3 py-2 border-t border-stone-200 dark:border-stone-800" />
                      <td className="px-3 py-2 border-t border-stone-200 dark:border-stone-800 text-right font-mono">
                        {formatDecimal(detalhe.totalProdutos)}
                      </td>
                      <td className="px-3 py-2 border-t border-stone-200 dark:border-stone-800 text-right font-mono">
                        {formatQtd(detalhe.itens.reduce((s, i) => s + i.pesoBrutoTotal, 0))}
                      </td>
                      <td className="border-t border-stone-200 dark:border-stone-800" />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* ================= Janelas ================= */}
      {formPedido && contexto && (
        <PedidoFormModal
          modo={formPedido}
          pedido={formPedido === 'editar' ? detalhe : null}
          contexto={contexto}
          onClose={() => setFormPedido(null)}
          onSalvo={async (id, aviso) => {
            setFormPedido(null);
            onToast(aviso || (formPedido === 'novo' ? `Pedido ${id} criado.` : 'Pedido atualizado.'));
            if (formPedido === 'novo') {
              setStatus('');
              setBusca('');
              setBuscaInput('');
              setPage(1);
              setIdSelecionado(id);
            }
            await recarregarTudo(id);
          }}
        />
      )}

      {buscaProduto && detalhe && (
        <ProdutoBuscaModal
          onClose={() => setBuscaProduto(false)}
          onIncluir={async (produto, qtd) => {
            await incluirItem(detalhe.id, produto.id, qtd);
            onToast(`${produto.descricao} incluído no pedido.`);
            await recarregarTudo();
          }}
        />
      )}

      {entregaAberta && detalhe && (
        <EntregaModal
          pedido={detalhe}
          onClose={() => setEntregaAberta(false)}
          onSalvo={async () => {
            setEntregaAberta(false);
            onToast('Entrega registrada.');
            await carregarDetalhe(detalhe.id);
          }}
        />
      )}

      {obsItem && detalhe && (
        <ObsItemModal
          item={obsItem}
          onClose={() => setObsItem(null)}
          onSalvar={async (obs) => {
            await alterarItem(detalhe.id, obsItem.id, { obs });
            setObsItem(null);
            await carregarDetalhe(detalhe.id);
          }}
        />
      )}

      {impressao !== null && <ImpressaoPedidoModal idPedido={impressao} onClose={() => setImpressao(null)} />}

      {confirmacao && detalhe && (
        <ConfirmDialog
          titulo={
            confirmacao.tipo === 'fechar'
              ? 'Fechar o pedido?'
              : confirmacao.tipo === 'excluirPedido'
              ? `Excluir o pedido #${detalhe.id}?`
              : 'Excluir o item?'
          }
          mensagem={
            confirmacao.tipo === 'fechar' ? (
              <>
                O pedido será enviado ao ERP como DAV e <strong>não será mais possível editá-lo</strong>.
                <br />
                Total: <strong>{formatCurrencyBRL(detalhe.totalPedido)}</strong> • {detalhe.itens.length} item(ns) • Plano{' '}
                {detalhe.planoDescricao || '—'}
              </>
            ) : confirmacao.tipo === 'excluirPedido' ? (
              'Os itens serão removidos e a reserva de estoque deles será liberada.'
            ) : (
              <>
                <strong>{confirmacao.item.descricao}</strong> ({formatQtd(confirmacao.item.qtdade)} {confirmacao.item.un}) será removido e a
                reserva liberada.
              </>
            )
          }
          textoConfirmar={ocupado ? 'Aguarde…' : confirmacao.tipo === 'fechar' ? 'Fechar pedido' : 'Excluir'}
          perigo={confirmacao.tipo !== 'fechar'}
          ocupado={ocupado}
          erro={erroConfirmacao}
          onConfirmar={executarConfirmacao}
          onCancelar={() => setConfirmacao(null)}
        />
      )}
    </div>
  );
};

const Totalizador: React.FC<{ label: string; valor: number; destaque?: boolean }> = ({ label, valor, destaque }) => (
  <div
    className={`rounded-xl border px-3 py-1.5 ${
      destaque
        ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-900'
        : 'bg-stone-50 border-stone-200 dark:bg-stone-800/50 dark:border-stone-700'
    }`}
  >
    <div className="text-[10px] text-stone-500 dark:text-stone-400 whitespace-nowrap">{label}</div>
    <div className={`font-mono text-sm font-bold ${destaque ? 'text-blue-700 dark:text-blue-300' : 'text-stone-800 dark:text-stone-100'}`}>
      {formatDecimal(valor)}
    </div>
  </div>
);

/**
 * Quantidade editável do item: grava com Enter ou ao sair do campo.
 * As setas (botões ou ↑ ↓ do teclado) somam/subtraem 1 e gravam após uma pausa,
 * para vários cliques seguidos virarem uma única gravação. O mínimo é 1: para
 * tirar o produto do pedido, exclui-se o item.
 */
const QuantidadeItem: React.FC<{ item: ItemPedido; onGravar: (qtd: number) => Promise<boolean> }> = ({ item, onGravar }) => {
  const original = formatQtd(item.qtdade);
  const [valor, setValor] = useState(String(item.qtdade));
  const [gravando, setGravando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setValor(String(item.qtdade)), [item.qtdade]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const confirmar = async (texto: string = valor) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const qtd = Number(texto.replace(',', '.'));
    if (qtd === item.qtdade) return;
    if (!(qtd > 0)) {
      setValor(String(item.qtdade));
      return;
    }
    setGravando(true);
    const ok = await onGravar(qtd);
    setGravando(false);
    if (!ok) setValor(String(item.qtdade));
  };

  const ajustar = (delta: number) => {
    const atual = Number(valor.replace(',', '.')) || 0;
    const novo = Math.max(1, Math.round((atual + delta) * 1000) / 1000);
    const texto = String(novo);
    setValor(texto);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => confirmar(texto), 700);
  };

  const botaoSeta =
    'flex-1 px-1 flex items-center justify-center text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:text-stone-400 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer';

  return (
    <div className="inline-flex items-center gap-1 justify-end" title={`Quantidade atual: ${original}`}>
      {gravando && <Loader2 className="w-3 h-3 animate-spin text-blue-600" />}
      <input
        value={valor}
        disabled={gravando}
        inputMode="decimal"
        onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, '').slice(0, 9))}
        onBlur={() => confirmar()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            ajustar(e.key === 'ArrowUp' ? 1 : -1);
          }
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            if (timer.current) clearTimeout(timer.current);
            setValor(String(item.qtdade));
            setTimeout(() => (e.target as HTMLInputElement).blur());
          }
        }}
        className={`${INPUT_CLASS} w-16 !py-1 text-right font-mono font-semibold`}
      />
      <div className="flex flex-col self-stretch border border-stone-200 dark:border-stone-700 divide-y divide-stone-200 dark:divide-stone-700">
        <button
          type="button"
          tabIndex={-1}
          disabled={gravando}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => ajustar(1)}
          title="Aumentar"
          className={botaoSeta}
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={gravando || (Number(valor.replace(',', '.')) || 0) <= 1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => ajustar(-1)}
          title="Diminuir (mínimo 1; para tirar do pedido, exclua o item)"
          className={botaoSeta}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------
// Janelas auxiliares
// ------------------------------------------------------------
const PedidoFormModal: React.FC<{
  modo: 'novo' | 'editar';
  pedido: PedidoDetalhe | null;
  contexto: ContextoPedidos;
  onClose: () => void;
  onSalvo: (id: number, aviso?: string) => void;
}> = ({ modo, pedido, contexto, onClose, onSalvo }) => {
  const [descricao, setDescricao] = useState(pedido?.descricao ?? '');
  const [obs, setObs] = useState(pedido?.obs ?? '');
  const [idPlano, setIdPlano] = useState<number>(contexto.planoForcado ?? pedido?.idPlano ?? 0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      if (modo === 'novo') {
        const r = await criarPedido({ descricao, obs, idPlano });
        onSalvo(r.id);
      } else if (pedido) {
        const r = await alterarPedido(pedido.id, { descricao, obs, idPlano });
        onSalvo(pedido.id, r.aviso);
      }
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      titulo={modo === 'novo' ? 'Novo pedido' : `Dados do pedido #${pedido?.id}`}
      subtitulo={contexto.cliente ? `Loja: ${contexto.cliente.nome}` : undefined}
      onClose={onClose}
      bloqueado={salvando}
    >
      <form onSubmit={salvar} className="p-5 space-y-4">
        {erro && <MensagemErro texto={erro} />}
        <div className={FIELD_CLASS}>
          <label className={LABEL_CLASS}>Descrição</label>
          <input
            autoFocus
            value={descricao}
            maxLength={120}
            onChange={(e) => setDescricao(e.target.value.toUpperCase())}
            placeholder="Identificação do pedido para a loja"
            className={`${INPUT_CLASS} w-full`}
          />
        </div>
        <div className={FIELD_CLASS}>
          <label className={LABEL_CLASS}>
            Plano de pagamento <span className="text-rose-500">*</span>
          </label>
          <select
            required
            value={idPlano || ''}
            disabled={Boolean(contexto.planoForcado)}
            onChange={(e) => setIdPlano(Number(e.target.value))}
            className={`${INPUT_CLASS} w-full cursor-pointer disabled:opacity-70`}
          >
            <option value="">— Selecione —</option>
            {contexto.planos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.descricao}
                {p.juros < 0 ? ` (desconto ${formatDecimal(Math.abs(p.juros))}%)` : ''}
              </option>
            ))}
          </select>
          {contexto.planoForcado ? (
            <p className={HINT_CLASS}>Condição padrão do cadastro da loja.</p>
          ) : (
            contexto.planos.length === 0 && <p className={HINT_CLASS}>Nenhum plano liberado para esta loja. Fale com a Central.</p>
          )}
        </div>
        <div className={FIELD_CLASS}>
          <label className={LABEL_CLASS}>Observações</label>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={4} maxLength={500} className={`${INPUT_CLASS} w-full resize-y`} />
        </div>
        <div className="flex justify-end gap-2.5 pt-1">
          <button type="button" onClick={onClose} disabled={salvando} className={BOTAO_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={salvando} className={BOTAO_PRIMARIO}>
            {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {modo === 'novo' ? 'Criar pedido' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

/** Pesquisa de produto para incluir no pedido (Pesquisa(11) do Delphi) */
const ProdutoBuscaModal: React.FC<{
  onClose: () => void;
  onIncluir: (produto: ProdutoPesquisa, qtd: number) => Promise<void>;
}> = ({ onClose, onIncluir }) => {
  const [texto, setTexto] = useState('');
  const [produtos, setProdutos] = useState<ProdutoPesquisa[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [escolhido, setEscolhido] = useState<ProdutoPesquisa | null>(null);
  const [qtd, setQtd] = useState('');
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pesquisar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setCarregando(true);
    setErro(null);
    try {
      const r = await pesquisarEstoque(texto, 'com', false);
      setProdutos(r.produtos);
      setEscolhido(null);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  };

  const incluir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escolhido) return;
    const n = Number(qtd.replace(',', '.'));
    if (!(n > 0)) {
      setErro('Informe a quantidade.');
      return;
    }
    setGravando(true);
    setErro(null);
    try {
      await onIncluir(escolhido, n);
      setEscolhido(null);
      setQtd('');
      await pesquisar();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setGravando(false);
    }
  };

  return (
    <Modal titulo="Incluir produto no pedido" subtitulo="Somente produtos com estoque disponível" onClose={onClose} largura="xl" bloqueado={gravando}>
      <div className="p-4 border-b border-stone-200 dark:border-stone-800 space-y-3 sticky top-0 bg-white dark:bg-stone-900 z-10">
        <form onSubmit={pesquisar} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
            <input
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value.toUpperCase())}
              placeholder="Descrição, marca, referência ou código…"
              className={`${INPUT_CLASS} w-full pl-9`}
            />
          </div>
          <button type="submit" disabled={carregando} className={BOTAO_PRIMARIO}>
            {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Pesquisar
          </button>
        </form>
        {erro && <MensagemErro texto={erro} />}
        {escolhido && (
          <form onSubmit={incluir} className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900">
            <div className="flex-1 min-w-[200px] text-xs">
              <div className="font-semibold text-stone-800 dark:text-stone-100">{escolhido.descricao}</div>
              <div className="text-stone-500">
                Disponível {formatQtd(escolhido.disponivel)} {escolhido.un} • Preço {formatDecimal(escolhido.emPromocao ? escolhido.promocao : escolhido.precoVenda)}
              </div>
            </div>
            <input
              autoFocus
              value={qtd}
              inputMode="decimal"
              onChange={(e) => setQtd(e.target.value.replace(/[^\d,.]/g, ''))}
              placeholder="Qtdade"
              className={`${INPUT_CLASS} w-24 text-right font-mono`}
            />
            <button type="submit" disabled={gravando} className={BOTAO_PRIMARIO}>
              {gravando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Incluir
            </button>
            <button type="button" onClick={() => setEscolhido(null)} className="p-1.5 text-stone-400 hover:text-stone-700 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>

      {produtos === null ? (
        <div className="py-12 text-center text-xs text-stone-400">Pesquise o produto que deseja incluir.</div>
      ) : produtos.length === 0 ? (
        <div className="py-12 text-center text-xs text-stone-400">Nenhum produto com estoque encontrado.</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-stone-50 dark:bg-stone-950">
            <tr className="text-stone-600 dark:text-stone-300">
              <th className="px-3 py-2 text-left font-semibold">Código</th>
              <th className="px-3 py-2 text-left font-semibold">Descrição</th>
              <th className="px-3 py-2 text-left font-semibold">Marca</th>
              <th className="px-3 py-2 text-right font-semibold">Preço</th>
              <th className="px-3 py-2 text-right font-semibold">Disponível</th>
              <th className="px-3 py-2 text-left font-semibold">UN</th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => (
              <tr
                key={`${p.id}-${p.idRef}`}
                onClick={() => {
                  setEscolhido(p);
                  setQtd('');
                }}
                className={`cursor-pointer border-t border-stone-100 dark:border-stone-800 ${
                  escolhido?.id === p.id ? 'bg-blue-100 dark:bg-blue-950' : p.emPromocao ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'hover:bg-stone-50 dark:hover:bg-stone-800'
                }`}
              >
                <td className="px-3 py-1.5 font-mono text-stone-500">{p.id}</td>
                <td className="px-3 py-1.5 text-stone-800 dark:text-stone-100">{p.descricao}</td>
                <td className="px-3 py-1.5 text-stone-500">{p.marca}</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatDecimal(p.emPromocao ? p.promocao : p.precoVenda)}</td>
                <td className="px-3 py-1.5 text-right font-mono font-bold text-blue-700 dark:text-blue-400">{formatQtd(p.disponivel)}</td>
                <td className="px-3 py-1.5 text-stone-500">{p.un}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
};

const EntregaModal: React.FC<{ pedido: Pedido; onClose: () => void; onSalvo: () => void }> = ({ pedido, onClose, onSalvo }) => {
  const [data, setData] = useState(pedido.entregaData ? String(pedido.entregaData).slice(0, 10) : hojeISO());
  const [obs, setObs] = useState(pedido.entregaObs);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data || data < hojeISO()) {
      setErro('Data inválida! A entrega não pode ser anterior a hoje.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await salvarEntrega(pedido.id, data, obs);
      onSalvo();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal titulo={`Entrega do pedido #${pedido.id}`} onClose={onClose} largura="sm" bloqueado={salvando}>
      <form onSubmit={salvar} className="p-5 space-y-4">
        {erro && <MensagemErro texto={erro} />}
        <div className={FIELD_CLASS}>
          <label className={LABEL_CLASS}>
            Data da entrega <span className="text-rose-500">*</span>
          </label>
          <DateField value={data} onChange={setData} required className={`${INPUT_CLASS} w-full`} />
        </div>
        <div className={FIELD_CLASS}>
          <label className={LABEL_CLASS}>Observação da entrega</label>
          <input value={obs} maxLength={80} onChange={(e) => setObs(e.target.value)} className={`${INPUT_CLASS} w-full`} />
          <p className={HINT_CLASS}>Vai no texto de cada item do DAV ao fechar o pedido.</p>
        </div>
        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onClose} disabled={salvando} className={BOTAO_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={salvando} className={BOTAO_PRIMARIO}>
            {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Confirmar
          </button>
        </div>
      </form>
    </Modal>
  );
};

const ObsItemModal: React.FC<{ item: ItemPedido; onClose: () => void; onSalvar: (obs: string) => Promise<void> }> = ({
  item,
  onClose,
  onSalvar,
}) => {
  const [obs, setObs] = useState(item.obs);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <Modal titulo="Observação do item" subtitulo={item.descricao} onClose={onClose} largura="sm" bloqueado={salvando}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSalvando(true);
          setErro(null);
          try {
            await onSalvar(obs);
          } catch (err: any) {
            setErro(err.message);
            setSalvando(false);
          }
        }}
        className="p-5 space-y-4"
      >
        {erro && <MensagemErro texto={erro} />}
        <input autoFocus value={obs} maxLength={80} onChange={(e) => setObs(e.target.value)} className={`${INPUT_CLASS} w-full`} />
        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onClose} disabled={salvando} className={BOTAO_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={salvando} className={BOTAO_PRIMARIO}>
            {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
};
