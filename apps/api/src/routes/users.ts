import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { auditFor, auth, guards, requirePermission, requireWritable, tenant } from '../http/context.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { effectivePermissions, PERMISSIONS, ROLE_DEFAULTS, type Role } from '../domain/permissions.js';
import { hashPassword, passwordProblems } from '../services/password.js';

const roleEnum = z.enum(['owner', 'dentist', 'reception']);

/** 08 — Usuários e papéis (REQ-22). */
export async function userRoutes(app: FastifyInstance) {
  app.get('/api/users', { preHandler: guards(requirePermission('users:manage')) }, async (req) =>
    tenant(req, async (db) => {
      const { rows } = await db.query(
        `SELECT m.id AS "membershipId", m.role, m.permissions, m.active, u.id AS "userId", u.name, u.email, u.cro,
                u.totp_enabled AS "mfaEnabled"
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.clinic_id = $1 ORDER BY u.name`,
        [auth(req).clinicId],
      );
      return {
        users: rows.map((r) => ({ ...r, effectivePermissions: effectivePermissions(r.role, r.permissions) })),
        catalog: { permissions: PERMISSIONS, roleDefaults: ROLE_DEFAULTS },
      };
    }),
  );

  app.post('/api/users', { preHandler: guards(requirePermission('users:manage'), requireWritable) }, async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(3),
        email: z.string().trim().toLowerCase().email(),
        role: roleEnum,
        cro: z.string().trim().optional().nullable(),
        password: z.string(),
      })
      .parse(req.body);
    if (body.role === 'dentist' && !body.cro) throw badRequest('Dentista precisa de CRO (REQ-19)');
    const problem = passwordProblems(body.password);
    if (problem) throw badRequest(problem);
    const a = auth(req);
    let user = (await getPool().query<{ id: string }>('SELECT id FROM users WHERE email = $1', [body.email])).rows[0];
    if (!user) {
      user = (
        await getPool().query<{ id: string }>(
          'INSERT INTO users (email, name, cro, password_hash) VALUES ($1,$2,$3,$4) RETURNING id',
          [body.email, body.name, body.cro ?? null, await hashPassword(body.password)],
        )
      ).rows[0];
    }
    const id = await tenant(req, async (db) => {
      const exists = await db.query('SELECT 1 FROM memberships WHERE clinic_id = $1 AND user_id = $2', [a.clinicId, user.id]);
      if (exists.rowCount) throw conflict('Usuário já vinculado a este consultório');
      const { rows } = await db.query<{ id: string }>(
        'INSERT INTO memberships (clinic_id, user_id, role) VALUES ($1,$2,$3) RETURNING id',
        [a.clinicId, user.id, body.role],
      );
      await auditFor(req, db, { action: 'membership.create', entity: 'membership', entityId: rows[0].id, metadata: { role: body.role } });
      return rows[0].id;
    });
    reply.code(201);
    return { membershipId: id };
  });

  // Alterações de papel/permissão são auditadas com valor anterior e novo (REQ-22).
  app.patch('/api/memberships/:id', { preHandler: guards(requirePermission('users:manage'), requireWritable) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        role: roleEnum.optional(),
        permissions: z.array(z.enum(PERMISSIONS)).nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const a = auth(req);
    return tenant(req, async (db) => {
      const { rows } = await db.query<{ user_id: string; role: Role; permissions: string[] | null; active: boolean }>(
        'SELECT user_id, role, permissions, active FROM memberships WHERE id = $1',
        [id],
      );
      const before = rows[0];
      if (!before) throw notFound();
      if (before.user_id === a.userId && (body.role && body.role !== 'owner' || body.active === false)) {
        throw forbidden('Você não pode remover o seu próprio acesso de proprietário(a)');
      }
      const after = {
        role: body.role ?? before.role,
        permissions: body.permissions === undefined ? before.permissions : body.permissions,
        active: body.active ?? before.active,
      };
      await db.query('UPDATE memberships SET role = $2, permissions = $3, active = $4 WHERE id = $1', [id, after.role, after.permissions, after.active]);
      const action = before.role !== after.role ? 'membership.role_changed' : before.active !== after.active ? 'membership.active_changed' : 'membership.permissions_changed';
      await auditFor(req, db, {
        action, entity: 'membership', entityId: id,
        metadata: { before: { role: before.role, permissions: before.permissions, active: before.active }, after },
      });
      return { ok: true, effectivePermissions: effectivePermissions(after.role, after.permissions) };
    });
  });
}
