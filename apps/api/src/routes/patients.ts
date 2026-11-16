import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditFor, auth, guards, requirePermission, requireWritable, tenant } from '../http/context.js';
import { badRequest, notFound } from '../http/errors.js';
import {
  CONSENT_PURPOSES,
  CONSENT_TEXTS,
  consentGrantor,
  isMinor,
  patientInputSchema,
  validatePatient,
  type ConsentPurpose,
  type PatientInput,
} from '../domain/patient.js';

const idParam = z.object({ id: z.string().uuid() });

export const PATIENT_COLUMNS = `id, full_name AS "fullName", social_name AS "socialName", birth_date AS "birthDate",
  cpf, sex, profession, marital_status AS "maritalStatus", phone, email, address, notes, guardian, active,
  inactivated_at AS "inactivatedAt", created_at AS "createdAt"`;

export async function loadPatient(db: PoolClient, id: string) {
  const { rows } = await db.query(`SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Paciente não encontrado');
  return rows[0];
}

/** Consentimento vigente = último registro de cada finalidade (histórico preservado). */
export async function currentConsents(db: PoolClient, patientId: string) {
  // isInitial: única decisão registrada é a do cadastro (consentimento nasce desmarcado — REQ-15),
  // ou seja, "não autorizado" por padrão, sem que o titular tenha sido perguntado de novo.
  const { rows } = await db.query(
    `SELECT DISTINCT ON (c.purpose) c.purpose, c.granted, c.text_version AS "textVersion",
            c.granted_by_name AS "grantedByName", c.granted_by_relation AS "grantedByRelation",
            c.created_at AS "createdAt", u.name AS "collectedBy",
            (SELECT count(*) FROM patient_consents x WHERE x.patient_id = c.patient_id AND x.purpose = c.purpose) = 1 AS "isInitial"
       FROM patient_consents c JOIN users u ON u.id = c.collected_by
      WHERE c.patient_id = $1 ORDER BY c.purpose, c.created_at DESC`,
    [patientId],
  );
  return rows;
}

function checkPatient(input: PatientInput) {
  const issues = validatePatient(input);
  if (issues.length) throw badRequest(issues[0].message, issues);
  // Responsável só faz sentido para menor; adulto não guarda responsável.
  return isMinor(input.birthDate) ? input.guardian ?? null : null;
}

export async function patientRoutes(app: FastifyInstance) {
  // 02 — Lista / busca de pacientes
  app.get('/api/patients', { preHandler: guards(requirePermission('patients:read')) }, async (req) => {
    const q = z
      .object({ q: z.string().optional(), status: z.enum(['active', 'inactive', 'all']).default('active') })
      .parse(req.query);
    return tenant(req, async (db) => {
      const params: unknown[] = [];
      const where: string[] = [];
      if (q.status !== 'all') where.push(`p.active = ${q.status === 'active'}`);
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(`(p.full_name ILIKE $${params.length} OR p.cpf ILIKE $${params.length} OR p.phone ILIKE $${params.length})`);
      }
      const { rows } = await db.query(
        `SELECT p.id, p.full_name AS "fullName", p.social_name AS "socialName", p.birth_date AS "birthDate",
                p.phone, p.cpf, p.active, p.guardian IS NOT NULL AS "hasGuardian",
                (SELECT max(e.created_at) FROM clinical_entries e WHERE e.patient_id = p.id) AS "lastVisit"
           FROM patients p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY p.full_name LIMIT 200`,
        params,
      );
      return { patients: rows };
    });
  });

  // 03 — Cadastro do paciente
  app.post('/api/patients', { preHandler: guards(requirePermission('patients:write'), requireWritable) }, async (req, reply) => {
    const input = patientInputSchema.parse(req.body);
    const guardian = checkPatient(input);
    const a = auth(req);
    const id = await tenant(req, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO patients (clinic_id, full_name, social_name, birth_date, cpf, sex, profession, marital_status,
                               phone, email, address, notes, guardian, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          a.clinicId, input.fullName, input.socialName ?? null, input.birthDate, input.cpf ?? null, input.sex ?? null,
          input.profession ?? null, input.maritalStatus ?? null, input.phone, input.email || null, input.address,
          input.notes ?? null, guardian, a.userId,
        ],
      );
      const patientId = rows[0].id;
      // REQ-15: registra a decisão inicial de cada consentimento (desmarcado por padrão).
      const grantor = consentGrantor({ ...input, guardian });
      for (const purpose of CONSENT_PURPOSES) {
        await insertConsent(db, a.clinicId!, patientId, purpose, input.consents[purpose], grantor, a.userId);
      }
      await auditFor(req, db, { action: 'patient.create', entity: 'patient', entityId: patientId, patientId });
      return patientId;
    });
    reply.code(201);
    return { id };
  });

  app.get('/api/patients/:id', { preHandler: guards(requirePermission('patients:read')) }, async (req) => {
    const { id } = idParam.parse(req.params);
    return tenant(req, async (db) => {
      const patient = await loadPatient(db, id);
      const consents = await currentConsents(db, id);
      await auditFor(req, db, { action: 'patient.view', entity: 'patient', entityId: id, patientId: id });
      return { ...patient, isMinor: isMinor(patient.birthDate), consents };
    });
  });

  app.put('/api/patients/:id', { preHandler: guards(requirePermission('patients:write'), requireWritable) }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = patientInputSchema.parse(req.body);
    const guardian = checkPatient(input);
    return tenant(req, async (db) => {
      await loadPatient(db, id);
      await db.query(
        `UPDATE patients SET full_name=$2, social_name=$3, birth_date=$4, cpf=$5, sex=$6, profession=$7,
                marital_status=$8, phone=$9, email=$10, address=$11, notes=$12, guardian=$13 WHERE id=$1`,
        [
          id, input.fullName, input.socialName ?? null, input.birthDate, input.cpf ?? null, input.sex ?? null,
          input.profession ?? null, input.maritalStatus ?? null, input.phone, input.email || null, input.address,
          input.notes ?? null, guardian,
        ],
      );
      await auditFor(req, db, { action: 'patient.update', entity: 'patient', entityId: id, patientId: id });
      return { ok: true };
    });
  });

  // REQ-15: alteração de consentimento gera novo registro (histórico preservado).
  app.post('/api/patients/:id/consents', { preHandler: guards(requirePermission('patients:write'), requireWritable) }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ purpose: z.enum(CONSENT_PURPOSES), granted: z.boolean() }).parse(req.body);
    const a = auth(req);
    return tenant(req, async (db) => {
      const p = await loadPatient(db, id);
      const grantor = consentGrantor(p);
      if (isMinor(p.birthDate) && !p.guardian) throw badRequest('Cadastre o responsável legal antes (REQ-11)');
      await insertConsent(db, a.clinicId!, id, body.purpose, body.granted, grantor, a.userId);
      await auditFor(req, db, {
        action: 'consent.change', entity: 'patient', entityId: id, patientId: id,
        metadata: { purpose: body.purpose, granted: body.granted },
      });
      return { ok: true };
    });
  });

  // REQ-05: inativar em vez de excluir.
  for (const [path, active] of [['inactivate', false], ['reactivate', true]] as const) {
    app.post(`/api/patients/:id/${path}`, { preHandler: guards(requirePermission('patients:write'), requireWritable) }, async (req) => {
      const { id } = idParam.parse(req.params);
      const a = auth(req);
      return tenant(req, async (db) => {
        await loadPatient(db, id);
        await db.query(
          'UPDATE patients SET active = $2, inactivated_at = $3, inactivated_by = $4 WHERE id = $1',
          [id, active, active ? null : new Date(), active ? null : a.userId],
        );
        await auditFor(req, db, { action: `patient.${path}`, entity: 'patient', entityId: id, patientId: id });
        return { ok: true };
      });
    });
  }
}

async function insertConsent(
  db: PoolClient,
  clinicId: string,
  patientId: string,
  purpose: ConsentPurpose,
  granted: boolean,
  grantor: { name: string; relation: 'paciente' | 'responsavel' },
  userId: string,
) {
  await db.query(
    `INSERT INTO patient_consents (clinic_id, patient_id, purpose, granted, text_version, granted_by_name,
                                   granted_by_relation, collected_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [clinicId, patientId, purpose, granted, CONSENT_TEXTS[purpose].version, grantor.name, grantor.relation, userId],
  );
}
