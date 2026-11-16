import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFor, auth, guards, requirePermission, tenant } from '../http/context.js';
import { currentConsents, loadPatient } from './patients.js';

/**
 * REQ-06: exportação completa do prontuário (dados estruturados). A versão em PDF é gerada
 * pela página imprimível da web a partir deste mesmo JSON.
 * REQ-32: disponível mesmo com o consultório suspenso (sem requireWritable).
 */
export async function exportRoutes(app: FastifyInstance) {
  app.get('/api/patients/:id/export', { preHandler: guards(requirePermission('export')) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const a = auth(req);
    return tenant(req, async (db) => {
      const patient = await loadPatient(db, id);
      const clinic = (
        await db.query(
          `SELECT name, legal_name AS "legalName", cnpj, tech_lead_name AS "techLeadName", tech_lead_cro AS "techLeadCro"
             FROM clinics WHERE id = $1`,
          [a.clinicId],
        )
      ).rows[0];
      const consents = await currentConsents(db, id);
      const anamnesis = (
        await db.query(
          `SELECT id, template_version AS "templateVersion", questions_snapshot AS questions, answers,
                  signed_by_name AS "signedByName", signed_by_relation AS "signedByRelation",
                  content_hash AS "contentHash", created_at AS "createdAt"
             FROM anamnesis_responses WHERE patient_id = $1 ORDER BY created_at`,
          [id],
        )
      ).rows;
      const entries = (
        await db.query(
          `SELECT id, kind, content, author_name AS "authorName", author_cro AS "authorCro", amends_id AS "amendsId",
                  created_at AS "createdAt", signed_at AS "signedAt", content_hash AS "contentHash",
                  signature_method AS "signatureMethod"
             FROM clinical_entries WHERE patient_id = $1 ORDER BY created_at`,
          [id],
        )
      ).rows;
      await auditFor(req, db, { action: 'record.export', entity: 'patient', entityId: id, patientId: id });
      return {
        format: 'fichaclin-prontuario-v1',
        generatedAt: new Date().toISOString(),
        clinic,
        patient,
        consents,
        anamnesis,
        entries,
        notice:
          'Assinatura eletrônica simples (login + 2FA + hash SHA-256 + carimbo de tempo). ' +
          'Sem certificado ICP-Brasil, mantenha a via em papel assinada (Res. CFO 91/2009).',
      };
    });
  });
}
