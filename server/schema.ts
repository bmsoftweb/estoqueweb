/**
 * Registro de metadados das tabelas mantidas pelo CRUD genérico.
 *
 * Mesmo padrão do b2b admin: este arquivo é a fonte de verdade das telas de
 * manutenção simples.
 *  - o backend usa como whitelist de colunas ao montar o SQL para a bmAPI;
 *  - o frontend consome via GET /api/meta/resources e desenha grade e formulário.
 *
 * As telas com regra de negócio (pesquisa de estoque e pedidos) têm rotas próprias
 * em estoque.ts e pedidos.ts.
 */

export type FieldType = 'text' | 'textarea' | 'number' | 'decimal' | 'date' | 'datetime' | 'enum' | 'boolean' | 'password';

export interface FieldDef {
  /** Nome do campo na API (sempre minúsculo) */
  name: string;
  /** Coluna na tabela DBISAM; ausente em campos calculados (expr) */
  column?: string;
  /** Expressão SQL de um campo calculado vindo de JOIN, ex.: "P.NOME" (sempre somente leitura) */
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
  /** Chave primária (coluna AutoInc) */
  pk: string;
  labelField: string;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Nível mínimo para acessar o recurso */
  nivel: 'A' | 'G';
  /** JOINs usados pelos campos calculados; a tabela principal tem o alias "t" */
  joins?: string;
  fields: FieldDef[];
}

export const RESOURCES: ResourceDef[] = [
  {
    name: 'usuarios',
    table: 'WEB_USUARIOS',
    label: 'Usuários',
    labelSingular: 'Usuário',
    description: 'Acessos das lojas ao EstoqueWEB, nível e lista de preço',
    icon: 'Users',
    group: 'acesso',
    pk: 'id',
    labelField: 'nome_usuario',
    defaultSort: { field: 'nome_usuario', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    nivel: 'A',
    joins: 'LEFT JOIN PESSOAS P ON P.ID = t.ID_PESSOA',
    fields: [
      { name: 'id', column: 'ID', label: 'ID', type: 'number', readOnly: true, listed: true, width: 'xs' },
      {
        name: 'nome_usuario',
        column: 'NOME_USUARIO',
        label: 'Nome',
        type: 'text',
        required: true,
        maxLength: 30,
        listed: true,
        searchable: true,
        filterable: true,
      },
      {
        name: 'email',
        column: 'EMAIL',
        label: 'E-mail de acesso',
        type: 'text',
        required: true,
        maxLength: 80,
        listed: true,
        searchable: true,
        filterable: true,
      },
      {
        name: 'senha',
        column: 'SENHA',
        label: 'Senha',
        type: 'password',
        maxLength: 15,
        hint: 'Até 15 caracteres. Em branco na alteração mantém a senha atual.',
      },
      {
        name: 'id_pessoa',
        column: 'ID_PESSOA',
        label: 'Loja (ID da pessoa)',
        type: 'number',
        listed: true,
        filterable: true,
        hint: 'Código do cliente (PESSOAS.ID). Zero = usuário da central, enxerga todos os pedidos.',
        width: 'sm',
      },
      {
        name: 'nome_pessoa',
        expr: 'P.NOME',
        label: 'Nome da loja',
        type: 'text',
        readOnly: true,
        listed: true,
        searchable: true,
      },
      {
        name: 'nivel',
        column: 'NIVEL',
        label: 'Nível',
        type: 'enum',
        required: true,
        listed: true,
        filterable: true,
        hint: 'Vale a primeira letra: Administrador, Gerente, Supervisor, Vendedor ou Consulta.',
        options: [
          { value: 'Administrador', label: 'Administrador' },
          { value: 'Gerente', label: 'Gerente' },
          { value: 'Supervisor', label: 'Supervisor' },
          { value: 'Vendedor', label: 'Vendedor' },
          { value: 'Consulta', label: 'Consulta' },
        ],
      },
      {
        name: 'lista_preco',
        column: 'LISTA_PRECO',
        label: 'Lista de preço',
        type: 'enum',
        required: true,
        listed: true,
        filterable: true,
        options: [
          { value: '1', label: 'Lista 1 (Preço de venda 1)' },
          { value: '2', label: 'Lista 2 (Preço de venda 2)' },
        ],
        width: 'sm',
      },
      {
        name: 'pagina_inicial',
        column: 'PAGINA_INICIAL',
        label: 'Página inicial',
        type: 'text',
        maxLength: 80,
        placeholder: 'https://…',
        hint: 'Endereço exibido no painel inicial do usuário.',
      },
      { name: 'id_empresa', column: 'ID_EMPRESA', label: 'Empresa', type: 'number', width: 'xs' },
      { name: 'id_bm', column: 'ID_BM', label: 'ID usuário BM', type: 'number', width: 'xs' },
    ],
  },
  {
    name: 'log',
    table: 'WEB_LOG',
    label: 'Log de Acessos',
    labelSingular: 'Registro de log',
    description: 'Entradas no sistema registradas em WEB_LOG',
    icon: 'History',
    group: 'auditoria',
    pk: 'id',
    labelField: 'usuario',
    defaultSort: { field: 'id', dir: 'desc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    nivel: 'A',
    fields: [
      { name: 'id', column: 'ID', label: 'ID', type: 'number', readOnly: true, listed: true, width: 'xs' },
      { name: 'datahora', column: 'DATAHORA', label: 'Data/hora', type: 'datetime', readOnly: true, listed: true, filterable: true },
      {
        name: 'usuario',
        column: 'USUARIO',
        label: 'Usuário',
        type: 'text',
        readOnly: true,
        listed: true,
        searchable: true,
        filterable: true,
      },
      {
        name: 'mensagem',
        column: 'MENSAGEM',
        label: 'Mensagem',
        type: 'text',
        readOnly: true,
        listed: true,
        searchable: true,
      },
    ],
  },
];

export function getResource(name: string): ResourceDef | undefined {
  return RESOURCES.find((r) => r.name === name);
}

/** Expressão SQL de leitura do campo */
export function fieldExpr(field: FieldDef): string {
  return field.expr ? field.expr : `t.${field.column}`;
}

/** Campos gravados em INSERT/UPDATE */
export function writableFields(resource: ResourceDef): FieldDef[] {
  return resource.fields.filter((f) => f.column && !f.readOnly && f.name !== resource.pk);
}
