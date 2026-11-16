import { randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { getPool } from '../db/pool.js';
import { sha256 } from '../domain/hash.js';
import { config } from '../config.js';

/**
 * "Não solicitar o código neste dispositivo novamente": após um 2FA válido, o navegador recebe
 * um cookie HttpOnly próprio. Só o hash do token fica no banco; vale por 90 dias, ou até o
 * usuário revogar os dispositivos ou desativar o 2FA.
 */
export const TRUSTED_COOKIE = 'fc_trusted';
const TRUSTED_DAYS = 90;

export async function trustDevice(reply: FastifyReply, userId: string, ip: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + TRUSTED_DAYS * 86400_000);
  await getPool().query(
    'INSERT INTO trusted_devices (user_id, token_hash, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [userId, sha256(token), ip, userAgent ?? null, expires],
  );
  reply.setCookie(TRUSTED_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/api/auth', expires });
}

export async function isTrustedDevice(userId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const { rowCount } = await getPool().query(
    'SELECT 1 FROM trusted_devices WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now()',
    [userId, sha256(token)],
  );
  return rowCount === 1;
}

export async function revokeTrustedDevices(userId: string) {
  await getPool().query('UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

export async function countTrustedDevices(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    'SELECT count(*)::int AS n FROM trusted_devices WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()',
    [userId],
  );
  return rows[0].n;
}
