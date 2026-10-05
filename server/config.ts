import { AsyncLocalStorage } from 'async_hooks';
import type { Servidor } from './servidores.js';

/** Servidor da bmAPI da requisição atual (definido por comServidor em bmapi.ts) */
export const contextoServidor = new AsyncLocalStorage<Servidor>();

/** Regra de negócio: primeiro servidores.config do servidor da sessão, depois o .env */
function valor(chave: string): string | undefined {
  return contextoServidor.getStore()?.config[chave] ?? process.env[chave];
}

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

  // Por cliente: vêm de servidores.config (KEY=VALOR por linha); sem a chave, do .env
  get idEmpresa() { return inteiro(valor('ID_EMPRESA'), 1); },
  get consistirFinanceiro() { return simNao(valor('CONSISTIR_FINANCEIRO'), true); },
  get diasEmAtraso() { return inteiro(valor('DIAS_EM_ATRASO'), 3); },
  get consistirBloqueio() { return simNao(valor('CONSISTIR_BLOQUEIO'), false); },
  get apresentarEstoque() { return simNao(valor('APRESENTAR_ESTOQUE'), true); },
  get apresentarSimilares() { return simNao(valor('APRESENTAR_SIMILARES'), true); },
  /** Plano usado pela rotina da meia-noite quando o pedido não tem plano */
  get planoPadraoAgendador() { return inteiro(valor('PLANO_PADRAO_AGENDADOR'), 7); },

  agendadorMeiaNoite: simNao(process.env.AGENDADOR_MEIA_NOITE, false),
  /** Números dos servidores (tabela servidores) em que a rotina da meia-noite roda, ex.: "1,3" */
  agendadorServidores: String(process.env.AGENDADOR_SERVIDOR || '')
    .split(',')
    .map((s) => inteiro(s, 0))
    .filter((n) => n > 0),
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
