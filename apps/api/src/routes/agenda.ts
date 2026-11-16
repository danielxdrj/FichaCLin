import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditFor, auth, guards, requirePermission, requireWritable, tenant } from '../http/context.js';
import { badRequest, notFound } from '../http/errors.js';

/**
 * Agenda do consultório (base estrutural).
 * - Conceito separado da auditoria: aqui ficam compromissos planejados, não o registro do que aconteceu.
 * - Sem permissão nova: agenda é atividade administrativa ligada ao cadastro de pacientes, então usa
 *   `patients:read` / `patients:write` (recepção agenda, mas continua sem acesso a dados clínicos — REQ-22).
 * - Isolamento por consultório via RLS (REQ-26). Sem exclusão: compromisso é cancelado.
 * - Auditoria registra criação e alterações sem título nem observações (minimização — REQ-36).
 */
export const KINDS = ['consulta', 'retorno', 'compromisso', 'lembrete'] as const;
export const AGENDA_STATUSES = ['agendado', 'confirmado', 'concluido', 'cancelado', 'faltou'] as const;
const MAX_RANGE_DAYS = 42;

const EVENT_COLUMNS = `e.id, e.kind, e.title, e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.status, e.notes,
  e.patient_id AS "patientId", p.full_name AS "patientName", p.social_name AS "patientSocialName",
  e.professional_id AS "professionalId", pu.name AS "professionalName", e.updated_at AS "updatedAt"`;

const eventSchema = z
  .object({
    kind: z.enum(KINDS),
    title: z.string().trim().min(2, 'Informe um título').max(120),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    patientId: z.string().uuid().nullable().optional(),
    professionalId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((e) => new Date(e.endsAt) > new Date(e.startsAt), { message: 'O término deve ser depois do início', path: ['endsAt'] });

/** Paciente e profissional precisam ser do mesmo consultório (RLS) e o profissional precisa estar ativo. */
async function checkLinks(db: PoolClient, patientId?: string | null, professionalId?: string | null) {
  if (patientId) {
    const p = await db.query('SELECT active FROM patients WHERE id = $1', [patientId]);
    if (!p.rowCount) throw badRequest('Paciente não encontrado');
    if (!p.rows[0].active) throw badRequest('Paciente inativo: reative o cadastro antes de agendar');
  }
  if (professionalId) {
    const m = await db.query(
      "SELECT 1 FROM memberships WHERE user_id = $1 AND clinic_id = app_clinic_id() AND active AND role IN ('owner', 'dentist')",
      [professionalId],
    );
    if (!m.rowCount) throw badRequest('Profissional não encontrado neste consultório');
  }
}

async function loadEvent(db: PoolClient, id: string) {
  const { rows } = await db.query(
    `SELECT ${EVENT_COLUMNS} FROM agenda_events e
       LEFT JOIN patients p ON p.id = e.patient_id LEFT JOIN users pu ON pu.id = e.professional_id
      WHERE e.id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound('Compromisso não encontrado');
  return rows[0];
}

export async function agendaRoutes(app: FastifyInstance) {
  app.get('/api/agenda', { preHandler: guards(requirePermission('patients:read')) }, async (req) => {
    const q = z
      .object({
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
        professionalId: z.string().uuid().optional(),
      })
      .parse(req.query);
    const days = (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86400000;
    if (days <= 0 || days > MAX_RANGE_DAYS) throw badRequest(`Período inválido (máximo ${MAX_RANGE_DAYS} dias)`);
    return tenant(req, async (db) => {
      const params: unknown[] = [q.from, q.to];
      let where = 'e.starts_at < $2 AND e.ends_at > $1';
      if (q.professionalId) {
        params.push(q.professionalId);
        where += ` AND e.professional_id = $${params.length}`;
      }
      const { rows } = await db.query(
        `SELECT ${EVENT_COLUMNS} FROM agenda_events e
           LEFT JOIN patients p ON p.id = e.patient_id LEFT JOIN users pu ON pu.id = e.professional_id
          WHERE ${where} ORDER BY e.starts_at`,
        params,
      );
      return { events: rows };
    });
  });

  // Lista mínima de profissionais (só id e nome) para agendar — não exige `users:manage`.
  app.get('/api/agenda/professionals', { preHandler: guards(requirePermission('patients:read')) }, async (req) =>
    tenant(req, async (db) => {
      const { rows } = await db.query(
        `SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.clinic_id = $1 AND m.active AND m.role IN ('owner', 'dentist') ORDER BY u.name`,
        [auth(req).clinicId],
      );
      return { professionals: rows };
    }),
  );

  app.post('/api/agenda', { preHandler: guards(requirePermission('patients:write'), requireWritable) }, async (req, reply) => {
    const body = eventSchema.parse(req.body);
    const a = auth(req);
    const result = await tenant(req, async (db) => {
      await checkLinks(db, body.patientId, body.professionalId);
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO agenda_events (clinic_id, kind, title, starts_at, ends_at, patient_id, professional_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [a.clinicId, body.kind, body.title, body.startsAt, body.endsAt, body.patientId ?? null, body.professionalId ?? null,
         body.notes || null, a.userId],
      );
      await auditFor(req, db, {
        action: 'agenda.create', entity: 'agenda_event', entityId: rows[0].id, patientId: body.patientId ?? null,
        metadata: { kind: body.kind },
      });
      return loadEvent(db, rows[0].id);
    });
    reply.code(201);
    return result;
  });

  app.patch('/api/agenda/:id', { preHandler: guards(requirePermission('patients:write'), requireWritable) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ status: z.enum(AGENDA_STATUSES).optional(), event: eventSchema.optional() })
      .refine((b) => b.status || b.event, 'Nada para alterar')
      .parse(req.body);
    return tenant(req, async (db) => {
      const before = await loadEvent(db, id);
      if (body.event) {
        await checkLinks(db, body.event.patientId, body.event.professionalId);
        const e = body.event;
        await db.query(
          `UPDATE agenda_events SET kind=$2, title=$3, starts_at=$4, ends_at=$5, patient_id=$6, professional_id=$7,
                  notes=$8, updated_at = now() WHERE id = $1`,
          [id, e.kind, e.title, e.startsAt, e.endsAt, e.patientId ?? null, e.professionalId ?? null, e.notes || null],
        );
      }
      if (body.status && body.status !== before.status) {
        await db.query('UPDATE agenda_events SET status = $2, updated_at = now() WHERE id = $1', [id, body.status]);
      }
      await auditFor(req, db, {
        action: body.status && body.status !== before.status ? 'agenda.status' : 'agenda.update',
        entity: 'agenda_event', entityId: id, patientId: body.event?.patientId ?? before.patientId,
        metadata: body.status ? { from: before.status, to: body.status } : {},
      });
      return loadEvent(db, id);
    });
  });
}
