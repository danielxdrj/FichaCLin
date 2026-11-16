import pg from 'pg';

const OWNER_URL = 'postgres://fichaclin_owner:dev_owner_password@localhost:5434/fichaclin_test';

/** Recria o schema do banco de teste, aplica migrações e o seed fictício. */
export default async function setup() {
  const client = new pg.Client({ connectionString: OWNER_URL });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  const { migrate } = await import('../src/db/migrate.js');
  const { seed } = await import('../src/db/seed.js');
  await migrate(OWNER_URL, 'dev_app_password');
  await seed(OWNER_URL);
}
