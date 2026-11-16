import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Aplica as migrações com o papel dono e garante o papel da aplicação (ADR-001). */
export async function migrate(ownerUrl = config.ownerDatabaseUrl, appPassword = config.appDbPassword): Promise<string[]> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    // Papel da aplicação: sem SUPERUSER e sem BYPASSRLS (REQ-26).
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'fichaclin_app'");
    const pwd = client.escapeLiteral(appPassword);
    if (exists.rowCount === 0) {
      await client.query(`CREATE ROLE fichaclin_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${pwd}`);
    } else {
      await client.query(`ALTER ROLE fichaclin_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${pwd}`);
    }
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${file}: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then((applied) => {
      console.log(applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.');
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
