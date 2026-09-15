import mysql from 'mysql2/promise';
import { config } from './config';

/**
 * Cadastro dos servidores da bmAPI (MySQL bmapi.servidores).
 *
 * O número digitado no login é o id da tabela; a linha informa a URL, a porta e o
 * token (X-API-Key) da bmAPI daquele cliente. O token nunca sai do servidor Node.
 */

export interface Servidor {
  numero: number;
  identificacao: string;
  /** URL base já com protocolo e porta, ex.: http://localhost:9000 */
  baseUrl: string;
  token: string;
}

const pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 5,
  connectTimeout: 20000,
  enableKeepAlive: true,
});

/** Junta url e port da tabela: aceita url com ou sem protocolo, barra final ou porta */
export function montarBaseUrl(url: string, port: string): string {
  let base = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  const porta = String(port || '').trim();
  const temPorta = /^https?:\/\/[^/]+:\d+/i.test(base);
  if (porta && !temPorta) {
    const u = new URL(base);
    u.port = porta;
    base = u.toString().replace(/\/+$/, '');
  }
  return base;
}

const CACHE_MS = 60_000;
const cache = new Map<number, { servidor: Servidor | null; ate: number }>();

export async function buscarServidor(numero: number): Promise<Servidor | null> {
  if (!Number.isInteger(numero) || numero < 1 || numero > 999) return null;

  const emCache = cache.get(numero);
  if (emCache && emCache.ate > Date.now()) return emCache.servidor;

  const [rows] = await pool.query<any[]>(
    'SELECT id, url, port, token, identificacao FROM servidores WHERE id = ? LIMIT 1',
    [numero],
  );
  const r = rows[0];
  const servidor: Servidor | null =
    r && r.url && r.token
      ? {
          numero: Number(r.id),
          identificacao: String(r.identificacao || `Servidor ${r.id}`).trim(),
          baseUrl: montarBaseUrl(r.url, r.port),
          token: String(r.token).trim(),
        }
      : null;

  cache.set(numero, { servidor, ate: Date.now() + CACHE_MS });
  return servidor;
}
