import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { getPool } from '../db/pool.js';
import { withTenant } from '../db/tenant.js';
import { auth, requireMfa, requireSession, requireTerms } from '../http/context.js';
import { forbidden, HttpError, unauthorized } from '../http/errors.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import { createSession, revokeSession, updateSession } from '../services/session.js';
import { newTotpSecret, totpUri, verifyTotp } from '../services/totp.js';

// Hash fixo para igualar o tempo de resposta quando o e-mail não existe.
const dummyHash = hashPassword('senha-inexistente-0');

interface UserRow {
  id: string;
  email: string;
  name: string;
  cro: string | null;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  failed_logins: number;
  locked_until: Date | null;
}

/** REQ-25: bloqueio temporário após tentativas inválidas. Retorna minutos restantes, se bloqueado. */
async function registerFailure(user: UserRow): Promise<void> {
  const failures = user.failed_logins + 1;
  if (failures >= config.login.maxAttempts) {
    await getPool().query(
      `UPDATE users SET failed_logins = 0, locked_until = now() + make_interval(mins => $2) WHERE id = $1`,
      [user.id, config.login.lockMinutes],
    );
  } else {
    await getPool().query('UPDATE users SET failed_logins = $2 WHERE id = $1', [user.id, failures]);
  }
}

function lockedError(until: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return new HttpError(423, 'ACCOUNT_LOCKED', `Conta bloqueada por excesso de tentativas. Tente novamente em ${minutes} min.`);
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const { rows } = await getPool().query<UserRow>('SELECT * FROM users WHERE email = $1', [body.email.toLowerCase()]);
    const user = rows[0];
    if (!user) {
      await verifyPassword(await dummyHash, body.password);
      throw unauthorized('INVALID_CREDENTIALS', 'E-mail ou senha incorretos');
    }
    if (user.locked_until && user.locked_until > new Date()) throw lockedError(user.locked_until);
    if (!(await verifyPassword(user.password_hash, body.password))) {
      await registerFailure(user);
      throw unauthorized('INVALID_CREDENTIALS', 'E-mail ou senha incorretos');
    }
    await getPool().query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);

    const { token, expires } = await createSession(user.id, req.ip, req.headers['user-agent']);
    reply.setCookie(config.session.cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd, // REQ-27: HTTPS em produção
      path: '/',
      expires,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', { preHandler: [requireSession] }, async (req, reply) => {
    await revokeSession(auth(req).sessionId);
    reply.clearCookie(config.session.cookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: [requireSession] }, async (req) => {
    const a = auth(req);
    const { rows } = await getPool().query<UserRow>('SELECT * FROM users WHERE id = $1', [a.userId]);
    const user = rows[0];
    const mfaDone = !a.mfaRequired || a.mfaVerified;
    const clinics = mfaDone
      ? await withTenant({ userId: a.userId }, async (db) =>
          (
            await db.query(
              `SELECT c.id, c.name, c.billing_status AS "billingStatus", m.role,
                      c.address->>'city' AS city
                 FROM memberships m JOIN clinics c ON c.id = m.clinic_id
                WHERE m.user_id = $1 AND m.active ORDER BY c.name`,
              [a.userId],
            )
          ).rows,
        )
      : [];
    return {
      user: { id: user.id, name: user.name, email: user.email, cro: user.cro },
      mfa: { required: a.mfaRequired, verified: a.mfaVerified, enabled: user.totp_enabled },
      pendingLegal: mfaDone ? a.pendingLegal : [],
      clinics,
      current: a.clinicId
        ? { clinicId: a.clinicId, role: a.role, permissions: a.permissions, billingStatus: a.billingStatus }
        : null,
    };
  });

  // REQ-24: cadastro do autenticador na primeira entrada de dono/dentista.
  app.post('/api/auth/2fa/setup', { preHandler: [requireSession] }, async (req) => {
    const a = auth(req);
    const { rows } = await getPool().query<UserRow>('SELECT * FROM users WHERE id = $1', [a.userId]);
    if (rows[0].totp_enabled) throw new HttpError(409, 'MFA_ALREADY_ENABLED', 'Autenticador já configurado');
    const secret = newTotpSecret();
    await getPool().query('UPDATE users SET totp_secret = $2 WHERE id = $1', [a.userId, secret]);
    return { secret, uri: totpUri(rows[0].email, secret) };
  });

  app.post('/api/auth/2fa/verify', { preHandler: [requireSession] }, async (req) => {
    const a = auth(req);
    const { code } = z.object({ code: z.string().trim() }).parse(req.body);
    const { rows } = await getPool().query<UserRow>('SELECT * FROM users WHERE id = $1', [a.userId]);
    const user = rows[0];
    if (user.locked_until && user.locked_until > new Date()) throw lockedError(user.locked_until);
    if (!user.totp_secret) throw new HttpError(409, 'MFA_SETUP_REQUIRED', 'Configure o autenticador primeiro');
    if (!verifyTotp(user.totp_secret, code)) {
      await registerFailure(user);
      throw unauthorized('INVALID_MFA', 'Código inválido');
    }
    await getPool().query('UPDATE users SET totp_enabled = true, failed_logins = 0 WHERE id = $1', [a.userId]);
    await updateSession(a.sessionId, { mfaVerified: true });
    return { ok: true };
  });

  // Volta ao seletor de consultório (tela 09).
  app.post('/api/auth/leave-clinic', { preHandler: [requireSession] }, async (req) => {
    await updateSession(auth(req).sessionId, { clinicId: null });
    return { ok: true };
  });

  // REQ-26: só é possível entrar em consultório com vínculo ativo (RLS confirma).
  app.post('/api/auth/select-clinic', { preHandler: [requireSession, requireMfa, requireTerms] }, async (req) => {
    const a = auth(req);
    const { clinicId } = z.object({ clinicId: z.string().uuid() }).parse(req.body);
    const ok = await withTenant({ userId: a.userId }, async (db) => {
      const r = await db.query('SELECT 1 FROM memberships WHERE user_id = $1 AND clinic_id = $2 AND active', [
        a.userId,
        clinicId,
      ]);
      return r.rowCount === 1;
    });
    if (!ok) throw forbidden('Você não tem vínculo com este consultório');
    await updateSession(a.sessionId, { clinicId });
    await withTenant({ userId: a.userId, clinicId }, async (db) => {
      await db.query(
        `INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, ip) VALUES ($1, $2, 'session.enter_clinic', 'clinic', $1, $3)`,
        [clinicId, a.userId, req.ip],
      );
    });
    return { ok: true };
  });
}
