import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { auditFor, auth, guards, inClinic, requirePermission, tenant } from '../http/context.js';
import { notFound } from '../http/errors.js';

/** 12 — Suporte: canal do encarregado (REQ-10) e autorização de acesso do suporte (REQ-30). */
export async function supportRoutes(app: FastifyInstance) {
  app.get('/api/support', { preHandler: inClinic }, async (req) => {
    const a = auth(req);
    const grants = a.permissions.includes('support:manage')
      ? await tenant(req, async (db) =>
          (
            await db.query(
              `SELECT g.id, g.reason, g.expires_at AS "expiresAt", g.revoked_at AS "revokedAt", g.created_at AS "createdAt",
                      u.name AS "grantedBy", (g.revoked_at IS NULL AND g.expires_at > now()) AS active
                 FROM support_grants g JOIN users u ON u.id = g.granted_by ORDER BY g.created_at DESC`,
            )
          ).rows,
        )
      : [];
    return { dpo: config.dpo, grants };
  });

  app.post('/api/support/grants', { preHandler: guards(requirePermission('support:manage')) }, async (req, reply) => {
    const body = z.object({ reason: z.string().trim().min(5), hours: z.number().int().min(1).max(72) }).parse(req.body);
    const a = auth(req);
    const result = await tenant(req, async (db) => {
      const { rows } = await db.query(
        `INSERT INTO support_grants (clinic_id, granted_by, reason, expires_at)
         VALUES ($1,$2,$3, now() + make_interval(hours => $4)) RETURNING id, expires_at AS "expiresAt"`,
        [a.clinicId, a.userId, body.reason, body.hours],
      );
      await auditFor(req, db, { action: 'support.grant', entity: 'support_grant', entityId: rows[0].id, metadata: { hours: body.hours } });
      return rows[0];
    });
    reply.code(201);
    return result;
  });

  app.post('/api/support/grants/:id/revoke', { preHandler: guards(requirePermission('support:manage')) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenant(req, async (db) => {
      const r = await db.query('UPDATE support_grants SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
      if (!r.rowCount) throw notFound();
      await auditFor(req, db, { action: 'support.revoke', entity: 'support_grant', entityId: id });
      return { ok: true };
    });
  });
}
