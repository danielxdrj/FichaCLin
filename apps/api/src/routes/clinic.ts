import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { auditFor, auth, guards, inClinic, requirePermission, requireWritable, tenant } from '../http/context.js';
import { addressSchema } from '../domain/patient.js';
import { badRequest } from '../http/errors.js';

const clinicSchema = z.object({
  name: z.string().trim().min(2),
  legalName: z.string().trim().nullable().optional(),       // REQ-31
  cnpj: z.string().trim().nullable().optional(),
  techLeadName: z.string().trim().nullable().optional(),
  techLeadCro: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().nullable().optional(),
  address: addressSchema,
  reminderLegalBasis: z.enum(['tutela_saude', 'consentimento']).nullable().optional(), // REQ-16
});

export async function clinicRoutes(app: FastifyInstance) {
  app.get('/api/clinic', { preHandler: inClinic }, async (req) => {
    const a = auth(req);
    return tenant(req, async (db) => {
      const { rows } = await db.query(
        `SELECT id, name, legal_name AS "legalName", cnpj, tech_lead_name AS "techLeadName",
                tech_lead_cro AS "techLeadCro", phone, email, address, billing_status AS "billingStatus",
                plan, trial_ends_at AS "trialEndsAt", reminder_legal_basis AS "reminderLegalBasis",
                require_mfa AS "requireMfa"
           FROM clinics WHERE id = $1`,
        [a.clinicId],
      );
      // REQ-02: situação do aceite do DPA vigente.
      const dpa = await getPool().query(
        `SELECT d.id, d.version, d.title, a.accepted_at AS "acceptedAt", u.name AS "acceptedBy"
           FROM legal_documents d
           LEFT JOIN legal_acceptances a ON a.document_id = d.id AND a.clinic_id = $1
           LEFT JOIN users u ON u.id = a.user_id
          WHERE d.kind = 'dpa' ORDER BY d.version DESC, a.accepted_at DESC LIMIT 1`,
        [a.clinicId],
      );
      return { ...rows[0], dpa: dpa.rows[0] ?? null };
    });
  });

  app.put('/api/clinic', { preHandler: guards(requirePermission('clinic:manage'), requireWritable) }, async (req) => {
    const body = clinicSchema.parse(req.body);
    const a = auth(req);
    return tenant(req, async (db) => {
      await db.query(
        `UPDATE clinics SET name = $2, legal_name = $3, cnpj = $4, tech_lead_name = $5, tech_lead_cro = $6,
                phone = $7, email = $8, address = $9, reminder_legal_basis = $10 WHERE id = $1`,
        [
          a.clinicId, body.name, body.legalName ?? null, body.cnpj ?? null, body.techLeadName ?? null,
          body.techLeadCro ?? null, body.phone ?? null, body.email ?? null, body.address, body.reminderLegalBasis ?? null,
        ],
      );
      await auditFor(req, db, { action: 'clinic.update', entity: 'clinic', entityId: a.clinicId });
      return { ok: true };
    });
  });

  // REQ-24 (divergência documentada): o consultório decide se exige 2FA de todos os usuários.
  app.put('/api/clinic/security', { preHandler: guards(requirePermission('clinic:manage')) }, async (req) => {
    const { requireMfa } = z.object({ requireMfa: z.boolean() }).parse(req.body);
    const a = auth(req);
    return tenant(req, async (db) => {
      await db.query('UPDATE clinics SET require_mfa = $2 WHERE id = $1', [a.clinicId, requireMfa]);
      await auditFor(req, db, { action: 'clinic.require_mfa', entity: 'clinic', entityId: a.clinicId, metadata: { requireMfa } });
      return { ok: true };
    });
  });

  // REQ-02: aceite do DPA pelo dono do consultório (controlador).
  app.post('/api/clinic/dpa/accept', { preHandler: guards(requirePermission('clinic:manage')) }, async (req) => {
    const a = auth(req);
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(req.body);
    const doc = await getPool().query(
      `SELECT id, version FROM legal_documents WHERE id = $1 AND kind = 'dpa'
          AND version = (SELECT max(version) FROM legal_documents WHERE kind = 'dpa')`,
      [documentId],
    );
    if (!doc.rows[0]) throw badRequest('DPA informado não é a versão vigente');
    await getPool().query(
      'INSERT INTO legal_acceptances (document_id, user_id, clinic_id, ip, user_agent) VALUES ($1, $2, $3, $4, $5)',
      [documentId, a.userId, a.clinicId, req.ip, req.headers['user-agent'] ?? null],
    );
    await tenant(req, (db) =>
      auditFor(req, db, { action: 'dpa.accept', entity: 'legal_document', entityId: documentId, metadata: { version: doc.rows[0].version } }),
    );
    return { ok: true };
  });
}
