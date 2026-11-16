import { buildApp } from './server.js';
import { config } from './config.js';
import { getPool } from './db/pool.js';

const app = await buildApp({ logger: true });

// REQ-08: expurgo dos registros de acesso com mais de 6 meses (a cada 6 horas).
async function purge() {
  try {
    const { rows } = await getPool().query<{ n: number }>('SELECT purge_access_log() AS n');
    if (rows[0].n) app.log.info(`access_log: ${rows[0].n} registros expurgados`);
  } catch (err) {
    app.log.error({ err: (err as Error).message }, 'falha no expurgo do access_log');
  }
}
await purge();
setInterval(purge, 6 * 3600_000).unref();

await app.listen({ port: config.port, host: '0.0.0.0' });
