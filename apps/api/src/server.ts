import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { getPool } from './db/pool.js';
import { loadAuth } from './http/context.js';
import { HttpError } from './http/errors.js';
import { authRoutes } from './routes/auth.js';
import { legalRoutes } from './routes/legal.js';
import { clinicRoutes } from './routes/clinic.js';
import { patientRoutes } from './routes/patients.js';
import { clinicalRoutes } from './routes/clinical.js';
import { anamnesisRoutes } from './routes/anamnesis.js';
import { exportRoutes } from './routes/export.js';
import { userRoutes } from './routes/users.js';
import { auditRoutes } from './routes/audit.js';
import { supportRoutes } from './routes/support.js';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    // REQ-13 / REQ-36: logs técnicos sem dados de pacientes e sem credenciais.
    logger: opts.logger
      ? {
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          serializers: {
            req: (r) => ({ method: r.method, url: r.routeOptions?.url ?? 'desconhecida' }),
          },
        }
      : false,
  });

  await app.register(cookie);
  app.decorateRequest('auth', null);

  // Proteção contra CSRF: além do cookie SameSite=Lax, toda escrita precisa deste cabeçalho,
  // que um formulário de outro site não consegue enviar.
  app.addHook('onRequest', async (req, reply) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-fichaclin'] !== '1') {
      reply.code(403).send({ code: 'CSRF', message: 'Requisição sem cabeçalho de origem do aplicativo' });
      return reply;
    }
    await loadAuth(req);
  });

  // REQ-08: registro de acesso (IP, data e hora) — Marco Civil art. 15.
  app.addHook('onResponse', async (req, reply) => {
    try {
      await getPool().query(
        'INSERT INTO access_log (user_id, clinic_id, ip, method, route, status) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.auth?.userId ?? null, req.auth?.clinicId ?? null, req.ip, req.method, req.routeOptions?.url ?? 'desconhecida', reply.statusCode],
      );
    } catch (err) {
      req.log.error({ err: (err as Error).message }, 'falha ao gravar access_log');
    }
  });

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({
        code: 'VALIDATION',
        message: first?.message ?? 'Dados inválidos',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    // Gatilhos de imutabilidade do banco (REQ-05/07/19/21) e RLS (REQ-26).
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '42501') {
      return reply.code(403).send({ code: 'DB_FORBIDDEN', message: err.message });
    }
    const statusCode = (err as Error & { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) {
      return reply.code(statusCode).send({ code: 'BAD_REQUEST', message: err.message });
    }
    req.log.error({ err: err.message }, 'erro interno');
    return reply.code(500).send({ code: 'INTERNAL', message: 'Erro interno. Tente novamente.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(legalRoutes);
  await app.register(clinicRoutes);
  await app.register(patientRoutes);
  await app.register(clinicalRoutes);
  await app.register(anamnesisRoutes);
  await app.register(exportRoutes);
  await app.register(userRoutes);
  await app.register(auditRoutes);
  await app.register(supportRoutes);

  return app;
}
