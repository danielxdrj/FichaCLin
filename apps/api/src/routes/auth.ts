import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { getPool } from '../db/pool.js';
import { withTenant } from '../db/tenant.js';
import { auth, pendingLegalDocs, requireMfa, requireSession, requireTerms } from '../http/context.js';
import { badRequest, conflict, forbidden, HttpError, unauthorized } from '../http/errors.js';
import { DEFAULT_ANAMNESIS, TRIAL_DAYS } from '../domain/anamnesis-default.js';
import { requiresMfa } from '../domain/permissions.js';
import { hashPassword, passwordProblems, verifyPassword } from '../services/password.js';
import { countTrustedDevices, isTrustedDevice, revokeTrustedDevices, trustDevice, TRUSTED_COOKIE } from '../services/trusted-device.js';
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

async function startSession(reply: FastifyReply, userId: string, ip: string, userAgent?: string, mfaRequired = false) {
  const { token, expires, sessionId } = await createSession(userId, ip, userAgent, mfaRequired);
  reply.setCookie(config.session.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd, // REQ-27: HTTPS em produção
    path: '/',
    expires,
  });
  return sessionId;
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

    // REQ-24 (D-01): a exigência é decidida aqui, no login, e fica fixa na sessão.
    const clinicRequires = await withTenant({ userId: user.id }, async (db) =>
      Boolean((await db.query(
        'SELECT 1 FROM memberships m JOIN clinics c ON c.id = m.clinic_id WHERE m.user_id = $1 AND m.active AND c.require_mfa',
        [user.id],
      )).rowCount),
    );
    const mfaRequired = requiresMfa({ userEnabled: user.totp_enabled, clinicRequires });
    const sessionId = await startSession(reply, user.id, req.ip, req.headers['user-agent'], mfaRequired);
    // Dispositivo marcado como confiável: não pede o código de novo.
    if (user.totp_enabled && (await isTrustedDevice(user.id, req.cookies?.[TRUSTED_COOKIE]))) {
      await updateSession(sessionId, { mfaVerified: true });
    }
    return { ok: true };
  });

  // Cadastro do cliente: cria a conta do dono e o consultório com 7 dias grátis.
  app.post('/api/auth/signup', async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(3, 'Informe seu nome completo'),
        email: z.string().trim().toLowerCase().email('E-mail inválido'),
        password: z.string(),
        clinicName: z.string().trim().min(2, 'Informe o nome do consultório'),
        cro: z.string().trim().optional().nullable(),
        acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Aceite os Termos de Uso e a Política de Privacidade' }) }),
      })
      .parse(req.body);
    const problem = passwordProblems(body.password);
    if (problem) throw badRequest(problem);
    const exists = await getPool().query('SELECT 1 FROM users WHERE email = $1', [body.email]);
    if (exists.rowCount) throw conflict('Já existe uma conta com este e-mail. Faça login.');

    const userId = (
      await getPool().query<{ id: string }>(
        'INSERT INTO users (email, name, cro, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
        [body.email, body.name, body.cro || null, await hashPassword(body.password)],
      )
    ).rows[0].id;
    // REQ-03: o aceite marcado no cadastro é registrado com versão, data, IP e usuário.
    const docs = await pendingLegalDocs(userId);
    for (const d of docs) {
      await getPool().query(
        'INSERT INTO legal_acceptances (document_id, user_id, ip, user_agent) VALUES ($1, $2, $3, $4)',
        [d.id, userId, req.ip, req.headers['user-agent'] ?? null],
      );
    }
    const clinicId = randomUUID();
    await withTenant({ clinicId, userId }, async (db) => {
      await db.query(
        `INSERT INTO clinics (id, name, billing_status, trial_ends_at, tech_lead_name, tech_lead_cro)
         VALUES ($1, $2, 'trial', now() + make_interval(days => $3), $4, $5)`,
        [clinicId, body.clinicName, TRIAL_DAYS, body.name, body.cro || null],
      );
      await db.query("INSERT INTO memberships (clinic_id, user_id, role) VALUES ($1, $2, 'owner')", [clinicId, userId]);
      await db.query(
        'INSERT INTO anamnesis_templates (clinic_id, version, title, questions, created_by) VALUES ($1, 1, $2, $3, $4)',
        [clinicId, DEFAULT_ANAMNESIS.title, JSON.stringify(DEFAULT_ANAMNESIS.questions), userId],
      );
      await db.query(
        "INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, ip) VALUES ($1, $2, 'clinic.signup', 'clinic', $1, $3)",
        [clinicId, userId, req.ip],
      );
    });
    const sessionId = await startSession(reply, userId, req.ip, req.headers['user-agent']);
    await updateSession(sessionId, { clinicId });
    reply.code(201);
    return { ok: true, trialDays: TRIAL_DAYS };
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
      mfa: {
        required: a.mfaRequired,
        verified: a.mfaVerified,
        enabled: user.totp_enabled,
        trustedDevices: user.totp_enabled ? await countTrustedDevices(user.id) : 0,
      },
      pendingLegal: mfaDone ? a.pendingLegal : [],
      clinics,
      current: a.clinicId
        ? { clinicId: a.clinicId, role: a.role, permissions: a.permissions, billingStatus: a.billingStatus }
        : null,
    };
  });

  // REQ-24: cadastro do autenticador por QR code — pelo próprio usuário (Configurações · Segurança)
  // ou no login, quando o consultório exige 2FA e o usuário ainda não cadastrou.
  app.post('/api/auth/2fa/setup', { preHandler: [requireSession] }, async (req) => {
    const a = auth(req);
    const { rows } = await getPool().query<UserRow>('SELECT * FROM users WHERE id = $1', [a.userId]);
    if (rows[0].totp_enabled) throw new HttpError(409, 'MFA_ALREADY_ENABLED', 'Autenticador já configurado');
    const secret = newTotpSecret();
    await getPool().query('UPDATE users SET totp_secret = $2 WHERE id = $1', [a.userId, secret]);
    const uri = totpUri(rows[0].email, secret);
    // QR gerado no servidor: o segredo não passa por nenhum serviço externo.
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    return { secret, uri, qr };
  });

  // Desativar o 2FA exige um código válido e não é permitido se algum consultório exigir 2FA.
  app.post('/api/auth/2fa/disable', { preHandler: [requireSession, requireMfa] }, async (req) => {
    const a = auth(req);
    const { code } = z.object({ code: z.string().trim() }).parse(req.body);
    const { rows } = await getPool().query<UserRow>('SELECT * FROM users WHERE id = $1', [a.userId]);
    const user = rows[0];
    if (!user.totp_enabled || !user.totp_secret) throw new HttpError(409, 'MFA_NOT_ENABLED', '2FA não está ativado');
    const required = await withTenant({ userId: a.userId }, async (db) =>
      (await db.query(
        'SELECT 1 FROM memberships m JOIN clinics c ON c.id = m.clinic_id WHERE m.user_id = $1 AND m.active AND c.require_mfa',
        [a.userId],
      )).rowCount,
    );
    if (required) throw forbidden('Um consultório ao qual você está vinculado exige 2FA', 'MFA_REQUIRED_BY_CLINIC');
    if (!verifyTotp(user.totp_secret, code)) {
      await registerFailure(user);
      throw unauthorized('INVALID_MFA', 'Código inválido');
    }
    await getPool().query('UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1', [a.userId]);
    await revokeTrustedDevices(a.userId);
    return { ok: true };
  });

  // "Esquecer dispositivos": o código volta a ser pedido em todos os navegadores.
  app.post('/api/auth/trusted-devices/revoke', { preHandler: [requireSession, requireMfa] }, async (req, reply) => {
    await revokeTrustedDevices(auth(req).userId);
    reply.clearCookie(TRUSTED_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  app.post('/api/auth/2fa/verify', { preHandler: [requireSession] }, async (req, reply) => {
    const a = auth(req);
    const { code, rememberDevice } = z
      .object({ code: z.string().trim(), rememberDevice: z.boolean().default(false) })
      .parse(req.body);
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
    if (rememberDevice) await trustDevice(reply, a.userId, req.ip, req.headers['user-agent']);
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
