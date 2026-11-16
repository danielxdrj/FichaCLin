import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { auditFor, auth, guards, requirePermission, requireWritable, tenant } from '../http/context.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { signatureHash } from '../domain/hash.js';
import { loadPatient } from './patients.js';

const idParam = z.object({ id: z.string().uuid() });

const odontogramContent = z.object({
  teeth: z.record(
    z.string().regex(/^\d{2}$/),
    z.object({ status: z.string(), faces: z.array(z.enum(['M', 'D', 'V', 'L', 'O'])).default([]), note: z.string().optional() }),
  ),
  procedures: z
    .array(z.object({ tooth: z.string(), description: z.string(), status: z.enum(['planejado', 'realizado']) }))
    .default([]),
});
const evolutionContent = z.object({ title: z.string().trim().min(2), text: z.string().trim().min(2) });

const ENTRY_COLUMNS = `id, patient_id AS "patientId", kind, content, author_id AS "authorId", author_name AS "authorName",
  author_cro AS "authorCro", amends_id AS "amendsId", created_at AS "createdAt", signed_at AS "signedAt",
  content_hash AS "contentHash", signature_method AS "signatureMethod"`;

interface EntryRow {
  id: string;
  patientId: string;
  kind: string;
  content: unknown;
  authorId: string;
  authorCro: string | null;
  amendsId: string | null;
  createdAt: Date;
  signedAt: Date | null;
  contentHash: string | null;
}

async function loadEntry(db: PoolClient, id: string): Promise<EntryRow> {
  const { rows } = await db.query<EntryRow>(`SELECT ${ENTRY_COLUMNS} FROM clinical_entries WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Registro clínico não encontrado');
  return rows[0];
}

function hashOf(e: EntryRow, signedAt: Date) {
  return signatureHash({
    entryId: e.id,
    patientId: e.patientId,
    kind: e.kind,
    content: e.content,
    authorId: e.authorId,
    authorCro: e.authorCro,
    amendsId: e.amendsId,
    createdAt: new Date(e.createdAt).toISOString(),
    signedAt: signedAt.toISOString(),
  });
}

/** REQ-04 / REQ-19: assina (hash + carimbo de tempo). Depois disso o banco trava o registro. */
async function signEntry(db: PoolClient, entry: EntryRow) {
  const signedAt = new Date();
  const hash = hashOf(entry, signedAt);
  await db.query(
    `UPDATE clinical_entries SET signed_at = $2, content_hash = $3, signature_method = 'simples-2fa' WHERE id = $1`,
    [entry.id, signedAt, hash],
  );
  return { signedAt, hash };
}

async function authorInfo(userId: string) {
  const { rows } = await getPool().query<{ name: string; cro: string | null }>('SELECT name, cro FROM users WHERE id = $1', [userId]);
  return rows[0];
}

export async function clinicalRoutes(app: FastifyInstance) {
  // 06 — Histórico / evolução (ordem cronológica — REQ-19)
  app.get('/api/patients/:id/entries', { preHandler: guards(requirePermission('clinical:read')) }, async (req) => {
    const { id } = idParam.parse(req.params);
    return tenant(req, async (db) => {
      await loadPatient(db, id);
      const { rows } = await db.query(`SELECT ${ENTRY_COLUMNS} FROM clinical_entries WHERE patient_id = $1 ORDER BY created_at`, [id]);
      await auditFor(req, db, { action: 'clinical.view', entity: 'patient', entityId: id, patientId: id });
      return { entries: rows };
    });
  });

  // 05 — Odontograma: último registro do tipo odontograma.
  app.get('/api/patients/:id/odontogram', { preHandler: guards(requirePermission('clinical:read')) }, async (req) => {
    const { id } = idParam.parse(req.params);
    return tenant(req, async (db) => {
      await loadPatient(db, id);
      const { rows } = await db.query(
        `SELECT ${ENTRY_COLUMNS} FROM clinical_entries WHERE patient_id = $1 AND kind = 'odontogram'
          ORDER BY created_at DESC LIMIT 1`,
        [id],
      );
      await auditFor(req, db, { action: 'odontogram.view', entity: 'patient', entityId: id, patientId: id });
      return { entry: rows[0] ?? null };
    });
  });

  app.post('/api/patients/:id/entries', { preHandler: guards(requirePermission('clinical:write'), requireWritable) }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ kind: z.enum(['evolution', 'odontogram']), content: z.unknown(), sign: z.boolean().default(false) })
      .parse(req.body);
    const content = body.kind === 'evolution' ? evolutionContent.parse(body.content) : odontogramContent.parse(body.content);
    const a = auth(req);
    const author = await authorInfo(a.userId); // REQ-19: autor e CRO automáticos
    const result = await tenant(req, async (db) => {
      const p = await loadPatient(db, id);
      if (!p.active) throw badRequest('Paciente inativo: reative antes de registrar atendimento');
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO clinical_entries (clinic_id, patient_id, kind, content, author_id, author_name, author_cro)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [a.clinicId, id, body.kind, content, a.userId, author.name, author.cro],
      );
      const entry = await loadEntry(db, rows[0].id);
      await auditFor(req, db, { action: 'clinical.create', entity: 'clinical_entry', entityId: entry.id, patientId: id, metadata: { kind: body.kind } });
      if (body.sign) {
        await signEntry(db, entry);
        await auditFor(req, db, { action: 'clinical.sign', entity: 'clinical_entry', entityId: entry.id, patientId: id });
      }
      return loadEntry(db, entry.id);
    });
    reply.code(201);
    return result;
  });

  // Rascunho pode ser editado só pelo autor e só antes de assinar.
  app.put('/api/entries/:id', { preHandler: guards(requirePermission('clinical:write'), requireWritable) }, async (req) => {
    const { id } = idParam.parse(req.params);
    const a = auth(req);
    return tenant(req, async (db) => {
      const entry = await loadEntry(db, id);
      if (entry.authorId !== a.userId) throw forbidden('Somente o autor pode editar o rascunho');
      if (entry.signedAt) throw forbidden('Registro assinado não pode ser alterado; use um adendo (REQ-19)', 'ENTRY_SIGNED');
      const content = entry.kind === 'evolution' ? evolutionContent.parse((req.body as any)?.content) : odontogramContent.parse((req.body as any)?.content);
      await db.query('UPDATE clinical_entries SET content = $2 WHERE id = $1', [id, content]);
      await auditFor(req, db, { action: 'clinical.update', entity: 'clinical_entry', entityId: id, patientId: entry.patientId });
      return loadEntry(db, id);
    });
  });

  app.post('/api/entries/:id/sign', { preHandler: guards(requirePermission('clinical:write'), requireWritable) }, async (req) => {
    const { id } = idParam.parse(req.params);
    const a = auth(req);
    if (!a.mfaVerified) throw forbidden('Assinatura exige sessão confirmada com 2FA (REQ-04)', 'MFA_REQUIRED');
    return tenant(req, async (db) => {
      const entry = await loadEntry(db, id);
      if (entry.authorId !== a.userId) throw forbidden('Somente o autor pode assinar o registro');
      if (entry.signedAt) throw forbidden('Registro já assinado', 'ENTRY_SIGNED');
      await signEntry(db, entry);
      await auditFor(req, db, { action: 'clinical.sign', entity: 'clinical_entry', entityId: id, patientId: entry.patientId });
      return loadEntry(db, id);
    });
  });

  // REQ-19: correção por adendo (novo registro assinado, vinculado ao original).
  app.post('/api/entries/:id/addendum', { preHandler: guards(requirePermission('clinical:write'), requireWritable) }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { text } = z.object({ text: z.string().trim().min(2) }).parse(req.body);
    const a = auth(req);
    if (!a.mfaVerified) throw forbidden('Assinatura exige sessão confirmada com 2FA (REQ-04)', 'MFA_REQUIRED');
    const author = await authorInfo(a.userId);
    const result = await tenant(req, async (db) => {
      const original = await loadEntry(db, id);
      if (!original.signedAt) throw badRequest('Rascunhos podem ser editados diretamente; adendo é para registros assinados');
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO clinical_entries (clinic_id, patient_id, kind, content, author_id, author_name, author_cro, amends_id)
         VALUES ($1,$2,'addendum',$3,$4,$5,$6,$7) RETURNING id`,
        [a.clinicId, original.patientId, { text }, a.userId, author.name, author.cro, id],
      );
      const entry = await loadEntry(db, rows[0].id);
      await signEntry(db, entry);
      await auditFor(req, db, { action: 'clinical.addendum', entity: 'clinical_entry', entityId: entry.id, patientId: original.patientId, metadata: { amends: id } });
      return loadEntry(db, entry.id);
    });
    reply.code(201);
    return result;
  });

  // Confere a integridade do registro (REQ-04: hash).
  app.get('/api/entries/:id/verify', { preHandler: guards(requirePermission('clinical:read')) }, async (req) => {
    const { id } = idParam.parse(req.params);
    return tenant(req, async (db) => {
      const entry = await loadEntry(db, id);
      if (!entry.signedAt) return { signed: false, valid: false };
      return { signed: true, valid: hashOf(entry, new Date(entry.signedAt)) === entry.contentHash };
    });
  });
}
