import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Layers,
  ShoppingBasket,
  Loader2,
  Inbox,
  ImageIcon,
  Camera,
  ArrowUp,
  ArrowDown,
  Info,
  Users,
  Shuffle,
  X,
  RotateCcw,
  List,
  LayoutGrid,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { ProdutoCards } from './ProdutoCards';
import { ClasseProduto, ConfigPublica, FiltroEstoque, ProdutoPesquisa, ReservaCliente, Similar, Usuario } from '../types';
import {
  fetchClasses,
  fetchReservas,
  fetchSimilares,
  gravarPrePedido,
  pesquisarEstoque,
  recalcularAoAbrir,
} from '../services/api';
import { INPUT_CLASS } from '../utils/formStyles';
import { formatDecimal, formatQtd } from '../utils/formatters';
import { Toggle } from './Toggle';
import { MensagemErro, Modal, BOTAO_SECUNDARIO } from './Modal';
import { FotosProdutoModal } from './FotosProdutoModal';

interface EstoqueViewProps {
  usuario: Usuario;
  config: ConfigPublica | null;
  /** false enquanto a tela está escondida por trás de outra (mantém a última consulta) */
  ativo: boolean;
  refreshToken: number;
  onToast: (msg: string) => void;
  /** Avisa o App que o pré-pedido mudou (contador da sidebar) */
  onPrePedidoAlterado: () => void;
}

type ColunaOrdenavel = 'classe' | 'id' | 'descricao' | 'marca' | 'precoVenda' | 'disponivel' | 'reserva' | 'pedido';

const ULTIMA_PESQUISA = 'estoqueweb_ultima_pesquisa';
const VISAO = 'estoqueweb_visao_estoque';

type Visao = 'lista' | 'cards';

function lerVisao(): Visao {
  try {
    return localStorage.getItem(VISAO) === 'cards' ? 'cards' : 'lista';
  } catch {
    return 'lista';
  }
}

function lerUltimaPesquisa(): string {
  try {
    return sessionStorage.getItem(ULTIMA_PESQUISA) || '';
  } catch {
    return '';
  }
}

function salvarUltimaPesquisa(texto: string) {
  try {
    sessionStorage.setItem(ULTIMA_PESQUISA, texto);
  } catch {
    // sem armazenamento, só não lembra a última pesquisa
  }
}

export const EstoqueView: React.FC<EstoqueViewProps> = ({ usuario, config, ativo, refreshToken, onToast, onPrePedidoAlterado }) => {
  const podeEditar = usuario.nivel === 'A' || usuario.nivel === 'G' || usuario.nivel === 'S';
  const podePromocao = podeEditar && usuario.listaPreco === '1';

  const [texto, setTexto] = useState(lerUltimaPesquisa);
  const [filtro, setFiltro] = useState<FiltroEstoque>('com');
  const [somentePromocao, setSomentePromocao] = useState(false);
  const [produtos, setProdutos] = useState<ProdutoPesquisa[] | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [recalculando, setRecalculando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<ProdutoPesquisa | null>(null);
  const [ordem, setOrdem] = useState<{ campo: ColunaOrdenavel; dir: 'asc' | 'desc' } | null>(null);
  const [classesAberto, setClassesAberto] = useState(false);
  const [fotosDe, setFotosDe] = useState<ProdutoPesquisa | null>(null);
  const [visao, setVisao] = useState<Visao>(lerVisao);

  const trocarVisao = (v: Visao) => {
    setVisao(v);
    try {
      localStorage.setItem(VISAO, v);
    } catch {
      // sem armazenamento, só não lembra a escolha
    }
  };
  const inputBusca = useRef<HTMLInputElement>(null);

  const pesquisar = useCallback(
    async (textoBusca: string = texto, filtroBusca: FiltroEstoque = filtro, promocao: boolean = somentePromocao) => {
      setCarregando(true);
      setErro(null);
      salvarUltimaPesquisa(textoBusca.startsWith('*') ? '' : textoBusca);
      try {
        const r = await pesquisarEstoque(textoBusca, filtroBusca, promocao);
        setProdutos(r.produtos);
        setTruncado(r.truncated);
        setSelecionado((atual) => (atual ? r.produtos.find((p) => p.idRef === atual.idRef) ?? null : r.produtos[0] ?? null));
      } catch (e: any) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    },
    [texto, filtro, somentePromocao],
  );

  // Ao abrir, o Delphi recalculava as reservas antes de pesquisar
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        await recalcularAoAbrir();
      } catch (e: any) {
        if (vivo) onToast(`Não foi possível recalcular as reservas: ${e.message}`);
      } finally {
        if (vivo) setRecalculando(false);
      }
      inputBusca.current?.focus();
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // O botão atualizar de outra tela não refaz a pesquisa escondida
    if (refreshToken > 0 && produtos && ativo) pesquisar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const linhas = useMemo(() => {
    if (!produtos) return [];
    if (!ordem) return produtos;
    const fator = ordem.dir === 'asc' ? 1 : -1;
    return [...produtos].sort((a, b) => {
      const va = a[ordem.campo] ?? '';
      const vb = b[ordem.campo] ?? '';
      if (typeof va === 'number' || typeof vb === 'number') return (Number(va) - Number(vb)) * fator;
      return String(va).localeCompare(String(vb), 'pt-BR') * fator;
    });
  }, [produtos, ordem]);

  const temInfo = useMemo(() => Boolean(produtos?.some((p) => p.info)), [produtos]);

  const ordenar = (campo: ColunaOrdenavel) =>
    setOrdem((o) => (o?.campo === campo ? { campo, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' }));

  /** Grava a quantidade do pré-pedido e atualiza a linha com o disponível devolvido pelo servidor */
  const gravarQuantidade = async (produto: ProdutoPesquisa, qtdade: number): Promise<boolean> => {
    if (!produto.idRef) {
      setErro('Produto sem referência cadastrada.');
      return false;
    }
    try {
      const r = await gravarPrePedido(produto.id, produto.idRef, qtdade);
      setProdutos(
        (prev) =>
          prev?.map((p) =>
            p.idRef === produto.idRef
              ? { ...p, pedido: r.qtdade, disponivel: r.disponivel, reserva: p.reserva + (qtdade - (p.pedido ?? 0)) }
              : p,
          ) ?? null,
      );
      setSelecionado((s) => (s && s.idRef === produto.idRef ? { ...s, pedido: r.qtdade, disponivel: r.disponivel } : s));
      onPrePedidoAlterado();
      return true;
    } catch (e: any) {
      onToast(e.message);
      return false;
    }
  };

  const cabecalho = (label: string, campo?: ColunaOrdenavel, alinhar: 'left' | 'right' = 'left') => (
    <th
      onClick={campo ? () => ordenar(campo) : undefined}
      className={`px-2.5 py-2 font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 ${
        campo ? 'cursor-pointer select-none hover:bg-stone-100 dark:hover:bg-stone-800/60' : ''
      } ${alinhar === 'right' ? 'text-right' : 'text-left'}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {campo && ordem?.campo === campo &&
          (ordem.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />)}
      </span>
    </th>
  );

  const mostrarPaineis = Boolean(selecionado) && (config?.apresentarEstoque !== false || config?.apresentarSimilares !== false);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      {/* Barra de pesquisa */}
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center gap-2.5 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pesquisar();
          }}
          className="flex items-center gap-2 flex-1 min-w-[260px]"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
            <input
              ref={inputBusca}
              id="estoque-busca"
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value.toUpperCase())}
              placeholder="Descrição, marca, referência ou código…  (.classe  +aplicação  * pré-pedido)"
              title={'Começa com: descrição, marca, referência ou aplicação. Número: também busca pelo código.\n.01.02 = produtos da classe\n+SOJA = pela aplicação\n* = somente os produtos no pré-pedido'}
              className={`${INPUT_CLASS} w-full pl-9`}
            />
          </div>
          <button type="submit" disabled={carregando || recalculando} className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50 whitespace-nowrap">
            {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Pesquisar
          </button>
        </form>

        <button onClick={() => setClassesAberto(true)} className={BOTAO_SECUNDARIO} title="Escolher uma classe de produtos">
          <Layers className="w-3.5 h-3.5" /> Classes
        </button>

        <button
          onClick={() => {
            setTexto('*');
            pesquisar('*', 'todos');
          }}
          className={BOTAO_SECUNDARIO}
          title="Somente os produtos que você colocou no pré-pedido"
        >
          <ShoppingBasket className="w-3.5 h-3.5" /> Meu pré-pedido
        </button>

        <select
          value={filtro}
          onChange={(e) => {
            const f = e.target.value as FiltroEstoque;
            setFiltro(f);
          }}
          title="Filtro de estoque"
          className={`${INPUT_CLASS} cursor-pointer`}
        >
          <option value="com">Com estoque disponível</option>
          <option value="sem">Sem estoque disponível</option>
          <option value="todos">Todos os produtos</option>
          <option value="pre">Com pré-reserva (todas as lojas)</option>
        </select>

        {podePromocao && (
          <Toggle
            checked={somentePromocao}
            onChange={(v) => {
              setSomentePromocao(v);
            }}
            size="sm"
            label="Somente promoção"
          />
        )}

        {/* Lista (grade) ou vitrine (cards) */}
        <div className="ml-auto inline-flex border border-stone-300 dark:border-stone-700 shrink-0" role="group" aria-label="Visualização">
          {(
            [
              { v: 'lista', icone: List, titulo: 'Visão em lista' },
              { v: 'cards', icone: LayoutGrid, titulo: 'Visão em vitrine' },
            ] as const
          ).map(({ v, icone: Icone, titulo }) => (
            <button
              key={v}
              onClick={() => trocarVisao(v)}
              title={titulo}
              aria-pressed={visao === v}
              className={`p-1.5 cursor-pointer transition-colors ${
                visao === v
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                  : 'text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800'
              }`}
            >
              <Icone className="w-4 h-4" />
            </button>
          ))}
        </div>
      </div>

      {recalculando && (
        <div className="px-4 py-2 text-[11px] bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border-b border-amber-200 dark:border-amber-900 flex items-center gap-2 shrink-0">
          <RotateCcw className="w-3.5 h-3.5 animate-spin" /> Recalculando as reservas de estoque…
        </div>
      )}
      {erro && <MensagemErro texto={erro} className="mx-4 mt-3 shrink-0" />}

      {/* Grade de produtos */}
      <div className="flex-1 overflow-auto min-h-0">
        {!produtos && !carregando ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-stone-400 p-8 text-center">
            <Search className="w-8 h-8" />
            <span className="text-sm font-medium text-stone-600 dark:text-stone-300">Pesquise um produto para consultar o estoque</span>
            <span className="text-[11px] max-w-md">
              Digite o começo da descrição, marca ou referência. Use <strong>.classe</strong> para uma classe,{' '}
              <strong>+aplicação</strong> para pesquisar pela aplicação e <strong>*</strong> para ver o seu pré-pedido.
            </span>
          </div>
        ) : visao === 'cards' ? (
          !produtos ? (
            <div className="py-16 flex items-center justify-center gap-2 text-xs text-stone-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Pesquisando…
            </div>
          ) : linhas.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-stone-400">
              <Inbox className="w-8 h-8" />
              <span className="text-sm text-stone-600 dark:text-stone-300">Nenhum produto encontrado</span>
            </div>
          ) : (
            <ProdutoCards
              produtos={linhas}
              selecionado={selecionado}
              podeEditar={podeEditar}
              podePromocao={podePromocao}
              onSelecionar={setSelecionado}
              onVerFotos={(p) => {
                setSelecionado(p);
                setFotosDe(p);
              }}
              renderPedido={(p) => <CampoPedido produto={p} onGravar={gravarQuantidade} onFocus={() => setSelecionado(p)} />}
            />
          )
        ) : (
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr>
                {cabecalho('Classe', 'classe')}
                {cabecalho('Código', 'id', 'right')}
                {cabecalho('Descrição', 'descricao')}
                {temInfo && cabecalho('Info+')}
                {cabecalho('Marca', 'marca')}
                {podeEditar && cabecalho('Preço', 'precoVenda', 'right')}
                {podePromocao && cabecalho('Promoção', undefined, 'right')}
                {cabecalho('Disponível', 'disponivel', 'right')}
                {cabecalho('Reserva', 'reserva', 'right')}
                {cabecalho('UN')}
                {podeEditar && cabecalho('Pedido', 'pedido', 'right')}
                {cabecalho('Imposto')}
              </tr>
            </thead>
            <tbody>
              {carregando && !produtos && (
                <tr>
                  <td colSpan={13} className="py-12 text-center text-stone-500">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Pesquisando…
                  </td>
                </tr>
              )}
              {produtos && linhas.length === 0 && !carregando && (
                <tr>
                  <td colSpan={13} className="py-16 text-center text-stone-400">
                    <Inbox className="w-8 h-8 mx-auto mb-2" />
                    <span className="text-sm text-stone-600 dark:text-stone-300">Nenhum produto encontrado</span>
                  </td>
                </tr>
              )}
              {linhas.map((p) => {
                const ativo = selecionado?.idRef === p.idRef && selecionado?.id === p.id;
                const destaque = p.descricao.includes('#');
                const fundo = ativo
                  ? 'bg-blue-100 dark:bg-blue-950'
                  : destaque
                  ? 'bg-yellow-100/80 dark:bg-yellow-900/30'
                  : p.emPromocao
                  ? 'bg-emerald-50 dark:bg-emerald-950/30'
                  : 'bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800';
                const td = 'px-2.5 py-1.5 border-b border-stone-100 dark:border-stone-800/60 align-middle';
                return (
                  <tr key={`${p.id}-${p.idRef}`} onClick={() => setSelecionado(p)} className={`cursor-pointer transition-colors ${fundo}`}>
                    <td className={`${td} whitespace-nowrap text-stone-500`} title={p.descricaoClasse}>
                      <span className="font-mono">{p.classe}</span>
                      <span className="ml-1.5 text-[10px] hidden 2xl:inline">{p.descricaoClasse}</span>
                    </td>
                    <td className={`${td} text-right font-mono text-stone-500`}>{p.id}</td>
                    <td className={`${td} font-medium text-stone-800 dark:text-stone-100 min-w-[240px]`}>
                      <span className="inline-flex items-center gap-1.5">
                        {p.fotos > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelecionado(p);
                              setFotosDe(p);
                            }}
                            title={`Ver ${p.fotos} foto(s) do produto`}
                            className="p-0.5 -my-0.5 rounded text-blue-600 hover:text-blue-800 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-950 cursor-pointer shrink-0"
                          >
                            <Camera className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {p.descricao}
                      </span>
                    </td>
                    {temInfo && <td className={`${td} text-stone-500`}>{p.info}</td>}
                    <td className={`${td} text-stone-600 dark:text-stone-300 whitespace-nowrap`}>{p.marca}</td>
                    {podeEditar && <td className={`${td} text-right font-mono whitespace-nowrap`}>{formatDecimal(p.precoVenda)}</td>}
                    {podePromocao && (
                      <td className={`${td} text-right font-mono whitespace-nowrap ${p.emPromocao ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-stone-400'}`}>
                        {p.emPromocao ? formatDecimal(p.promocao) : '—'}
                      </td>
                    )}
                    <td className={`${td} text-right font-mono font-bold whitespace-nowrap ${p.disponivel > 0 ? 'text-blue-700 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {formatQtd(p.disponivel)}
                    </td>
                    <td className={`${td} text-right font-mono text-stone-500`}>{p.reserva ? formatQtd(p.reserva) : ''}</td>
                    <td className={`${td} text-stone-500`}>{p.un}</td>
                    {podeEditar && (
                      <td className={`${td} text-right`} onClick={(e) => e.stopPropagation()}>
                        <CampoPedido produto={p} onGravar={gravarQuantidade} onFocus={() => setSelecionado(p)} />
                      </td>
                    )}
                    <td className={`${td} text-stone-500 whitespace-nowrap`}>{p.imposto}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {produtos && (
        <div className="px-4 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 flex items-center justify-between gap-3 shrink-0 text-[11px] text-stone-500 dark:text-stone-400">
          <span>
            {produtos.length} produto(s){truncado && ' • limite atingido: refine a pesquisa'}
            {podeEditar && ' • digite a quantidade na coluna Pedido e tecle Enter para reservar'}
          </span>
          <span className="hidden md:flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-200 dark:bg-emerald-900" /> em promoção
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-yellow-200 dark:bg-yellow-900" /> destaque (#)
            </span>
          </span>
        </div>
      )}

      {mostrarPaineis && selecionado && (
        <PaineisProduto produto={selecionado} config={config} podeVerPreco={podeEditar} />
      )}

      {fotosDe && <FotosProdutoModal produto={fotosDe} onClose={() => setFotosDe(null)} />}

      {classesAberto && (
        <ClassesModal
          onClose={() => setClassesAberto(false)}
          onEscolher={(c) => {
            setClassesAberto(false);
            const t = `.${c.classe}`;
            setTexto(t);
            pesquisar(t);
          }}
        />
      )}
    </div>
  );
};

/**
 * Célula editável "Pedido": grava ao teclar Enter ou sair do campo.
 * As setas (botões ou ↑ ↓ do teclado) somam/subtraem 1 e gravam após uma pausa,
 * para vários cliques seguidos virarem uma única gravação.
 */
const CampoPedido: React.FC<{
  produto: ProdutoPesquisa;
  onGravar: (p: ProdutoPesquisa, qtd: number) => Promise<boolean>;
  onFocus: () => void;
}> = ({ produto, onGravar, onFocus }) => {
  const [valor, setValor] = useState(produto.pedido ? String(produto.pedido) : '');
  const [gravando, setGravando] = useState(false);
  const original = produto.pedido ? String(produto.pedido) : '';
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Máximo: o disponível mais o que este usuário já reservou do produto
  const maximo = Math.max(0, Math.trunc(produto.disponivel + (produto.pedido ?? 0)));

  useEffect(() => {
    setValor(produto.pedido ? String(produto.pedido) : '');
  }, [produto.pedido]);

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
    if (texto === original) return;
    const qtd = texto.trim() === '' ? 0 : Math.trunc(Number(texto));
    if (!Number.isFinite(qtd) || qtd < 0) {
      setValor(original);
      return;
    }
    setGravando(true);
    const ok = await onGravar(produto, qtd);
    setGravando(false);
    if (!ok) setValor(original);
  };

  const ajustar = (delta: number) => {
    const atual = valor.trim() === '' ? 0 : Math.trunc(Number(valor)) || 0;
    const novo = Math.min(maximo, Math.max(0, atual + delta));
    const texto = novo === 0 ? '' : String(novo);
    setValor(texto);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => confirmar(texto), 700);
  };

  const botaoSeta =
    'flex-1 px-1 flex items-center justify-center text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:text-stone-400 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer';

  return (
    <div className="inline-flex items-center gap-1 justify-end">
      {gravando && <Loader2 className="w-3 h-3 animate-spin text-blue-600" />}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={valor}
        disabled={gravando}
        onFocus={onFocus}
        onChange={(e) => setValor(e.target.value.replace(/\D/g, '').slice(0, 7))}
        onBlur={(e) => {
          // Clique numa seta do próprio campo não conta como sair
          if ((e.relatedTarget as HTMLElement | null)?.dataset?.setaPedido !== undefined) return;
          confirmar();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            ajustar(e.key === 'ArrowUp' ? 1 : -1);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-pedido]'));
            const proximo = inputs[inputs.indexOf(e.currentTarget) + 1];
            if (proximo) proximo.focus();
            else e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            setValor(original);
            e.currentTarget.blur();
          }
        }}
        data-pedido
        placeholder="0"
        className={`${INPUT_CLASS} w-14 !py-1 text-right font-mono ${produto.pedido ? '!bg-amber-100 dark:!bg-amber-950/60 font-bold' : ''}`}
      />
      <div className="flex flex-col self-stretch border border-stone-200 dark:border-stone-700 divide-y divide-stone-200 dark:divide-stone-700">
        <button
          type="button"
          data-seta-pedido
          tabIndex={-1}
          disabled={gravando || (Number(valor) || 0) >= maximo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onFocus();
            ajustar(1);
          }}
          title="Aumentar"
          className={botaoSeta}
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          type="button"
          data-seta-pedido
          tabIndex={-1}
          disabled={gravando || !(Number(valor) > 0)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onFocus();
            ajustar(-1);
          }}
          title="Diminuir"
          className={botaoSeta}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

/** Painéis inferiores do produto selecionado: reservas por cliente e similares */
const PaineisProduto: React.FC<{ produto: ProdutoPesquisa; config: ConfigPublica | null; podeVerPreco: boolean }> = ({
  produto,
  config,
  podeVerPreco,
}) => {
  const [reservas, setReservas] = useState<ReservaCliente[] | null>(null);
  const [similares, setSimilares] = useState<Similar[] | null>(null);
  const [recolhido, setRecolhido] = useState(false);
  const mostrarReservas = config?.apresentarEstoque !== false;
  const mostrarSimilares = config?.apresentarSimilares !== false;

  useEffect(() => {
    let vivo = true;
    setReservas(null);
    setSimilares(null);
    const t = setTimeout(() => {
      if (mostrarReservas && produto.idRef) {
        fetchReservas(produto.idRef)
          .then((r) => vivo && setReservas(r))
          .catch(() => vivo && setReservas([]));
      }
      if (mostrarSimilares) {
        fetchSimilares(produto.id)
          .then((s) => vivo && setSimilares(s))
          .catch(() => vivo && setSimilares([]));
      }
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [produto.id, produto.idRef, produto.pedido, mostrarReservas, mostrarSimilares]);

  const totalReservado = reservas?.reduce((s, r) => s + r.total, 0) ?? 0;
  const urlGoogle = `https://www.google.com/search?q=${encodeURIComponent(produto.descricao)}&hl=pt-br&tbm=isch`;

  return (
    <div className={`shrink-0 border-t-2 border-blue-500/60 dark:border-blue-600/60 bg-white dark:bg-stone-900 flex flex-col ${recolhido ? '' : 'h-[32%] min-h-[180px]'}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-1.5 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/60 shrink-0">
        <div className="text-xs min-w-0 truncate">
          <span className="font-mono text-stone-400 mr-2">#{produto.id}</span>
          <strong className="text-stone-800 dark:text-stone-100">{produto.descricao}</strong>
          {produto.referencia && <span className="text-stone-400 ml-2">Ref. {produto.referencia}</span>}
          <span className={`ml-3 font-semibold ${totalReservado > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-stone-400'}`}>
            {reservas === null && mostrarReservas ? '' : totalReservado > 0 ? `${formatQtd(totalReservado)} reservado(s)` : 'Nenhuma reserva'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={urlGoogle}
            target="_blank"
            rel="noreferrer"
            title="Ver fotos do produto no Google Imagens"
            className="p-1.5 rounded text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
          >
            <ImageIcon className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={() => setRecolhido((r) => !r)}
            title={recolhido ? 'Expandir' : 'Recolher'}
            className="p-1.5 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            {recolhido ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {!recolhido && (
        <div className={`flex-1 min-h-0 grid ${mostrarReservas && mostrarSimilares ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'} divide-y md:divide-y-0 md:divide-x divide-stone-200 dark:divide-stone-800`}>
          {mostrarReservas && (
            <div className="flex flex-col min-h-0">
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400 flex items-center gap-1.5 shrink-0">
                <Users className="w-3 h-3" /> Reservas por loja
              </div>
              <div className="flex-1 overflow-auto min-h-0">
                <PainelTabela
                  carregando={reservas === null}
                  vazio="Nenhuma reserva para este produto."
                  cabecalho={['Loja', 'DAV fechados', 'Pedidos web', 'Pré-pedidos', 'Total']}
                  linhas={(reservas ?? []).map((r) => [
                    r.nome,
                    formatQtd(r.fechados),
                    formatQtd(r.abertos),
                    formatQtd(r.fazendo),
                    <strong key="t">{formatQtd(r.total)}</strong>,
                  ])}
                />
              </div>
            </div>
          )}
          {mostrarSimilares && (
            <div className="flex flex-col min-h-0">
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400 flex items-center gap-1.5 shrink-0">
                <Shuffle className="w-3 h-3" /> Produtos similares
              </div>
              <div className="flex-1 overflow-auto min-h-0">
                <PainelTabela
                  carregando={similares === null}
                  vazio="Nenhum produto similar cadastrado."
                  cabecalho={podeVerPreco ? ['Código', 'Descrição', 'Preço', 'UN', 'Disponível'] : ['Código', 'Descrição', 'UN', 'Disponível']}
                  linhas={(similares ?? []).map((s) => {
                    const disp = (
                      <span key="d" className={`font-bold ${s.disponivel > 0 ? 'text-blue-700 dark:text-blue-400' : 'text-rose-600'}`}>
                        {formatQtd(s.disponivel)}
                      </span>
                    );
                    return podeVerPreco
                      ? [String(s.idProduto), s.descricao, formatDecimal(s.preco), s.un, disp]
                      : [String(s.idProduto), s.descricao, s.un, disp];
                  })}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PainelTabela: React.FC<{
  carregando: boolean;
  vazio: string;
  cabecalho: string[];
  linhas: React.ReactNode[][];
}> = ({ carregando, vazio, cabecalho, linhas }) => {
  if (carregando) {
    return (
      <div className="py-6 flex items-center justify-center gap-2 text-[11px] text-stone-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…
      </div>
    );
  }
  if (!linhas.length) {
    return (
      <div className="py-6 flex items-center justify-center gap-2 text-[11px] text-stone-400">
        <Info className="w-3.5 h-3.5" /> {vazio}
      </div>
    );
  }
  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-white dark:bg-stone-900">
        <tr>
          {cabecalho.map((c, i) => (
            <th key={c} className={`px-4 py-1 font-semibold text-stone-500 ${i === 0 || (i === 1 && cabecalho[0] === 'Código') ? 'text-left' : 'text-right'}`}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          <tr key={i} className="border-t border-stone-100 dark:border-stone-800/60">
            {l.map((c, j) => (
              <td
                key={j}
                className={`px-4 py-1 text-stone-700 dark:text-stone-300 ${j === 0 || (j === 1 && cabecalho[0] === 'Código') ? 'text-left' : 'text-right font-mono'}`}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** Pesquisa de classes (frmPesquisaClasses) */
const ClassesModal: React.FC<{ onClose: () => void; onEscolher: (c: ClasseProduto) => void }> = ({ onClose, onEscolher }) => {
  const [busca, setBusca] = useState('');
  const [classes, setClasses] = useState<ClasseProduto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      fetchClasses(busca)
        .then((c) => vivo && setClasses(c))
        .catch((e) => vivo && setErro(e.message));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [busca]);

  return (
    <Modal titulo="Classes de produtos" subtitulo="Escolha uma classe para listar os produtos dela" onClose={onClose} largura="md">
      <div className="p-4 border-b border-stone-200 dark:border-stone-800 sticky top-0 bg-white dark:bg-stone-900">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value.toUpperCase())}
            placeholder="Começo da descrição ou do código da classe…"
            className={`${INPUT_CLASS} w-full pl-9 pr-8`}
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {erro && <MensagemErro texto={erro} className="m-4" />}
      {!classes && !erro && (
        <div className="py-10 flex justify-center text-stone-500">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      )}
      {classes && (
        <ul className="py-1">
          {classes.map((c) => {
            const nivel = Math.max(0, c.classe.split('.').length - 1);
            return (
              <li key={c.id}>
                <button
                  onClick={() => onEscolher(c)}
                  className="w-full text-left px-4 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-center gap-3 cursor-pointer"
                >
                  <span className="font-mono text-stone-400 w-20 shrink-0">{c.classe}</span>
                  <span className={`text-stone-800 dark:text-stone-200 ${nivel === 0 ? 'font-bold' : ''}`} style={{ paddingLeft: `${nivel * 14}px` }}>
                    {c.descricao}
                  </span>
                </button>
              </li>
            );
          })}
          {classes.length === 0 && <li className="px-4 py-6 text-center text-xs text-stone-400">Nenhuma classe encontrada.</li>}
        </ul>
      )}
    </Modal>
  );
};
