/**
 * Configuração do EstoqueWEB, lida do .env.
 * Equivale ao estoqueWeb.ini do app Delphi, mais os dados de acesso à bmAPI.
 */

function simNao(valor: string | undefined, padrao: boolean): boolean {
  if (valor === undefined || valor.trim() === '') return padrao;
  // O .ini do Delphi aceitava "S", "Sim", "N", "Nao": vale a primeira letra
  return valor.trim().toUpperCase().startsWith('S');
}

function inteiro(valor: string | undefined, padrao: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && valor !== undefined && valor.trim() !== '' ? Math.trunc(n) : padrao;
}

export const config = {
  port: inteiro(process.env.ESTOQUE_PORT, 3003),

  /** MySQL com o cadastro dos servidores da bmAPI (tabela servidores) */
  mysql: {
    host: process.env.MYSQL_HOST || '45.224.130.145',
    port: inteiro(process.env.MYSQL_PORT, 3306),
    user: process.env.MYSQL_USER || 'bmsoftadm',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'bmapi',
  },

  sessionSecret: process.env.SESSION_SECRET || '',

  idEmpresa: inteiro(process.env.ID_EMPRESA, 1),
  consistirFinanceiro: simNao(process.env.CONSISTIR_FINANCEIRO, true),
  diasEmAtraso: inteiro(process.env.DIAS_EM_ATRASO, 3),
  consistirBloqueio: simNao(process.env.CONSISTIR_BLOQUEIO, false),
  apresentarEstoque: simNao(process.env.APRESENTAR_ESTOQUE, true),
  apresentarSimilares: simNao(process.env.APRESENTAR_SIMILARES, true),

  agendadorMeiaNoite: simNao(process.env.AGENDADOR_MEIA_NOITE, false),
  /** Número do servidor (tabela servidores) em que a rotina da meia-noite roda */
  agendadorServidor: inteiro(process.env.AGENDADOR_SERVIDOR, 0),
  planoPadraoAgendador: inteiro(process.env.PLANO_PADRAO_AGENDADOR, 7),
};

/** Configurações que o frontend precisa conhecer (sem nada sensível) */
export function configPublica() {
  return {
    idEmpresa: config.idEmpresa,
    apresentarEstoque: config.apresentarEstoque,
    apresentarSimilares: config.apresentarSimilares,
    consistirFinanceiro: config.consistirFinanceiro,
    consistirBloqueio: config.consistirBloqueio,
    diasEmAtraso: config.diasEmAtraso,
  };
}
