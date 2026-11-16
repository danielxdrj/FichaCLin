import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { getPool } from '../db/pool.js';
import { withTenant } from '../db/tenant.js';
import { effectivePermissions, type Permission, type Role } from '../domain/permissions.js';
import { findSession } from '../services/session.js';
import { audit, type AuditEvent } from '../services/audit.js';
import { forbidden, HttpError, unauthorized } from './errors.js';

export interface AuthContext {
  sessionId: string;
  userId: string;
  mfaVerified: boolean;
  mfaRequired: boolean;
  pendingLegal: { id: string; kind: string; version: number; title: string }[];
  clinicId: string | null;
  role: Role | null;
  permissions: Permission[];
  billingStatus: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

/** Documentos vigentes (última versão de Termos e Política) ainda não aceitos pelo usuário. REQ-03 */
export async function pendingLegalDocs(userId: string) {
  const { rows } = await getPool().query(
    `SELECT d.id, d.kind, d.version, d.title
       FROM legal_documents d
      WHERE d.kind IN ('terms', 'privacy')
        AND d.version = (SELECT max(version) FROM legal_documents x WHERE x.kind = d.kind)
        AND NOT EXISTS (SELECT 1 FROM legal_acceptances a WHERE a.document_id = d.id AND a.user_id = $1)
      ORDER BY d.kind`,
    [userId],
  );
  return rows as AuthContext['pendingLegal'];
}

/** Hook global: resolve sessão, vínculo e permissões. */
export async function loadAuth(req: FastifyRequest): Promise<void> {
  req.auth = null;
  const token = req.cookies?.[config.session.cookieName];
  if (!token) return;
  const session = await findSession(token);
  if (!session) return;

  const ctx = await withTenant({ userId: session.user_id, clinicId: session.clinic_id }, async (db) => {
    const memberships = await db.query<{ clinic_id: string; role: Role; permissions: string[] | null }>(
      'SELECT clinic_id, role, permissions FROM memberships WHERE user_id = $1 AND active',
      [session.user_id],
    );
    const current = memberships.rows.find((m) => m.clinic_id === session.clinic_id) ?? null;
    let billingStatus: string | null = null;
    if (current) {
      const c = await db.query<{ billing_status: string }>('SELECT billing_status FROM clinics WHERE id = $1', [
        current.clinic_id,
      ]);
      billingStatus = c.rows[0]?.billing_status ?? null;
    }
    return { current, billingStatus };
  });

  req.auth = {
    sessionId: session.id,
    userId: session.user_id,
    mfaVerified: session.mfa_verified,
    // Decidido no login (ver routes/auth.ts): mudar a política não derruba a sessão em uso.
    mfaRequired: session.mfa_required,
    pendingLegal: await pendingLegalDocs(session.user_id),
    clinicId: ctx.current ? session.clinic_id : null,
    role: ctx.current?.role ?? null,
    permissions: ctx.current ? effectivePermissions(ctx.current.role, ctx.current.permissions) : [],
    billingStatus: ctx.billingStatus,
  };
}

// ---------------------------------------------------------------------------
// Guardas (preHandlers)
// ---------------------------------------------------------------------------
type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export const requireSession: Guard = async (req) => {
  if (!req.auth) throw unauthorized();
};

/** REQ-24: quando o 2FA é exigido (pelo usuário ou pelo consultório), nenhuma rota de dados antes de concluí-lo. */
export const requireMfa: Guard = async (req) => {
  if (!req.auth) throw unauthorized();
  if (req.auth.mfaRequired && !req.auth.mfaVerified) throw unauthorized('MFA_REQUIRED', 'Confirme o código do autenticador');
};

/** REQ-03: aceite dos Termos e da Política vigentes antes de usar o sistema. */
export const requireTerms: Guard = async (req) => {
  if (req.auth && req.auth.pendingLegal.length > 0) {
    throw new HttpError(403, 'TERMS_REQUIRED', 'Aceite a versão vigente dos Termos de Uso e da Política de Privacidade');
  }
};

/** REQ-22 / REQ-26: precisa de um consultório selecionado em que o usuário tenha vínculo ativo. */
export const requireClinic: Guard = async (req) => {
  if (!req.auth?.clinicId || !req.auth.role) {
    throw new HttpError(409, 'CLINIC_REQUIRED', 'Selecione um consultório');
  }
};

export function requirePermission(p: Permission): Guard {
  return async (req) => {
    if (!req.auth?.permissions.includes(p)) throw forbidden();
  };
}

/** REQ-32: consultório suspenso por inadimplência não grava, mas continua lendo e exportando. */
export const requireWritable: Guard = async (req) => {
  if (req.auth?.billingStatus === 'suspended') {
    throw new HttpError(402, 'CLINIC_SUSPENDED', 'Consultório suspenso por inadimplência: somente leitura e exportação');
  }
};

export const authed = [requireSession, requireMfa, requireTerms] as preHandlerHookHandler[];
export const inClinic = [...authed, requireClinic] as preHandlerHookHandler[];

export function guards(...extra: Guard[]): preHandlerHookHandler[] {
  return [...inClinic, ...(extra as preHandlerHookHandler[])];
}

// ---------------------------------------------------------------------------
// Atalhos para rotas
// ---------------------------------------------------------------------------
export function auth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Executa no contexto do consultório da sessão (RLS ativo). */
export function tenant<T>(req: FastifyRequest, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const a = auth(req);
  return withTenant({ clinicId: a.clinicId, userId: a.userId }, fn);
}

export function auditFor(req: FastifyRequest, db: PoolClient, e: Omit<AuditEvent, 'clinicId' | 'userId' | 'ip'>) {
  const a = auth(req);
  return audit(db, { ...e, clinicId: a.clinicId!, userId: a.userId, ip: req.ip });
}
