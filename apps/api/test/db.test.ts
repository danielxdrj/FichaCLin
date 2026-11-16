import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP_URL = 'postgres://fichaclin_app:dev_app_password@localhost:5434/fichaclin_test';
const OWNER_URL = 'postgres://fichaclin_owner:dev_owner_password@localhost:5434/fichaclin_test';

let app: pg.Client;
let owner: pg.Client;
let clinicA: string;
let clinicB: string;

/** Executa como papel da aplicação, com o contexto de consultório setado (como a API faz). */
async function asClinic<T>(clinicId: string | null, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  await app.query("SELECT set_config('app.clinic_id', $1, true)", [clinicId ?? '']);
  try {
    return await fn();
  } finally {
    await app.query('ROLLBACK');
  }
}

beforeAll(async () => {
  app = new pg.Client({ connectionString: APP_URL });
  owner = new pg.Client({ connectionString: OWNER_URL });
  await app.connect();
  await owner.connect();
  const c = await owner.query("SELECT id, name FROM clinics ORDER BY name");
  clinicA = c.rows.find((r) => r.name.startsWith('Clínica'))!.id;
  clinicB = c.rows.find((r) => r.name.startsWith('Odonto'))!.id;
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe('REQ-26 — isolamento por consultório (RLS)', () => {
  it('sem consultório no contexto, nenhum paciente é visível', async () => {
    const n = await asClinic(null, async () => (await app.query('SELECT count(*)::int AS n FROM patients')).rows[0].n);
    expect(n).toBe(0);
  });

  it('consultório A só vê os próprios pacientes', async () => {
    const rows = await asClinic(clinicA, async () => (await app.query('SELECT clinic_id FROM patients')).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.clinic_id === clinicA)).toBe(true);
  });

  it('não é possível inserir paciente em outro consultório', async () => {
    await expect(
      asClinic(clinicA, () =>
        app.query("INSERT INTO patients (clinic_id, full_name, birth_date) VALUES ($1, 'Intruso', '1990-01-01')", [clinicB]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('o papel da aplicação não tem BYPASSRLS nem é superusuário', async () => {
    const r = await owner.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'fichaclin_app'");
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('REQ-05 / REQ-19 / REQ-07 — imutabilidade no banco', () => {
  it('pacientes não podem ser apagados, nem pelo dono do banco', async () => {
    await expect(owner.query('DELETE FROM patients WHERE clinic_id = $1', [clinicA])).rejects.toThrow(/REQ-05/);
  });

  it('registro clínico assinado não pode ser alterado', async () => {
    await expect(
      owner.query(`UPDATE clinical_entries SET content = '{"text":"alterado"}' WHERE signed_at IS NOT NULL`),
    ).rejects.toThrow(/REQ-19/);
  });

  it('log de auditoria não aceita UPDATE nem DELETE', async () => {
    await owner.query(
      "INSERT INTO audit_log (clinic_id, action, entity) VALUES ($1, 'teste.evento', 'teste')",
      [clinicA],
    );
    await expect(owner.query("UPDATE audit_log SET action = 'x'")).rejects.toThrow(/imutável/);
    await expect(owner.query('DELETE FROM audit_log')).rejects.toThrow(/Exclusão proibida/);
  });

  it('cadeia de hash da auditoria é verificável e detecta adulteração', async () => {
    const ok = await owner.query('SELECT verify_audit_chain($1) AS broken', [clinicA]);
    expect(ok.rows[0].broken).toBeNull();

    // Simula adulteração por alguém que desliga os gatilhos (acesso privilegiado ao banco).
    await owner.query('BEGIN');
    await owner.query('ALTER TABLE audit_log DISABLE TRIGGER audit_no_update');
    await owner.query("UPDATE audit_log SET action = 'adulterado' WHERE id = (SELECT min(id) FROM audit_log WHERE clinic_id = $1)", [clinicA]);
    const broken = await owner.query('SELECT verify_audit_chain($1) AS broken', [clinicA]);
    await owner.query('ROLLBACK');
    expect(broken.rows[0].broken).not.toBeNull();
  });

  it('respostas de anamnese são imutáveis', async () => {
    await expect(owner.query("UPDATE anamnesis_responses SET answers = '{}'")).rejects.toThrow(/imutável/);
  });
});

describe('REQ-08 — registros de acesso por 6 meses', () => {
  it('expurga apenas registros com mais de 6 meses', async () => {
    await owner.query(
      `INSERT INTO access_log (ip, method, route, status, created_at) VALUES
         ('127.0.0.1', 'GET', '/antigo', 200, now() - interval '7 months'),
         ('127.0.0.1', 'GET', '/recente', 200, now() - interval '5 months')`,
    );
    const r = await app.query('SELECT purge_access_log() AS n');
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
    const left = await owner.query("SELECT route FROM access_log WHERE route IN ('/antigo', '/recente')");
    expect(left.rows.map((x) => x.route)).toEqual(['/recente']);
  });

  it('o papel da aplicação não consegue apagar access_log diretamente', async () => {
    await expect(app.query('DELETE FROM access_log')).rejects.toThrow(/permission denied/);
  });
});
