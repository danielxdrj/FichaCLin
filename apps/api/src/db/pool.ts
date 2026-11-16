import pg from 'pg';
import { config } from '../config.js';

// DATE vem como string 'YYYY-MM-DD' (evita deslocamento de fuso em datas de nascimento).
pg.types.setTypeParser(1082, (v) => v);

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}
