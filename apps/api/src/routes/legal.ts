import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { auth, pendingLegalDocs, requireMfa, requireSession } from '../http/context.js';
import { badRequest, notFound } from '../http/errors.js';

/** REQ-03: Termos de Uso e Política de Privacidade com aceite registrado (versão, data, IP, usuário). */
export async function legalRoutes(app: FastifyInstance) {
  app.get('/api/legal/pending', { preHandler: [requireSession, requireMfa] }, async (req) => {
    const pending = await pendingLegalDocs(auth(req).userId);
    if (pending.length === 0) return { documents: [] };
    const { rows } = await getPool().query(
      'SELECT id, kind, version, title, body, published_at AS "publishedAt" FROM legal_documents WHERE id = ANY($1)',
      [pending.map((d) => d.id)],
    );
    return { documents: rows };
  });

  app.post('/api/legal/accept', { preHandler: [requireSession, requireMfa] }, async (req) => {
    const a = auth(req);
    const { documentIds } = z.object({ documentIds: z.array(z.string().uuid()).min(1) }).parse(req.body);
    const pending = await pendingLegalDocs(a.userId);
    const pendingIds = new Set(pending.map((d) => d.id));
    for (const id of documentIds) {
      if (!pendingIds.has(id)) throw badRequest('Documento não é uma versão vigente pendente de aceite');
    }
    for (const id of documentIds) {
      await getPool().query(
        'INSERT INTO legal_acceptances (document_id, user_id, ip, user_agent) VALUES ($1, $2, $3, $4)',
        [id, a.userId, req.ip, req.headers['user-agent'] ?? null],
      );
    }
    return { ok: true };
  });

  app.get('/api/legal/:kind', async (req) => {
    const { kind } = z.object({ kind: z.enum(['terms', 'privacy', 'dpa']) }).parse(req.params);
    const { rows } = await getPool().query(
      `SELECT id, kind, version, title, body, published_at AS "publishedAt"
         FROM legal_documents WHERE kind = $1 ORDER BY version DESC LIMIT 1`,
      [kind],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });
}
