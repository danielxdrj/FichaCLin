import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { config } from '../config.js';
import { audit } from '../services/audit.js';
import { auditFor, auth, guards, inClinic, requirePermission, tenant } from '../http/context.js';
import { badRequest, notFound } from '../http/errors.js';

/**
 * Módulo de Suporte.
 *  - Chamados: qualquer membro abre e acompanha os próprios; quem tem `support:manage` (proprietário) vê todos.
 *  - Autorização de acesso do suporte (REQ-30, PDF §6.3/§9 tela 12): só o proprietário concede, sempre com
 *    prazo (máx. 72h), opcionalmente ligada a um chamado; concessão, revogação e expiração vão para a auditoria.
 *  - Canal do encarregado (REQ-10).
 * O suporte continua disponível com o consultório suspenso (sem requireWritable): é quando o cliente mais precisa.
 * A prioridade é só informativa para a fila; não altera nenhuma regra de acesso.
 */

export const CATEGORIES = ['problema_tecnico', 'erro_funcionalidade', 'acesso', 'seguranca', 'duvida', 'orientacao', 'sugestao', 'outro'] as const;
export const PRIORITIES = ['baixa', 'normal', 'alta', 'critica'] as const;
export const STATUSES = ['aberta', 'em_analise', 'aguardando_cliente', 'resolvida', 'encerrada'] as const;
const MAX_GRANT_HOURS = 72;

const idParam = z.object({ id: z.string().uuid() });

const TICKET_COLUMNS = `t.id, t.number, t.category, t.category_other AS "categoryOther", t.priority, t.subject,
  t.status, t.created_at AS "createdAt", t.updated_at AS "updatedAt", t.closed_at AS "closedAt",
  t.created_by AS "createdById", u.name AS "createdBy"`;

function seesAllTickets(req: FastifyRequest) {
  return auth(req).permissions.includes('support:manage');
}

/** Carrega o chamado respeitando RLS (consultório) e visibilidade (autor ou proprietário). */
async function loadTicket(req: FastifyRequest, db: PoolClient, id: string) {
  const { rows } = await db.query(
    `SELECT ${TICKET_COLUMNS}, t.description FROM support_tickets t JOIN users u ON u.id = t.created_by WHERE t.id = $1`,
    [id],
  );
  const t = rows[0];
  if (!t || (!seesAllTickets(req) && t.createdById !== auth(req).userId)) throw notFound('Chamado não encontrado');
  return t;
}

/** Registra na auditoria, uma única vez, as autorizações que venceram (REQ-07/REQ-30). */
async function auditExpiredGrants(db: PoolClient, clinicId: string) {
  const { rows } = await db.query<{ id: string; ticket_id: string | null }>(
    `UPDATE support_grants SET expiry_audited = true
      WHERE revoked_at IS NULL AND expires_at <= now() AND NOT expiry_audited
      RETURNING id, ticket_id`,
  );
  for (const g of rows) {
    await audit(db, { clinicId, userId: null, action: 'support.grant_expired', entity: 'support_grant', entityId: g.id });
  }
}

export async function supportRoutes(app: FastifyInstance) {
  app.get('/api/support', { preHandler: inClinic }, async (req) => {
    const a = auth(req);
    return tenant(req, async (db) => {
      const all = seesAllTickets(req);
      const tickets = (
        await db.query(
          `SELECT ${TICKET_COLUMNS} FROM support_tickets t JOIN users u ON u.id = t.created_by
            ${all ? '' : 'WHERE t.created_by = $1'} ORDER BY t.created_at DESC LIMIT 200`,
          all ? [] : [a.userId],
        )
      ).rows;
      let grants: unknown[] = [];
      if (a.permissions.includes('support:manage')) {
        await auditExpiredGrants(db, a.clinicId!);
        grants = (
          await db.query(
            `SELECT g.id, g.reason, g.created_at AS "startsAt", g.expires_at AS "expiresAt", g.revoked_at AS "revokedAt",
                    round(extract(epoch FROM g.expires_at - g.created_at) / 3600)::int AS "durationHours",
                    gu.name AS "grantedBy", ru.name AS "revokedBy", t.number AS "ticketNumber", t.id AS "ticketId",
                    CASE WHEN g.revoked_at IS NOT NULL THEN 'revogada'
                         WHEN g.expires_at <= now() THEN 'expirada' ELSE 'ativa' END AS status
               FROM support_grants g
               JOIN users gu ON gu.id = g.granted_by
               LEFT JOIN users ru ON ru.id = g.revoked_by
               LEFT JOIN support_tickets t ON t.id = g.ticket_id
              ORDER BY g.created_at DESC LIMIT 100`,
          )
        ).rows;
      }
      return { dpo: config.dpo, tickets, grants, canManage: a.permissions.includes('support:manage'), seesAll: all };
    });
  });

  app.post('/api/support/tickets', { preHandler: inClinic }, async (req, reply) => {
    const body = z
      .object({
        category: z.enum(CATEGORIES),
        categoryOther: z.string().trim().max(120).optional().nullable(),
        priority: z.enum(PRIORITIES).default('normal'),
        subject: z.string().trim().min(5, 'Descreva o assunto em poucas palavras').max(140),
        description: z.string().trim().min(10, 'Descreva o problema com mais detalhes').max(5000),
      })
      .parse(req.body);
    if (body.category === 'outro' && !body.categoryOther) throw badRequest('Informe o motivo do chamado');
    const a = auth(req);
    const result = await tenant(req, async (db) => {
      // Número sequencial por consultório, sem corrida entre requisições simultâneas.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', [a.clinicId]);
      const n = (await db.query<{ n: number }>('SELECT coalesce(max(number), 0) + 1 AS n FROM support_tickets')).rows[0].n;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO support_tickets (clinic_id, number, category, category_other, priority, subject, description, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [a.clinicId, n, body.category, body.category === 'outro' ? body.categoryOther : null, body.priority,
         body.subject, body.description, a.userId],
      );
      // Auditoria sem o texto do chamado (REQ-36).
      await auditFor(req, db, {
        action: 'support.ticket_create', entity: 'support_ticket', entityId: rows[0].id,
        metadata: { number: n, category: body.category, priority: body.priority },
      });
      return { id: rows[0].id, number: n };
    });
    reply.code(201);
    return result;
  });

  app.get('/api/support/tickets/:id', { preHandler: inClinic }, async (req) => {
    const { id } = idParam.parse(req.params);
    return tenant(req, async (db) => {
      const ticket = await loadTicket(req, db, id);
      const events = (
        await db.query(
          `SELECT e.id, e.kind, e.body, e.from_status AS "fromStatus", e.to_status AS "toStatus",
                  e.created_at AS "createdAt", u.name AS "author"
             FROM support_ticket_events e JOIN users u ON u.id = e.author_id
            WHERE e.ticket_id = $1 ORDER BY e.created_at`,
          [id],
        )
      ).rows;
      return { ticket, events };
    });
  });

  app.post('/api/support/tickets/:id/comments', { preHandler: inClinic }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { body } = z.object({ body: z.string().trim().min(2).max(5000) }).parse(req.body);
    const a = auth(req);
    await tenant(req, async (db) => {
      const t = await loadTicket(req, db, id);
      if (t.status === 'encerrada') throw badRequest('Chamado encerrado. Abra um novo chamado.');
      await db.query(
        `INSERT INTO support_ticket_events (clinic_id, ticket_id, kind, body, author_id) VALUES ($1,$2,'comentario',$3,$4)`,
        [a.clinicId, id, body, a.userId],
      );
      await db.query('UPDATE support_tickets SET updated_at = now() WHERE id = $1', [id]);
      await auditFor(req, db, { action: 'support.ticket_comment', entity: 'support_ticket', entityId: id, metadata: { number: t.number } });
    });
    reply.code(201);
    return { ok: true };
  });

  // O cliente pode encerrar o próprio chamado. As demais mudanças de situação são da equipe de suporte
  // (painel interno ainda não implementado — ver docs/produto/REFINAMENTO-UX.md).
  app.post('/api/support/tickets/:id/close', { preHandler: inClinic }, async (req) => {
    const { id } = idParam.parse(req.params);
    const a = auth(req);
    return tenant(req, async (db) => {
      const t = await loadTicket(req, db, id);
      if (t.status === 'encerrada') return { ok: true };
      await db.query(`UPDATE support_tickets SET status = 'encerrada', closed_at = now(), updated_at = now() WHERE id = $1`, [id]);
      await db.query(
        `INSERT INTO support_ticket_events (clinic_id, ticket_id, kind, from_status, to_status, author_id)
         VALUES ($1,$2,'status',$3,'encerrada',$4)`,
        [a.clinicId, id, t.status, a.userId],
      );
      await auditFor(req, db, { action: 'support.ticket_close', entity: 'support_ticket', entityId: id, metadata: { number: t.number } });
      return { ok: true };
    });
  });

  // REQ-30: autorização com prazo; nunca permanente.
  app.post('/api/support/grants', { preHandler: guards(requirePermission('support:manage')) }, async (req, reply) => {
    const body = z
      .object({
        reason: z.string().trim().min(5).max(300),
        hours: z.number().int().min(1).max(MAX_GRANT_HOURS),
        ticketId: z.string().uuid().optional().nullable(),
      })
      .parse(req.body);
    const a = auth(req);
    const result = await tenant(req, async (db) => {
      let ticketNumber: number | null = null;
      if (body.ticketId) {
        const t = await loadTicket(req, db, body.ticketId); // RLS garante que é do mesmo consultório
        if (t.status === 'encerrada') throw badRequest('Não é possível autorizar acesso para um chamado encerrado');
        ticketNumber = t.number;
      }
      const { rows } = await db.query(
        `INSERT INTO support_grants (clinic_id, granted_by, reason, expires_at, ticket_id)
         VALUES ($1,$2,$3, now() + make_interval(hours => $4), $5) RETURNING id, expires_at AS "expiresAt"`,
        [a.clinicId, a.userId, body.reason, body.hours, body.ticketId ?? null],
      );
      await auditFor(req, db, {
        action: 'support.grant', entity: 'support_grant', entityId: rows[0].id,
        metadata: { hours: body.hours, ticketNumber },
      });
      return rows[0];
    });
    reply.code(201);
    return result;
  });

  app.post('/api/support/grants/:id/revoke', { preHandler: guards(requirePermission('support:manage')) }, async (req) => {
    const { id } = idParam.parse(req.params);
    const a = auth(req);
    return tenant(req, async (db) => {
      const r = await db.query(
        'UPDATE support_grants SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()',
        [id, a.userId],
      );
      if (!r.rowCount) throw notFound('Autorização não encontrada ou já encerrada');
      await auditFor(req, db, { action: 'support.revoke', entity: 'support_grant', entityId: id });
      return { ok: true };
    });
  });
}
