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
type Call = (method: Method, url: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function login(key: (typeof DEV_USERS)[number]['key'], clinic: string): Promise<{ call: Call }> {
  const user = DEV_USERS.find((u) => u.key === key)!;
  const res = await app.inject({
    method: 'POST', url: '/api/auth/login', headers: { 'x-fichaclin': '1' },
    payload: { email: user.email, password: DEV_PASSWORD },
  });
  const cookie = String(res.headers['set-cookie']).split(';')[0];
  const call: Call = async (method, url, body) => {
    const r = await app.inject({ method, url, headers: { cookie, 'x-fichaclin': '1' }, payload: body as any });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  const me = (await call('GET', '/api/auth/me')).body;
  if (me.mfa.required && !me.mfa.verified) await call('POST', '/api/auth/2fa/verify', { code: currentTotp(user.totp!) });
  const pending = (await call('GET', '/api/legal/pending')).body.documents;
  if (pending.length) await call('POST', '/api/legal/accept', { documentIds: pending.map((d: any) => d.id) });
  expect((await call('POST', '/api/auth/select-clinic', { clinicId: clinic })).status).toBe(200);
  return { call };
}

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

describe('Suporte — chamados', () => {
  it('qualquer membro abre chamado; número sequencial; auditoria sem o texto', async () => {
    const camila = await login('camila', clinicA);
    const t1 = await camila.call('POST', '/api/support/tickets', {
      category: 'erro_funcionalidade', priority: 'alta', subject: 'Erro ao salvar paciente', description: 'Ao salvar aparece erro genérico.',
    });
    expect(t1.status).toBe(201);
    const t2 = await camila.call('POST', '/api/support/tickets', {
      category: 'duvida', subject: 'Como exportar prontuário', description: 'Onde fica a opção de exportação?',
    });
    expect(t2.body.number).toBe(t1.body.number + 1);
    const ev = await owner.query("SELECT metadata FROM audit_log WHERE action = 'support.ticket_create' AND entity_id = $1", [t1.body.id]);
    expect(ev.rows[0].metadata).toEqual({ number: t1.body.number, category: 'erro_funcionalidade', priority: 'alta' });
    expect(JSON.stringify(ev.rows[0].metadata)).not.toContain('erro genérico');
  });

  it('"Outro" exige motivo informado', async () => {
    const camila = await login('camila', clinicA);
    const r = await camila.call('POST', '/api/support/tickets', { category: 'outro', subject: 'Assunto qualquer', description: 'Descrição suficiente.' });
    expect(r.status).toBe(400);
    const ok = await camila.call('POST', '/api/support/tickets', {
      category: 'outro', categoryOther: 'Integração com laboratório', subject: 'Assunto qualquer', description: 'Descrição suficiente.',
    });
    expect(ok.status).toBe(201);
  });

  it('membro vê só os próprios chamados; proprietário vê todos', async () => {
    const rafael = await login('rafael', clinicA);
    await rafael.call('POST', '/api/support/tickets', { category: 'acesso', subject: 'Não recebo código', description: 'O código do 2FA não chega.' });
    const mine = (await rafael.call('GET', '/api/support')).body;
    expect(mine.tickets.every((t: any) => t.createdBy === 'Dr. Rafael Lima')).toBe(true);
    expect(mine.grants).toEqual([]);
    const camilaTicket = (await owner.query("SELECT t.id FROM support_tickets t JOIN users u ON u.id = t.created_by WHERE u.name = 'Camila Souza' LIMIT 1")).rows[0].id;
    expect((await rafael.call('GET', `/api/support/tickets/${camilaTicket}`)).status).toBe(404);

    const helena = await login('helena', clinicA);
    const all = (await helena.call('GET', '/api/support')).body;
    expect(new Set(all.tickets.map((t: any) => t.createdBy))).toEqual(new Set(['Camila Souza', 'Dr. Rafael Lima']));
  });

  it('comentar e encerrar; encerrado não aceita comentário', async () => {
    const camila = await login('camila', clinicA);
    const t = (await camila.call('POST', '/api/support/tickets', { category: 'duvida', subject: 'Dúvida rápida', description: 'Pergunta de teste.' })).body;
    expect((await camila.call('POST', `/api/support/tickets/${t.id}/comments`, { body: 'Mais detalhes.' })).status).toBe(201);
    expect((await camila.call('POST', `/api/support/tickets/${t.id}/close`)).status).toBe(200);
    const detail = (await camila.call('GET', `/api/support/tickets/${t.id}`)).body;
    expect(detail.ticket.status).toBe('encerrada');
    expect(detail.events.map((e: any) => e.kind)).toEqual(['comentario', 'status']);
    expect((await camila.call('POST', `/api/support/tickets/${t.id}/comments`, { body: 'Depois de encerrar' })).status).toBe(400);
  });

  it('isolamento: consultório B não enxerga chamado do consultório A', async () => {
    const t = (await owner.query('SELECT id FROM support_tickets WHERE clinic_id = $1 LIMIT 1', [clinicA])).rows[0].id;
    const helenaB = await login('helena', clinicB);
    expect((await helenaB.call('GET', `/api/support/tickets/${t}`)).status).toBe(404);
    expect((await helenaB.call('GET', '/api/support')).body.tickets).toEqual([]);
    // Suporte funciona mesmo com o consultório suspenso.
    expect((await helenaB.call('POST', '/api/support/tickets', { category: 'duvida', subject: 'Plano suspenso', description: 'Como regularizar?' })).status).toBe(201);
  });
});

describe('Suporte — autorização de acesso (REQ-30)', () => {
  it('só o proprietário autoriza; prazo máximo de 72h; vínculo com chamado do mesmo consultório', async () => {
    const rafael = await login('rafael', clinicA);
    expect((await rafael.call('POST', '/api/support/grants', { reason: 'Teste de permissão', hours: 4 })).status).toBe(403);
    const helena = await login('helena', clinicA);
    expect((await helena.call('POST', '/api/support/grants', { reason: 'Acesso longo demais', hours: 24 * 30 })).status).toBe(400);
    const ticketB = (await owner.query('SELECT id FROM support_tickets WHERE clinic_id = $1 LIMIT 1', [clinicB])).rows[0].id;
    expect((await helena.call('POST', '/api/support/grants', { reason: 'Chamado de outro consultório', hours: 2, ticketId: ticketB })).status).toBe(404);
    const ticketA = (await owner.query("SELECT id, number FROM support_tickets WHERE clinic_id = $1 AND status <> 'encerrada' LIMIT 1", [clinicA])).rows[0];
    const g = await helena.call('POST', '/api/support/grants', { reason: 'Analisar o chamado', hours: 2, ticketId: ticketA.id });
    expect(g.status).toBe(201);
    const grant = (await helena.call('GET', '/api/support')).body.grants.find((x: any) => x.id === g.body.id);
    expect(grant).toMatchObject({ status: 'ativa', durationHours: 2, ticketNumber: ticketA.number, grantedBy: 'Dra. Helena Prado' });
  });

  it('revogação registra quem revogou; expiração vai para a auditoria uma única vez', async () => {
    const helena = await login('helena', clinicA);
    const g = (await helena.call('POST', '/api/support/grants', { reason: 'Será revogada', hours: 1 })).body;
    expect((await helena.call('POST', `/api/support/grants/${g.id}/revoke`)).status).toBe(200);
    const revoked = (await helena.call('GET', '/api/support')).body.grants.find((x: any) => x.id === g.id);
    expect(revoked).toMatchObject({ status: 'revogada', revokedBy: 'Dra. Helena Prado' });

    const e = (await helena.call('POST', '/api/support/grants', { reason: 'Vai expirar', hours: 1 })).body;
    await owner.query("UPDATE support_grants SET expires_at = now() - interval '1 minute', created_at = now() - interval '61 minutes' WHERE id = $1", [e.id]);
    await helena.call('GET', '/api/support');
    await helena.call('GET', '/api/support');
    const n = await owner.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'support.grant_expired' AND entity_id = $1", [e.id]);
    expect(n.rows[0].n).toBe(1);
  });
});

describe('Agenda', () => {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  const at = (h: number) => new Date(day.getTime() + (h - 12) * 3600000).toISOString();

  it('recepção agenda consulta com paciente e profissional; auditoria sem título', async () => {
    const camila = await login('camila', clinicA);
    const patient = (await owner.query("SELECT id FROM patients WHERE full_name = 'Mariana Costa Ribeiro'")).rows[0].id;
    const pro = (await camila.call('GET', '/api/agenda/professionals')).body.professionals;
    expect(pro.map((p: any) => p.name)).toEqual(expect.arrayContaining(['Dr. Rafael Lima', 'Dra. Helena Prado']));
    expect(pro.map((p: any) => p.name)).not.toContain('Camila Souza'); // recepção não é profissional
    const rafaelId = pro.find((p: any) => p.name === 'Dr. Rafael Lima').id;
    const r = await camila.call('POST', '/api/agenda', {
      kind: 'consulta', title: 'Avaliação', startsAt: at(9), endsAt: at(10), patientId: patient, professionalId: rafaelId,
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ patientName: 'Mariana Costa Ribeiro', professionalName: 'Dr. Rafael Lima', status: 'agendado' });
    const list = (await camila.call('GET', `/api/agenda?from=${encodeURIComponent(at(0))}&to=${encodeURIComponent(at(24))}`)).body.events;
    expect(list.some((e: any) => e.id === r.body.id)).toBe(true);
    const ev = await owner.query("SELECT metadata FROM audit_log WHERE action = 'agenda.create' AND entity_id = $1", [r.body.id]);
    expect(ev.rows[0].metadata).toEqual({ kind: 'consulta' });
  });

  it('valida horário, profissional e paciente do mesmo consultório', async () => {
    const camila = await login('camila', clinicA);
    expect((await camila.call('POST', '/api/agenda', { kind: 'compromisso', title: 'Inverso', startsAt: at(11), endsAt: at(10) })).status).toBe(400);
    const patientB = (await owner.query('SELECT id FROM patients WHERE clinic_id = $1 LIMIT 1', [clinicB])).rows[0].id;
    const r = await camila.call('POST', '/api/agenda', { kind: 'consulta', title: 'Outro consultório', startsAt: at(13), endsAt: at(14), patientId: patientB });
    expect(r.status).toBe(400);
    const camilaId = (await owner.query("SELECT id FROM users WHERE name = 'Camila Souza'")).rows[0].id;
    const r2 = await camila.call('POST', '/api/agenda', { kind: 'consulta', title: 'Recepção não é profissional', startsAt: at(13), endsAt: at(14), professionalId: camilaId });
    expect(r2.status).toBe(400);
  });

  it('cancelar em vez de excluir; consultório B não vê nem altera', async () => {
    const camila = await login('camila', clinicA);
    const e = (await camila.call('POST', '/api/agenda', { kind: 'lembrete', title: 'Ligar para laboratório', startsAt: at(15), endsAt: at(15.5) })).body;
    const c = await camila.call('PATCH', `/api/agenda/${e.id}`, { status: 'cancelado' });
    expect(c.body.status).toBe('cancelado');
    await expect(owner.query('DELETE FROM agenda_events WHERE id = $1', [e.id])).rejects.toThrow(/Exclusão proibida/);

    const helenaB = await login('helena', clinicB);
    // B está suspenso: é barrado antes (402); de todo modo, o RLS não acharia o compromisso de A.
    expect([402, 404]).toContain((await helenaB.call('PATCH', `/api/agenda/${e.id}`, { status: 'confirmado' })).status);
    expect((await owner.query('SELECT status FROM agenda_events WHERE id = $1', [e.id])).rows[0].status).toBe('cancelado');
    const listB = (await helenaB.call('GET', `/api/agenda?from=${encodeURIComponent(at(0))}&to=${encodeURIComponent(at(24))}`)).body.events;
    expect(listB).toEqual([]);
    // Consultório suspenso não grava na agenda (REQ-32).
    expect((await helenaB.call('POST', '/api/agenda', { kind: 'lembrete', title: 'Teste', startsAt: at(8), endsAt: at(9) })).status).toBe(402);
  });
});
