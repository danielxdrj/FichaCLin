import type { PoolClient } from 'pg';
import { getPool } from './pool.js';

export interface TenantContext {
  clinicId?: string | null;
  userId?: string | null;
}

/**
 * REQ-26: toda consulta a dados de consultório roda dentro de uma transação
 * com `app.clinic_id` e `app.user_id` setados. As políticas de RLS do banco
 * usam esses valores; sem eles, nenhuma linha de consultório é visível.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.clinic_id', $1, true), set_config('app.user_id', $2, true)",
      [ctx.clinicId ?? '', ctx.userId ?? ''],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
