import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditFor, auth, guards, requirePermission, requireWritable, tenant } from '../http/context.js';
import { badRequest, notFound } from '../http/errors.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { consentGrantor, isMinor } from '../domain/patient.js';
import { loadPatient } from './patients.js';

const questionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/i),
  text: z.string().trim().min(3),
  type: z.enum(['yesno', 'text']),
  alert: z.boolean().default(false), // resposta "sim" destacada como alerta clínico
  section: z.string().trim().default('Geral'),
});

const templateSchema = z.object({
  title: z.string().trim().min(3),
  questions: z.array(questionSchema).min(1).refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, 'IDs de pergunta repetidos'),
});

async function currentTemplate(db: PoolClient) {
  const { rows } = await db.query(
    `SELECT id, version, title, questions, created_at AS "createdAt" FROM anamnesis_templates ORDER BY version DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function anamnesisRoutes(app: FastifyInstance) {
  app.get('/api/anamnesis/template', { preHandler: guards(requirePermission('clinical:read')) }, async (req) =>
    tenant(req, async (db) => ({ template: await currentTemplate(db) })),
  );

  app.get('/api/anamnesis/templates', { preHandler: guards(requirePermission('anamnesis:template')) }, async (req) =>
    tenant(req, async (db) => {
      const { rows } = await db.query(
        `SELECT t.id, t.version, t.title, jsonb_array_length(t.questions) AS "questionCount", t.created_at AS "createdAt",
                u.name AS "createdBy"
           FROM anamnesis_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.version DESC`,
      );
      return { templates: rows };
    }),
  );

  // 10 — Editor: salvar sempre cria NOVA versão (REQ-21); versões antigas continuam ligadas às respostas.
  app.post('/api/anamnesis/template', { preHandler: guards(requirePermission('anamnesis:template'), requireWritable) }, async (req, reply) => {
    const body = templateSchema.parse(req.body);
    const a = auth(req);
    const result = await tenant(req, async (db) => {
      const cur = await currentTemplate(db);
      const version = (cur?.version ?? 0) + 1;
      const { rows } = await db.query(
        `INSERT INTO anamnesis_templates (clinic_id, version, title, questions, created_by) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, version`,
        [a.clinicId, version, body.title, JSON.stringify(body.questions), a.userId],
      );
      await auditFor(req, db, { action: 'anamnesis_template.create', entity: 'anamnesis_template', entityId: rows[0].id, metadata: { version } });
      return rows[0];
    });
    reply.code(201);
    return result;
  });

  // 04 — Anamnese do paciente
  app.get('/api/patients/:id/anamnesis', { preHandler: guards(requirePermission('clinical:read')) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenant(req, async (db) => {
      await loadPatient(db, id);
      const { rows } = await db.query(
        `SELECT r.id, r.template_version AS "templateVersion", r.questions_snapshot AS questions, r.answers,
                r.signed_by_name AS "signedByName", r.signed_by_relation AS "signedByRelation",
                r.content_hash AS "contentHash", r.created_at AS "createdAt", u.name AS "authorName"
           FROM anamnesis_responses r JOIN users u ON u.id = r.author_id
          WHERE r.patient_id = $1 ORDER BY r.created_at DESC`,
        [id],
      );
      await auditFor(req, db, { action: 'anamnesis.view', entity: 'patient', entityId: id, patientId: id });
      return { responses: rows };
    });
  });

  app.post('/api/patients/:id/anamnesis', { preHandler: guards(requirePermission('clinical:write'), requireWritable) }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        templateId: z.string().uuid(),
        answers: z.record(z.object({ value: z.union([z.boolean(), z.string()]).nullable(), note: z.string().optional() })),
        signerConfirmed: z.literal(true, { errorMap: () => ({ message: 'Confirme quem assina a anamnese' }) }),
      })
      .parse(req.body);
    const a = auth(req);
    const result = await tenant(req, async (db) => {
      const patient = await loadPatient(db, id);
      const tpl = await currentTemplate(db);
      if (!tpl) throw notFound('Nenhum modelo de anamnese cadastrado');
      if (tpl.id !== body.templateId) throw badRequest('O modelo de anamnese mudou. Recarregue a página.');
      const unknown = Object.keys(body.answers).filter((k) => !tpl.questions.some((q: { id: string }) => q.id === k));
      if (unknown.length) throw badRequest('Resposta para pergunta inexistente', unknown);
      // REQ-12: menor de idade — quem assina é o responsável legal.
      if (isMinor(patient.birthDate) && !patient.guardian) throw badRequest('Cadastre o responsável legal antes (REQ-11)');
      const signer = consentGrantor(patient);
      const hash = sha256(canonicalJson({ patientId: id, templateId: tpl.id, answers: body.answers, signer }));
      const { rows } = await db.query(
        `INSERT INTO anamnesis_responses (clinic_id, patient_id, template_id, template_version, questions_snapshot, answers,
                                          author_id, signed_by_name, signed_by_relation, content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [a.clinicId, id, tpl.id, tpl.version, JSON.stringify(tpl.questions), body.answers, a.userId, signer.name, signer.relation, hash],
      );
      await auditFor(req, db, { action: 'anamnesis.create', entity: 'anamnesis_response', entityId: rows[0].id, patientId: id, metadata: { templateVersion: tpl.version } });
      return { id: rows[0].id, templateVersion: tpl.version, signedByName: signer.name, signedByRelation: signer.relation };
    });
    reply.code(201);
    return result;
  });
}
