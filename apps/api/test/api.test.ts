import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';
import { closePool } from '../src/db/pool.js';
import { DEV_PASSWORD, DEV_USERS } from '../src/db/seed.js';
import { currentTotp } from '../src/services/totp.js';

const OWNER_URL = 'postgres://fichaclin_owner:dev_owner_password@localhost:5434/fichaclin_test';
let app: FastifyInstance;
let owner: pg.Client;
let clinicA: string;
let clinicB: string;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
interface Session {
  cookie: string;
  call: (method: Method, url: string, body?: unknown) => Promise<{ status: number; body: any }>;
}

async function login(key: (typeof DEV_USERS)[number]['key'], opts: { mfa?: boolean; acceptTerms?: boolean; clinic?: string | null } = {}): Promise<Session> {
  const user = DEV_USERS.find((u) => u.key === key)!;
  const res = await app.inject({
    method: 'POST', url: '/api/auth/login', headers: { 'x-fichaclin': '1' },
    payload: { email: user.email, password: DEV_PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  const cookie = String(res.headers['set-cookie']).split(';')[0];
  const call: Session['call'] = async (method, url, body) => {
    const r = await app.inject({ method, url, headers: { cookie, 'x-fichaclin': '1' }, payload: body as any });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  if (opts.mfa !== false && user.totp) {
    expect((await call('POST', '/api/auth/2fa/verify', { code: currentTotp(user.totp) })).status).toBe(200);
  }
  if (opts.acceptTerms !== false) {
    const pending = await call('GET', '/api/legal/pending');
    if (pending.body.documents.length) {
      await call('POST', '/api/legal/accept', { documentIds: pending.body.documents.map((d: any) => d.id) });
    }
  }
  const clinic = opts.clinic === undefined ? clinicA : opts.clinic;
  if (clinic) expect((await call('POST', '/api/auth/select-clinic', { clinicId: clinic })).status).toBe(200);
  return { cookie, call };
}

const adult = {
  fullName: 'Paciente Teste Adulto', birthDate: '1990-04-10', phone: '(11) 90000-1111', address: { city: 'São Paulo' },
};

beforeAll(async () => {
  app = await buildApp();
  owner = new pg.Client({ connectionString: OWNER_URL });
  await owner.connect();
  const c = await owner.query('SELECT id, name FROM clinics');
  clinicA = c.rows.find((r) => r.name.startsWith('Clínica'))!.id;
  clinicB = c.rows.find((r) => r.name.startsWith('Odonto'))!.id;
});

afterAll(async () => {
  await app.close();
  await owner.end();
  await closePool();
});

describe('Segurança da requisição', () => {
  it('escrita sem cabeçalho do app é rejeitada (CSRF)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@x.test', password: 'x' } });
    expect(r.statusCode).toBe(403);
  });

  it('REQ-08: requisições geram registro de acesso', async () => {
    await app.inject({ method: 'GET', url: '/api/health' });
    // O registro é gravado no hook onResponse, logo após a resposta.
    let n = 0;
    for (let i = 0; i < 20 && n === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      n = (await owner.query("SELECT count(*)::int AS n FROM access_log WHERE route = '/api/health'")).rows[0].n;
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('Login — REQ-24 / REQ-25 / REQ-03', () => {
  it('REQ-24: quem ativou o 2FA precisa do código para acessar dados', async () => {
    const s = await login('helena', { mfa: false, acceptTerms: false, clinic: null });
    const r = await s.call('GET', '/api/patients');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('MFA_REQUIRED');
  });

  it('REQ-24 (divergência): sem 2FA ativado, dentista entra só com senha e assina como "simples"', async () => {
    const helena = await login('helena');
    await helena.call('POST', '/api/users', {
      name: 'Dono Sem 2FA', email: 'dono.sem2fa@dev.fichaclin.test', role: 'dentist', cro: 'CRO-SP 00009', password: 'senha-teste-123',
    });
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { 'x-fichaclin': '1' },
      payload: { email: 'dono.sem2fa@dev.fichaclin.test', password: 'senha-teste-123' },
    });
    const cookie = String(res.headers['set-cookie']).split(';')[0];
    const call = async (method: Method, url: string, body?: unknown) => {
      const r = await app.inject({ method, url, headers: { cookie, 'x-fichaclin': '1' }, payload: body as any });
      return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
    };
    expect((await call('GET', '/api/auth/me')).body.mfa).toMatchObject({ required: false, enabled: false });
    const pending = await call('GET', '/api/legal/pending');
    await call('POST', '/api/legal/accept', { documentIds: pending.body.documents.map((d: any) => d.id) });
    expect((await call('POST', '/api/auth/select-clinic', { clinicId: clinicA })).status).toBe(200);
    const patientId = (await owner.query("SELECT id FROM patients WHERE full_name = 'Mariana Costa Ribeiro'")).rows[0].id;
    const e = await call('POST', `/api/patients/${patientId}/entries`, { kind: 'evolution', content: { title: 'Teste', text: 'Sem 2FA' }, sign: true });
    expect(e.status).toBe(201);
    expect(e.body.signatureMethod).toBe('simples');
  });

  it('REQ-24: consultório pode exigir 2FA; QR code é gerado no cadastro', async () => {
    const helena = await login('helena');
    // Sessão aberta antes da mudança de política não é derrubada.
    const before = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { 'x-fichaclin': '1' },
      payload: { email: 'dono.sem2fa@dev.fichaclin.test', password: 'senha-teste-123' },
    });
    const beforeCookie = String(before.headers['set-cookie']).split(';')[0];
    await app.inject({ method: 'POST', url: '/api/auth/select-clinic', headers: { cookie: beforeCookie, 'x-fichaclin': '1' }, payload: { clinicId: clinicA } });
    expect((await helena.call('PUT', '/api/clinic/security', { requireMfa: true })).status).toBe(200);
    const still = await app.inject({ method: 'GET', url: '/api/patients', headers: { cookie: beforeCookie } });
    expect(still.statusCode).toBe(200);
    // A partir do próximo login, a regra vale.
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { 'x-fichaclin': '1' },
      payload: { email: 'dono.sem2fa@dev.fichaclin.test', password: 'senha-teste-123' },
    });
    const cookie = String(res.headers['set-cookie']).split(';')[0];
    const call = async (method: Method, url: string, body?: unknown) => {
      const r = await app.inject({ method, url, headers: { cookie, 'x-fichaclin': '1' }, payload: body as any });
      return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
    };
    expect((await call('GET', '/api/patients')).body.code).toBe('MFA_REQUIRED');
    const setup = await call('POST', '/api/auth/2fa/setup');
    expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);
    expect((await call('POST', '/api/auth/2fa/verify', { code: currentTotp(setup.body.secret) })).status).toBe(200);
    // Com o consultório exigindo, não dá para desativar.
    const dis = await call('POST', '/api/auth/2fa/disable', { code: currentTotp(setup.body.secret) });
    expect(dis.body.code).toBe('MFA_REQUIRED_BY_CLINIC');
    await helena.call('PUT', '/api/clinic/security', { requireMfa: false });
    expect((await call('POST', '/api/auth/2fa/disable', { code: currentTotp(setup.body.secret) })).status).toBe(200);
  });

  it('REQ-25: bloqueia a conta após 5 senhas erradas', async () => {
    const s = await login('helena');
    const created = await s.call('POST', '/api/users', {
      name: 'Usuário Bloqueio', email: 'bloqueio@dev.fichaclin.test', role: 'reception', password: 'senha-teste-123',
    });
    expect(created.status).toBe(201);
    const attempt = (password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-fichaclin': '1' }, payload: { email: 'bloqueio@dev.fichaclin.test', password } });
    for (let i = 0; i < 5; i++) expect((await attempt('errada-000')).statusCode).toBe(401);
    const locked = await attempt('senha-teste-123');
    expect(locked.statusCode).toBe(423);
  });

  it('REQ-03: exige aceite dos Termos e aceite de nova versão', async () => {
    const s = await login('rafael', { acceptTerms: false, clinic: null });
    const blocked = await s.call('POST', '/api/auth/select-clinic', { clinicId: clinicA });
    expect(blocked.body.code).toBe('TERMS_REQUIRED');
    const pending = await s.call('GET', '/api/legal/pending');
    await s.call('POST', '/api/legal/accept', { documentIds: pending.body.documents.map((d: any) => d.id) });
    expect((await s.call('POST', '/api/auth/select-clinic', { clinicId: clinicA })).status).toBe(200);

    // Prova do aceite: versão, data, IP e usuário.
    const proof = await owner.query(
      `SELECT d.kind, d.version, a.ip, a.accepted_at FROM legal_acceptances a JOIN legal_documents d ON d.id = a.document_id
        JOIN users u ON u.id = a.user_id WHERE u.email = $1`,
      [DEV_USERS[1].email],
    );
    expect(proof.rows.length).toBe(2);
    expect(proof.rows[0].ip).toBeTruthy();

    await owner.query("INSERT INTO legal_documents (kind, version, title, body) VALUES ('terms', 2, 'Termos de Uso v2', 'RASCUNHO v2')");
    const again = await s.call('GET', '/api/patients');
    expect(again.body.code).toBe('TERMS_REQUIRED');
  });
});

describe('Pacientes — REQ-05 / REQ-11 / REQ-12 / REQ-15 / REQ-22', () => {
  it('REQ-22: recepção cadastra paciente mas não vê dados clínicos', async () => {
    const s = await login('camila');
    const created = await s.call('POST', '/api/patients', adult);
    expect(created.status).toBe(201);
    expect((await s.call('GET', `/api/patients/${created.body.id}/entries`)).status).toBe(403);
    expect((await s.call('GET', `/api/patients/${created.body.id}/anamnesis`)).status).toBe(403);
  });

  it('REQ-11: menor sem responsável é recusado; com responsável é aceito', async () => {
    const s = await login('camila');
    const minor = { ...adult, fullName: 'Criança Teste', birthDate: '2016-06-01' };
    const bad = await s.call('POST', '/api/patients', minor);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/responsável legal/);

    const ok = await s.call('POST', '/api/patients', {
      ...minor,
      guardian: { name: 'Responsável Teste', cpf: '000.000.000-00', relationship: 'Mãe', phone: '(11) 90000-2222' },
      consents: { image: true },
    });
    expect(ok.status).toBe(201);
    const detail = await s.call('GET', `/api/patients/${ok.body.id}`);
    expect(detail.body.isMinor).toBe(true);
    const image = detail.body.consents.find((c: any) => c.purpose === 'image');
    // REQ-12: para menor, quem consente é o responsável.
    expect(image).toMatchObject({ granted: true, grantedByName: 'Responsável Teste', grantedByRelation: 'responsavel', textVersion: 'image-v1' });
    // REQ-15: demais consentimentos ficam desmarcados.
    expect(detail.body.consents.find((c: any) => c.purpose === 'marketing').granted).toBe(false);
  });

  it('REQ-05: paciente é inativado, não excluído', async () => {
    const s = await login('helena');
    const created = await s.call('POST', '/api/patients', { ...adult, fullName: 'Paciente Para Inativar' });
    expect((await s.call('POST', `/api/patients/${created.body.id}/inactivate`)).status).toBe(200);
    const list = await s.call('GET', '/api/patients?status=inactive');
    expect(list.body.patients.some((p: any) => p.id === created.body.id)).toBe(true);
    const del = await app.inject({ method: 'DELETE', url: `/api/patients/${created.body.id}`, headers: { cookie: s.cookie, 'x-fichaclin': '1' } });
    expect(del.statusCode).toBe(404); // não existe rota de exclusão
  });

  it('REQ-26: consultório A não acessa paciente do consultório B', async () => {
    const other = await owner.query('SELECT id FROM patients WHERE clinic_id = $1 LIMIT 1', [clinicB]);
    const s = await login('helena');
    expect((await s.call('GET', `/api/patients/${other.rows[0].id}`)).status).toBe(404);
  });
});

describe('Prontuário — REQ-04 / REQ-19 / REQ-21', () => {
  let patientId: string;
  beforeAll(async () => {
    patientId = (await owner.query("SELECT id FROM patients WHERE full_name = 'Mariana Costa Ribeiro'")).rows[0].id;
  });

  it('evolução assinada recebe autor, CRO, hash e fica travada; correção só por adendo', async () => {
    const s = await login('rafael');
    const created = await s.call('POST', `/api/patients/${patientId}/entries`, {
      kind: 'evolution', content: { title: 'Profilaxia', text: 'Raspagem supragengival e profilaxia.' }, sign: true,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ authorName: 'Dr. Rafael Lima', authorCro: 'CRO-SP 00002', signatureMethod: 'simples-2fa' });
    expect(created.body.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const edit = await s.call('PUT', `/api/entries/${created.body.id}`, { content: { title: 'x', text: 'alterado' } });
    expect(edit.status).toBe(403);
    expect(edit.body.code).toBe('ENTRY_SIGNED');

    const add = await s.call('POST', `/api/entries/${created.body.id}/addendum`, { text: 'Correção: incluída aplicação de flúor.' });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ kind: 'addendum', amendsId: created.body.id });

    expect((await s.call('GET', `/api/entries/${created.body.id}/verify`)).body).toEqual({ signed: true, valid: true });
  });

  it('registros do seed também passam na verificação de integridade', async () => {
    const s = await login('helena');
    const entries = (await s.call('GET', `/api/patients/${patientId}/entries`)).body.entries;
    for (const e of entries) expect((await s.call('GET', `/api/entries/${e.id}/verify`)).body.valid).toBe(true);
  });

  it('REQ-21: nova versão do modelo não altera respostas antigas', async () => {
    const s = await login('helena');
    const before = (await s.call('GET', '/api/anamnesis/template')).body.template;
    const v2 = await s.call('POST', '/api/anamnesis/template', {
      title: 'Anamnese v2',
      questions: [...before.questions, { id: 'fumante', text: 'É fumante?', type: 'yesno', alert: false, section: 'Hábitos' }],
    });
    expect(v2.body.version).toBe(before.version + 1);
    const resp = await s.call('POST', `/api/patients/${patientId}/anamnesis`, {
      templateId: v2.body.id, answers: { fumante: { value: false } }, signerConfirmed: true,
    });
    expect(resp.status).toBe(201);
    const list = (await s.call('GET', `/api/patients/${patientId}/anamnesis`)).body.responses;
    expect(list.map((r: any) => r.templateVersion)).toEqual([v2.body.version, before.version]);
  });
});

describe('Consultório suspenso — REQ-32 / REQ-06', () => {
  it('bloqueia escrita, mas permite leitura e exportação', async () => {
    const s = await login('helena', { clinic: clinicB });
    expect((await s.call('POST', '/api/patients', adult)).status).toBe(402);
    const list = await s.call('GET', '/api/patients');
    expect(list.status).toBe(200);
    const exp = await s.call('GET', `/api/patients/${list.body.patients[0].id}/export`);
    expect(exp.status).toBe(200);
    expect(exp.body.format).toBe('fichaclin-prontuario-v1');
  });
});

describe('Auditoria — REQ-07 / REQ-22 / REQ-30 / REQ-33', () => {
  it('registra visualização e exportação do prontuário; cadeia íntegra', async () => {
    const s = await login('helena');
    const patientId = (await owner.query("SELECT id FROM patients WHERE full_name = 'Mariana Costa Ribeiro'")).rows[0].id;
    await s.call('GET', `/api/patients/${patientId}`);
    await s.call('GET', `/api/patients/${patientId}/export`);
    const events = (await s.call('GET', `/api/audit?patientId=${patientId}`)).body.events.map((e: any) => e.action);
    expect(events).toEqual(expect.arrayContaining(['patient.view', 'record.export', 'clinical.sign']));
    expect((await s.call('GET', '/api/audit/verify')).body.intact).toBe(true);
  });

  it('dentista não acessa a auditoria', async () => {
    const s = await login('rafael');
    expect((await s.call('GET', '/api/audit')).status).toBe(403);
  });

  it('alteração de permissão é auditada com antes e depois', async () => {
    const s = await login('helena');
    const users = (await s.call('GET', '/api/users')).body.users;
    const camila = users.find((u: any) => u.email === DEV_USERS[2].email);
    const r = await s.call('PATCH', `/api/memberships/${camila.membershipId}`, {
      permissions: ['patients:read', 'patients:write', 'clinical:read'],
    });
    expect(r.body.effectivePermissions).toContain('clinical:read');
    const ev = (await s.call('GET', '/api/audit?action=membership')).body.events[0];
    expect(ev.action).toBe('membership.permissions_changed');
    expect(ev.metadata.before.permissions).toBeNull();
    // devolve ao padrão
    await s.call('PATCH', `/api/memberships/${camila.membershipId}`, { permissions: null });
  });

  it('REQ-30: autorização de acesso do suporte é registrada', async () => {
    const s = await login('helena');
    const g = await s.call('POST', '/api/support/grants', { reason: 'Investigar erro na exportação', hours: 4 });
    expect(g.status).toBe(201);
    const support = (await s.call('GET', '/api/support')).body;
    expect(support.grants[0]).toMatchObject({ status: 'ativa', durationHours: 4, grantedBy: 'Dra. Helena Prado' });
    expect(support.dpo.email).toBeTruthy();
    expect((await s.call('GET', '/api/audit?action=support')).body.events[0].action).toBe('support.grant');
  });
});

describe('Cadastro do cliente e dispositivo lembrado', () => {
  const inject = async (cookie: string, method: Method, url: string, body?: unknown) => {
    const r = await app.inject({ method, url, headers: { cookie, 'x-fichaclin': '1' }, payload: body as any });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, headers: r.headers };
  };

  it('cria conta com 7 dias grátis, já dentro do consultório, sem exigir 2FA', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/auth/signup', headers: { 'x-fichaclin': '1' },
      payload: { name: 'Cliente Novo', email: 'cliente.novo@dev.fichaclin.test', password: 'senha-teste-123', clinicName: 'Consultório Novo', acceptTerms: true },
    });
    expect(r.statusCode).toBe(201);
    const cookie = String(r.headers['set-cookie']).split(';')[0];
    const me = (await inject(cookie, 'GET', '/api/auth/me')).body;
    expect(me.mfa).toMatchObject({ required: false, enabled: false });
    expect(me.pendingLegal).toEqual([]);
    expect(me.current).toMatchObject({ role: 'owner', billingStatus: 'trial' });
    const clinic = (await inject(cookie, 'GET', '/api/clinic')).body;
    const days = (new Date(clinic.trialEndsAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    // Modelo de anamnese inicial criado; isolamento: não vê pacientes de outros consultórios.
    expect((await inject(cookie, 'GET', '/api/anamnesis/template')).body.template.version).toBe(1);
    expect((await inject(cookie, 'GET', '/api/patients')).body.patients).toEqual([]);
    // Dono sem 2FA não consegue exigir 2FA da equipe (evita se trancar fora).
    const lock = await inject(cookie, 'PUT', '/api/clinic/security', { requireMfa: true });
    expect(lock.status).toBe(409);
    expect(lock.body.code).toBe('OWNER_MFA_REQUIRED');
  });

  it('recusa cadastro sem aceite dos termos ou com e-mail repetido', async () => {
    const base = { name: 'Outro Cliente', email: 'cliente.novo@dev.fichaclin.test', password: 'senha-teste-123', clinicName: 'X' + 'Y' };
    const noTerms = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { 'x-fichaclin': '1' }, payload: base });
    expect(noTerms.statusCode).toBe(400);
    const dup = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { 'x-fichaclin': '1' }, payload: { ...base, acceptTerms: true } });
    expect(dup.statusCode).toBe(409);
  });

  it('com "não solicitar neste dispositivo", o próximo login dispensa o código', async () => {
    const login = () => app.inject({
      method: 'POST', url: '/api/auth/login', headers: { 'x-fichaclin': '1', cookie: trusted },
      payload: { email: 'cliente.novo@dev.fichaclin.test', password: 'senha-teste-123' },
    });
    let trusted = '';
    let cookie = String((await login()).headers['set-cookie']).split(';')[0];
    const setup = (await inject(cookie, 'POST', '/api/auth/2fa/setup')).body;
    const verify = await inject(cookie, 'POST', '/api/auth/2fa/verify', { code: currentTotp(setup.secret), rememberDevice: true });
    expect(verify.status).toBe(200);
    trusted = String(verify.headers['set-cookie']).split(';')[0];
    expect(trusted).toMatch(/^fc_trusted=/);

    // Mesmo dispositivo: entra direto.
    cookie = String((await login()).headers['set-cookie']).split(';')[0];
    expect((await inject(cookie, 'GET', '/api/auth/me')).body.mfa).toMatchObject({ required: true, verified: true });

    // Outro dispositivo (sem o cookie): pede o código.
    const other = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { 'x-fichaclin': '1' },
      payload: { email: 'cliente.novo@dev.fichaclin.test', password: 'senha-teste-123' },
    });
    const otherCookie = String(other.headers['set-cookie']).split(';')[0];
    expect((await inject(otherCookie, 'GET', '/api/auth/me')).body.mfa.verified).toBe(false);

    // Revogar dispositivos: volta a pedir o código.
    await inject(cookie, 'POST', '/api/auth/trusted-devices/revoke');
    cookie = String((await login()).headers['set-cookie']).split(';')[0];
    expect((await inject(cookie, 'GET', '/api/auth/me')).body.mfa.verified).toBe(false);
  });
});
