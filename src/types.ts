export type FieldType = 'text' | 'textarea' | 'number' | 'decimal' | 'date' | 'datetime' | 'enum' | 'boolean' | 'password';

export interface FieldDef {
  name: string;
  column?: string;
  expr?: string;
  label: string;
  type: FieldType;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  listed?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  options?: { value: string; label: string }[];
  scale?: number;
  maxLength?: number;
  allowNegative?: boolean;
  width?: 'xs' | 'sm' | 'md' | 'lg';
  /** Não usado neste app; mantido para compatibilidade com componentes do b2b admin */
  ref?: { resource: string; labelField: string };
}

export type ResourceGroup = 'acesso' | 'auditoria';

export interface ResourceDef {
  name: string;
  table: string;
  label: string;
  labelSingular: string;
  description: string;
  icon: string;
  group: ResourceGroup;
  pk: string;
  labelField: string;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  nivel: 'A' | 'G';
  fields: FieldDef[];
}

export type Nivel = 'A' | 'G' | 'S' | 'V' | 'C';

export interface Usuario {
  id: number;
  idPessoa: number;
  idEmpresa: number;
  nome: string;
  email: string;
  nomePessoa: string;
  nivel: Nivel;
  nivelDescricao: string;
  listaPreco: '1' | '2';
  paginaInicial: string;
}

export interface Empresa {
  id: number;
  nome: string;
  fantasia: string;
  apelido: string;
  cnpj: string;
  cidade: string;
  uf: string;
}

export interface ConfigPublica {
  idEmpresa: number;
  apresentarEstoque: boolean;
  apresentarSimilares: boolean;
  consistirFinanceiro: boolean;
  consistirBloqueio: boolean;
  diasEmAtraso: number;
}

export type RegistroCrud = Record<string, any>;

export type FiltroOp = 'contains' | 'eq' | 'ne' | 'gte' | 'lte';

export interface FiltroAvancado {
  field: string;
  op: FiltroOp;
  value: string;
}

export interface ListaPaginada<T = RegistroCrud> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Mantido para os componentes compartilhados com o b2b admin (combos de chave estrangeira) */
export interface OpcaoRef {
  value: string;
  label: string;
}

/** Servidor da bmAPI escolhido no login (tabela servidores do MySQL bmapi) */
export interface ServidorInfo {
  numero: number;
  identificacao: string;
}

export interface DbConnectionStatus {
  connected: boolean;
  latencyMs: number;
  servidor?: number;
  identificacao?: string;
  empresa?: string | null;
  error?: string;
}

// ------------------------------------------------------------
// Estoque
// ------------------------------------------------------------
export type FiltroEstoque = 'com' | 'sem' | 'todos' | 'pre';

export interface ProdutoPesquisa {
  id: number;
  idRef: number | null;
  referencia: string;
  classe: string;
  descricaoClasse: string;
  descricao: string;
  aplicacao: string;
  info: string;
  marca: string;
  precoVenda: number | null;
  promocao: number | null;
  emPromocao: boolean;
  disponivel: number;
  reserva: number;
  un: string;
  pedido: number | null;
  imposto: string;
  /** Quantidade de fotos em PROFOTOS */
  fotos: number;
  /** ID da primeira foto (miniatura da visão em cards) */
  fotoPrincipal: number | null;
}

export interface FotoProduto {
  id: number;
  descricao: string;
}

export interface Similar {
  idProduto: number;
  descricao: string;
  preco: number | null;
  un: string;
  disponivel: number;
}

export interface ReservaCliente {
  idCliente: number;
  nome: string;
  fechados: number;
  abertos: number;
  fazendo: number;
  total: number;
}

export interface ClasseProduto {
  id: number;
  classe: string;
  descricao: string;
}

export interface ItemPrePedido {
  id: number;
  idProduto: number;
  idRef: number;
  qtdade: number;
  descricao: string;
  un: string;
}

// ------------------------------------------------------------
// Pedidos
// ------------------------------------------------------------
export type StatusPedido = 'A' | 'F' | 'X';

export interface Pedido {
  id: number;
  idCliente: number;
  clienteNome: string;
  idPlano: number;
  planoDescricao: string;
  data: string;
  expiraEm: string | null;
  dataFechamento: string | null;
  descricao: string;
  obs: string;
  totalProdutos: number;
  percDescontos: number;
  totalDescontos: number;
  totalPedido: number;
  status: StatusPedido;
  faturado: boolean;
  numeroPedido: string;
  numeroNf: string;
  idUsuario: number;
  usuarioNome: string;
  entregaData: string | null;
  entregaObs: string;
}

export interface ItemPedido {
  id: number;
  idProduto: number;
  idRef: number;
  referencia: string;
  descricao: string;
  marca: string;
  un: string;
  obs: string;
  qtdade: number;
  precoUnit: number;
  precoTotal: number;
  pesoBrutoTotal: number;
  imposto: string;
}

export interface PedidoDetalhe extends Pedido {
  itens: ItemPedido[];
}

export interface PlanoPagamento {
  id: number;
  descricao: string;
  apelido: string;
  juros: number;
  parcelas: number;
}

export interface ContextoPedidos {
  planos: PlanoPagamento[];
  planoForcado: number | null;
  podeLancar: boolean;
  cliente: { id: number; nome: string } | null;
}

export interface ImpressaoPedido {
  pedido: Pedido;
  itens: ItemPedido[];
  cliente: Record<string, any> | null;
  empresa: Record<string, any> | null;
  plano: { descricao: string; parcelas: number } | null;
  parcelas: { seq: number; vencimento: string; valor: number }[];
}

export interface PlanoLoja {
  id: number;
  descricao: string;
  apelido: string;
  parcelas: number;
  juros: number;
  ativo: boolean;
  liberado: boolean;
}

export interface DashboardData {
  prePedido: { itens: number; qtdade: number };
  pedidosPorStatus: { status: string; quantidade: number; valor: number }[];
  faturados: number;
  ultimosPedidos: {
    id: number;
    data: string;
    descricao: string;
    status: string;
    faturado: boolean;
    totalPedido: number;
    numeroPedido: string;
    clienteNome: string;
  }[];
}
