import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { config } from './config.js';
import { Servidor } from './servidores.js';

/**
 * Cliente da bmAPI (D:\bmsoft\BMapi), o único caminho até a base DBISAM.
 *
 * A bmAPI expõe POST /sql: SELECT devolve { columns, rows, rowCount, truncated } e
 * os demais comandos devolvem { rowsAffected }. A API key vai no header X-API-Key
 * e é ela que escolhe a base (seção do config.ini da bmAPI).
 *
 * Particularidades do DBISAM/bmAPI que moldam o resto do backend:
 *  - não há LIMIT/OFFSET: o limite é "SELECT ... ORDER BY ... TOP n" (TOP no fim);
 *  - campos Memo chegam como "[blob]": leia com CAST(campo AS VARCHAR(n)), n <= 512;
 *  - a bmAPI decide entre Open e ExecSQL pela primeira palavra do comando. Um script
 *    (comandos separados por ";") que começa com SELECT é aberto e devolve as linhas
 *    do ÚLTIMO SELECT, executando os comandos de escrita do meio;
 *  - parâmetros nomeados (:nome) só valem para o PRIMEIRO comando de um script. Em
 *    scripts, os valores entram como literais montados pelas funções sql* abaixo;
 *  - a comparação de texto é sensível a maiúsculas: buscas usam UPPER(coluna).
 */

export class BmapiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type Linha = Record<string, any>;

export interface ResultadoConsulta {
  rows: Linha[];
  truncated: boolean;
}

const TIMEOUT_MS = 120_000;

/**
 * Servidor da bmAPI da requisição em andamento. É escolhido no login (número do
 * servidor da tabela servidores) e fixado pela sessão em exigirSessao; todas as
 * funções abaixo usam o servidor do contexto.
 */
const contexto = new AsyncLocalStorage<Servidor>();

export function comServidor<T>(servidor: Servidor, fn: () => T): T {
  return contexto.run(servidor, fn);
}

export function servidorAtual(): Servidor {
  const s = contexto.getStore();
  if (!s) throw new BmapiError('Servidor da bmAPI não identificado. Entre novamente.', 401);
  return s;
}

async function postSql(sql: string, params?: Record<string, any>): Promise<any> {
  const servidor = servidorAtual();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${servidor.baseUrl}/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': servidor.token },
      body: JSON.stringify({ sql, params: params || {} }),
      signal: controller.signal,
    });
  } catch (err: any) {
    const motivo =
      err?.name === 'AbortError' ? 'tempo esgotado' : err?.cause?.code || err?.cause?.errors?.[0]?.code || err?.message;
    throw new BmapiError(`Não foi possível acessar a bmAPI do servidor ${servidor.numero} (${motivo}).`, 503);
  } finally {
    clearTimeout(timer);
  }

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    const msg = String(data?.error || `bmAPI respondeu HTTP ${res.status}`);
    if (res.status === 401) {
      throw new BmapiError(`A bmAPI recusou o token cadastrado para o servidor ${servidor.numero}.`, 503);
    }
    if (res.status === 403) {
      throw new BmapiError('A base configurada na bmAPI está somente leitura (allowWrite=false).', 503);
    }
    if (process.env.DEBUG_SQL === 'true') console.error('[bmAPI] erro:', msg, '\n', sql);
    throw new BmapiError(traduzirErroDbisam(msg), 400);
  }
  return data;
}

/** Nomes de coluna em minúsculas: o DBISAM devolve a grafia da tabela ou do alias */
function normalizarLinhas(rows: Linha[] = []): Linha[] {
  return rows.map((r) => {
    const out: Linha = {};
    for (const [k, v] of Object.entries(r)) out[k.toLowerCase()] = v;
    return out;
  });
}

/** Executa um SELECT (ou script que termina em SELECT) e devolve as linhas */
export async function consultar(sql: string, params?: Record<string, any>): Promise<Linha[]> {
  const data = await postSql(sql, params);
  return normalizarLinhas(data.rows);
}

export async function consultarComLimite(sql: string, params?: Record<string, any>): Promise<ResultadoConsulta> {
  const data = await postSql(sql, params);
  return { rows: normalizarLinhas(data.rows), truncated: Boolean(data.truncated) };
}

/** Primeira linha do SELECT, ou null */
export async function consultarUm(sql: string, params?: Record<string, any>): Promise<Linha | null> {
  const rows = await consultar(sql, params);
  return rows[0] ?? null;
}

/** INSERT / UPDATE / DELETE (ou script de escrita). Devolve as linhas afetadas. */
export async function executar(sql: string, params?: Record<string, any>): Promise<number> {
  const data = await postSql(sql, params);
  return Number(data.rowsAffected ?? 0);
}

/**
 * Conteúdo de um campo blob (ex.: PROFOTOS.FOTO) pela rota POST /blob da bmAPI.
 * A bmAPI já remove o cabeçalho do TGraphicField e informa o tipo da imagem.
 * Devolve null quando o registro não existe ou o campo está vazio.
 */
export async function baixarBlob(
  sql: string,
  params?: Record<string, any>,
): Promise<{ conteudo: Buffer; contentType: string } | null> {
  const servidor = servidorAtual();
  let res: Response;
  try {
    res = await fetch(`${servidor.baseUrl}/blob`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': servidor.token },
      body: JSON.stringify({ sql, params: params || {} }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: any) {
    throw new BmapiError(`Não foi possível acessar a bmAPI do servidor ${servidor.numero} (${err?.cause?.code || err?.message}).`, 503);
  }

  if (res.status === 404) {
    // bmAPI antiga, sem a rota /blob, responde 404 sem JSON de erro
    const data: any = await res.json().catch(() => null);
    if (!data) throw new BmapiError('A bmAPI deste servidor não tem a rota /blob. Atualize o BMapi.exe.', 501);
    return null;
  }
  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}));
    throw new BmapiError(String(data?.error || `bmAPI respondeu HTTP ${res.status}`));
  }
  return {
    conteudo: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

// ------------------------------------------------------------
// Literais SQL para scripts (onde parâmetros não são aplicados)
// ------------------------------------------------------------

/** Texto: aspas simples dobradas; quebras de linha viram #13/#10 do DBISAM */
export function sqlTexto(valor: unknown, tamanhoMax?: number): string {
  if (valor === null || valor === undefined) return 'NULL';
  let s = String(valor);
  if (tamanhoMax) s = s.slice(0, tamanhoMax);
  const partes = s.split(/\r\n|\r|\n/).map((p) => `'${p.replace(/'/g, "''")}'`);
  return partes.join('+#13+#10+');
}

export function sqlNumero(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return 'NULL';
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new BmapiError(`Valor numérico inválido: ${String(valor)}`);
  return String(n);
}

export function sqlInteiro(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return 'NULL';
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new BmapiError(`Valor inteiro inválido: ${String(valor)}`);
  return String(Math.trunc(n));
}

export function sqlBool(valor: unknown): string {
  return valor ? 'TRUE' : 'FALSE';
}

/** Data 'yyyy-mm-dd' */
export function sqlData(valor: unknown): string {
  if (!valor) return 'NULL';
  const s = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BmapiError(`Data inválida: ${String(valor)}`);
  return `'${s}'`;
}

/** Data e hora 'yyyy-mm-dd hh:nn:ss' */
export function sqlDataHora(valor: unknown): string {
  if (!valor) return 'NULL';
  const s = String(valor).replace('T', ' ').slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) {
    throw new BmapiError(`Data/hora inválida: ${String(valor)}`);
  }
  return `'${s.length === 16 ? `${s}:00` : s}'`;
}

/** Lista de inteiros para IN (...) */
export function sqlListaInteiros(valores: unknown[]): string {
  const nums = valores.map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n));
  return nums.length ? nums.join(',') : '-1';
}

/**
 * Nome exclusivo de tabela em memória. As tabelas MEMORY do DBISAM são visíveis por
 * todas as conexões da bmAPI, então cada uso precisa de um nome próprio (o Delphi
 * fazia o mesmo com os códigos @T1..@T9).
 */
export function tabelaMemoria(prefixo = 'EW'): string {
  return `"MEMORY\\${prefixo}${crypto.randomBytes(6).toString('hex').toUpperCase()}"`;
}

/** Data de hoje no fuso do servidor, 'yyyy-mm-dd' */
export function hojeISO(deslocamentoDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamentoDias);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function agoraISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${hojeISO()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Mensagens mais legíveis para os erros mais comuns do motor DBISAM */
function traduzirErroDbisam(msg: string): string {
  if (/#\s*10258/.test(msg) || /locked/i.test(msg)) {
    return 'O registro está bloqueado por outro usuário no momento. Tente novamente em instantes.';
  }
  if (/#\s*11010/.test(msg) || /does not exist/i.test(msg)) {
    return `Tabela não encontrada na base DBISAM: ${msg}`;
  }
  return msg;
}

// ------------------------------------------------------------
// Saúde da conexão
// ------------------------------------------------------------
/** Saúde da bmAPI do servidor do contexto (não expõe URL nem token) */
export async function verificarBmapi() {
  const inicio = Date.now();
  const servidor = servidorAtual();
  try {
    const ping = await fetch(`${servidor.baseUrl}/ping`, { signal: AbortSignal.timeout(8000) });
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
    const empresa = await consultarUm(
      'SELECT ID id, APELIDO apelido, NOMECONTRIBUINTE nome FROM EMPRESAS WHERE ID = :id',
      { id: config.idEmpresa },
    );
    return {
      connected: true,
      latencyMs: Date.now() - inicio,
      servidor: servidor.numero,
      identificacao: servidor.identificacao,
      empresa: empresa ? `${empresa.id} - ${empresa.apelido || empresa.nome}` : null,
    };
  } catch (err: any) {
    const causa = err?.cause?.code || err?.cause?.errors?.[0]?.code;
    if (err?.message === 'fetch failed' || err?.name === 'TimeoutError') {
      err = new Error(`bmAPI do servidor ${servidor.numero} não respondeu (${causa || 'tempo esgotado'}).`);
    }
    return {
      connected: false,
      latencyMs: Date.now() - inicio,
      servidor: servidor.numero,
      identificacao: servidor.identificacao,
      error: err?.message || 'Falha ao acessar a bmAPI',
    };
  }
}
