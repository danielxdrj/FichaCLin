import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auth, guards, requirePermission, tenant } from '../http/context.js';

/** Tela "Auditoria" (REQ-33): quem acessou cada prontuário. Leitura restrita ao dono. */
export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', { preHandler: guards(requirePermission('audit:read')) }, async (req) => {
    const q = z
      .object({
        patientId: z.string().uuid().optional(),
        userId: z.string().uuid().optional(),
        action: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    return tenant(req, async (db) => {
      const params: unknown[] = [];
      const where: string[] = [];
      if (q.patientId) {
        params.push(q.patientId);
        where.push(`l.patient_id = $${params.length}`);
      }
      if (q.userId) {
        params.push(q.userId);
        where.push(`l.user_id = $${params.length}`);
      }
      if (q.action) {
        // Um ou mais prefixos separados por vírgula (ex.: "patient.view,clinical.view"); casam por OU.
        const prefixes = q.action.split(',').map((a) => a.trim()).filter(Boolean).slice(0, 20);
        if (prefixes.length) {
          const ors = prefixes.map((a) => {
            params.push(`${a}%`);
            return `l.action LIKE $${params.length}`;
          });
          where.push(`(${ors.join(' OR ')})`);
        }
      }
      params.push(q.limit);
      const { rows } = await db.query(
        `SELECT l.id, l.action, l.entity, l.entity_id AS "entityId", l.patient_id AS "patientId", l.metadata, l.ip,
                l.created_at AS "createdAt", l.user_id AS "userId", u.name AS "userName", p.full_name AS "patientName"
           FROM audit_log l
           LEFT JOIN users u ON u.id = l.user_id
           LEFT JOIN patients p ON p.id = l.patient_id
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY l.id DESC LIMIT $${params.length}`,
        params,
      );
      return { events: rows };
    });
  });

  // Quem aparece no log deste consultório (inclui usuários já desativados), para o filtro por usuário.
  // A subconsulta em audit_log passa pela RLS do consultório, então só lista pessoas deste tenant.
  app.get('/api/audit/users', { preHandler: guards(requirePermission('audit:read')) }, async (req) =>
    tenant(req, async (db) => {
      const { rows } = await db.query(
        `SELECT u.id, u.name
           FROM users u
          WHERE u.id IN (SELECT DISTINCT user_id FROM audit_log WHERE user_id IS NOT NULL)
          ORDER BY u.name`,
      );
      return { users: rows };
    }),
  );

  // REQ-07: confere se a cadeia de hash do log está íntegra.
  app.get('/api/audit/verify', { preHandler: guards(requirePermission('audit:read')) }, async (req) =>
    tenant(req, async (db) => {
      const { rows } = await db.query<{ broken: string | null }>('SELECT verify_audit_chain($1) AS broken', [auth(req).clinicId]);
      return { intact: rows[0].broken === null, firstBrokenId: rows[0].broken };
    }),
  );
}
