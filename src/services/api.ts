import {
  ResourceDef,
  ListaPaginada,
  FiltroAvancado,
  RegistroCrud,
  DbConnectionStatus,
  DashboardData,
  Usuario,
  Empresa,
  ConfigPublica,
  ProdutoPesquisa,
  FiltroEstoque,
  Similar,
  ReservaCliente,
  ClasseProduto,
  ItemPrePedido,
  Pedido,
  PedidoDetalhe,
  ContextoPedidos,
  ImpressaoPedido,
  PlanoLoja,
  ServidorInfo,
  FotoProduto,
} from '../types';

/**
 * O token de sessão acompanha toda requisição no header Authorization.
 * A chave da bmAPI fica só no servidor.
 */
let tokenAtual: string | null = null;
let aoExpirar: ((motivo: string) => void) | null = null;

export function setTokenSessao(token: string | null) {
  tokenAtual = token;
}

/** Chamado quando o servidor recusa a sessão (401), para voltar ao login */
export function onSessaoExpirada(fn: (motivo: string) => void) {
  aoExpirar = fn;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (tokenAtual) h.Authorization = `Bearer ${tokenAtual}`;
  return h;
}

async function parseOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `Falha na requisição (HTTP ${res.status}).`;
    if (res.status === 401 && tokenAtual && aoExpirar) aoExpirar(msg);
    throw new Error(msg);
  }
  return data;
}

async function get<T = any>(url: string): Promise<T> {
  return parseOrThrow(await fetch(url, { headers: headers() }));
}

async function send<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  return parseOrThrow(
    await fetch(url, {
      method,
      headers: headers({ 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

// ------------------------------------------------------------
// Autenticação
// ------------------------------------------------------------
export async function login(
  servidor: number,
  email: string,
  senha: string,
): Promise<{ token: string; usuario: Usuario; empresa: Empresa; servidor: ServidorInfo }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ servidor, email, senha }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Não foi possível entrar.');
  return data;
}

/** Identificação do servidor digitado no login e se a bmAPI dele responde */
export async function consultarServidor(
  numero: number,
): Promise<ServidorInfo & { connected: boolean; error?: string }> {
  const res = await fetch(`/api/servidores/${numero}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Servidor não encontrado.');
  return data;
}

/** Confere a sessão guardada; null em falha de rede (não desloga por instabilidade) */
export async function validarSessao(): Promise<{ usuario: Usuario; empresa: Empresa; servidor: ServidorInfo } | false | null> {
  try {
    const res = await fetch('/api/auth/sessao', { headers: headers() });
    if (res.status === 401) return false;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function salvarMeusDados(dados: { email: string; paginaInicial: string; senha: string; senhaConfirma: string }) {
  return send<{ success: boolean; usuario: Usuario }>('PUT', '/api/auth/meus-dados', dados);
}

// ------------------------------------------------------------
// Painel, configuração e metadados
// ------------------------------------------------------------
export async function fetchDbStatus(): Promise<DbConnectionStatus> {
  try {
    const res = await fetch('/api/db/status', { headers: headers() });
    return await res.json();
  } catch (err: any) {
    return { connected: false, latencyMs: 0, error: err.message || 'Falha ao conectar com o servidor' };
  }
}

export const fetchConfig = () => get<ConfigPublica>('/api/config');
export const fetchDashboard = () => get<DashboardData>('/api/dashboard');
export const fetchResources = () => get<ResourceDef[]>('/api/meta/resources');

// ------------------------------------------------------------
// CRUD genérico
// ------------------------------------------------------------
export async function listRecords(
  resource: string,
  params: { page?: number; limit?: number; search?: string; sort?: string; dir?: 'asc' | 'desc'; filters?: FiltroAvancado[] } = {},
): Promise<ListaPaginada> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.search) qs.set('search', params.search);
  if (params.sort) qs.set('sort', params.sort);
  if (params.dir) qs.set('dir', params.dir);
  if (params.filters && params.filters.length) qs.set('filters', JSON.stringify(params.filters));
  return get(`/api/crud/${resource}?${qs.toString()}`);
}

export const createRecord = (resource: string, payload: RegistroCrud) => send('POST', `/api/crud/${resource}`, payload);
export const updateRecord = (resource: string, id: string, payload: RegistroCrud) =>
  send('PUT', `/api/crud/${resource}/${encodeURIComponent(id)}`, payload);
export const deleteRecord = (resource: string, id: string) => send('DELETE', `/api/crud/${resource}/${encodeURIComponent(id)}`);

export const fetchPlanosLoja = (idPessoa: number) => get<PlanoLoja[]>(`/api/lojas/${idPessoa}/planos`);
export const salvarPlanoLoja = (idPessoa: number, idPlano: number, liberado: boolean) =>
  send('PUT', `/api/lojas/${idPessoa}/planos/${idPlano}`, { liberado });
export const fetchPessoa = (id: number) => get<Record<string, any>>(`/api/pessoas/${id}`);

// ------------------------------------------------------------
// Estoque
// ------------------------------------------------------------
export function pesquisarEstoque(q: string, estoque: FiltroEstoque, promocao: boolean) {
  const qs = new URLSearchParams({ q, estoque, promocao: promocao ? '1' : '0' });
  return get<{ truncated: boolean; produtos: ProdutoPesquisa[] }>(`/api/estoque/pesquisa?${qs.toString()}`);
}

export const recalcularAoAbrir = () => send<{ executado: boolean }>('POST', '/api/estoque/recalcular-ao-abrir');
export const recalcularReservas = () => send('POST', '/api/estoque/recalcular');

export const gravarPrePedido = (idProduto: number, idRef: number, qtdade: number) =>
  send<{ success: boolean; qtdade: number | null; disponivel: number }>('PUT', '/api/estoque/pre-pedido', {
    idProduto,
    idRef,
    qtdade,
  });

export const fetchPrePedido = () => get<ItemPrePedido[]>('/api/estoque/pre-pedido');
export const fetchSimilares = (idProduto: number) => get<Similar[]>(`/api/estoque/similares/${idProduto}`);
export const fetchReservas = (idRef: number) => get<ReservaCliente[]>(`/api/estoque/reservas/${idRef}`);
export const fetchFotosProduto = (idProduto: number) => get<FotoProduto[]>(`/api/estoque/fotos/${idProduto}`);

/** Baixa a imagem com o token de sessão e devolve uma URL local (blob:) para o <img> */
export async function baixarFotoProduto(idFoto: number): Promise<string> {
  const res = await fetch(`/api/estoque/foto/${idFoto}`, { headers: headers() });
  if (!res.ok) await parseOrThrow(res);
  return URL.createObjectURL(await res.blob());
}

/**
 * Miniatura da foto para a visão em cards: baixada uma vez por foto e mantida em
 * memória enquanto a página estiver aberta (trocar de visão não baixa de novo).
 */
const cacheMiniaturas = new Map<number, Promise<string>>();

export function miniaturaFoto(idFoto: number): Promise<string> {
  let p = cacheMiniaturas.get(idFoto);
  if (!p) {
    p = baixarFotoProduto(idFoto);
    p.catch(() => cacheMiniaturas.delete(idFoto));
    cacheMiniaturas.set(idFoto, p);
  }
  return p;
}

export const fetchClasses = (q: string) => get<ClasseProduto[]>(`/api/estoque/classes?q=${encodeURIComponent(q)}`);

// ------------------------------------------------------------
// Pedidos
// ------------------------------------------------------------
export const fetchContextoPedidos = () => get<ContextoPedidos>('/api/pedidos/contexto');

export function listarPedidos(params: { page: number; limit: number; status: string; busca: string }) {
  const qs = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
    status: params.status,
    busca: params.busca,
  });
  return get<ListaPaginada<Pedido>>(`/api/pedidos?${qs.toString()}`);
}

export const sincronizarPedidos = () =>
  send<{ atualizados: number; faturados: number; cancelados: number }>('POST', '/api/pedidos/sincronizar');
export const fetchPedido = (id: number) => get<PedidoDetalhe>(`/api/pedidos/${id}`);
export const criarPedido = (dados: { descricao: string; obs: string; idPlano: number }) =>
  send<{ success: boolean; id: number }>('POST', '/api/pedidos', dados);
export const alterarPedido = (id: number, dados: { descricao: string; obs: string; idPlano: number }) =>
  send<{ success: boolean; aviso?: string }>('PUT', `/api/pedidos/${id}`, dados);
export const excluirPedido = (id: number) => send('DELETE', `/api/pedidos/${id}`);
export const incluirItem = (id: number, idProduto: number, qtdade: number) =>
  send('POST', `/api/pedidos/${id}/itens`, { idProduto, qtdade });
export const alterarItem = (id: number, itemId: number, dados: { qtdade?: number; obs?: string }) =>
  send('PUT', `/api/pedidos/${id}/itens/${itemId}`, dados);
export const excluirItem = (id: number, itemId: number) => send('DELETE', `/api/pedidos/${id}/itens/${itemId}`);
export const capturarPrePedido = (id: number) =>
  send<{ success: boolean; capturados: number; jaIncluidos: string[] }>('POST', `/api/pedidos/${id}/capturar`);
export const salvarEntrega = (id: number, data: string, obs: string) => send('PUT', `/api/pedidos/${id}/entrega`, { data, obs });
export const fecharPedido = (id: number) => send<{ success: boolean; numero: number }>('POST', `/api/pedidos/${id}/fechar`);
export const fetchImpressao = (id: number) => get<ImpressaoPedido>(`/api/pedidos/${id}/impressao`);
