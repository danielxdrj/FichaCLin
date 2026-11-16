import { randomBytes } from 'node:crypto';
import { getPool } from '../db/pool.js';
import { sha256 } from '../domain/hash.js';
import { config } from '../config.js';

export interface SessionRow {
  id: string;
  user_id: string;
  clinic_id: string | null;
  mfa_verified: boolean;
  mfa_required: boolean;
}

/** Token opaco no cookie; só o hash fica no banco (sessão revogável). */
/** `mfaRequired` é decidido no login (2FA ativado pelo usuário ou exigido por consultório). */
export async function createSession(userId: string, ip: string, userAgent: string | undefined, mfaRequired = false) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.session.ttlHours * 3600_000);
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at, mfa_required) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, sha256(token), ip, userAgent ?? null, expires, mfaRequired],
  );
  return { token, sessionId: rows[0].id, expires };
}

export async function findSession(token: string): Promise<SessionRow | null> {
  const { rows } = await getPool().query<SessionRow>(
    `SELECT id, user_id, clinic_id, mfa_verified, mfa_required FROM sessions
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function updateSession(id: string, patch: { clinicId?: string | null; mfaVerified?: boolean }) {
  if (patch.clinicId !== undefined) {
    await getPool().query('UPDATE sessions SET clinic_id = $2 WHERE id = $1', [id, patch.clinicId]);
  }
  if (patch.mfaVerified !== undefined) {
    await getPool().query('UPDATE sessions SET mfa_verified = $2 WHERE id = $1', [id, patch.mfaVerified]);
  }
}

export async function revokeSession(id: string) {
  await getPool().query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [id]);
}
