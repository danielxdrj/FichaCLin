import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { auditFor, auth, guards, requirePermission, tenant } from '../http/context.js';
import { currentConsents, loadPatient } from './patients.js';
import { recordToHtml } from '../services/record-html.js';

/**
 * REQ-06: exportação completa do prontuário (dados estruturados + versão imprimível).
 * REQ-32/REQ-35: disponível mesmo com o consultório suspenso (sem requireWritable) — o cliente que encerra
 * o contrato precisa levar os dados. Cada prontuário exportado gera um evento de auditoria (REQ-07).
 */
const NOTICE =
  'Assinatura eletrônica simples (login + carimbo de tempo + hash SHA-256; "simples-2fa" quando confirmada com 2FA). ' +
  'Sem certificado ICP-Brasil, mantenha a via em papel assinada (Res. CFO 91/2009).';

async function clinicInfo(db: PoolClient, clinicId: string) {
  return (
    await db.query(
      `SELECT name, legal_name AS "legalName", cnpj, tech_lead_name AS "techLeadName", tech_lead_cro AS "techLeadCro"
         FROM clinics WHERE id = $1`,
      [clinicId],
    )
  ).rows[0];
}

/** Monta o prontuário completo de um paciente (RLS garante o consultório). */
export async function buildRecord(db: PoolClient, id: string, clinic: unknown) {
  const patient = await loadPatient(db, id);
  const consents = await currentConsents(db, id);
  const anamnesis = (
    await db.query(
      `SELECT id, template_version AS "templateVersion", questions_snapshot AS questions, answers,
              signed_by_name AS "signedByName", signed_by_relation AS "signedByRelation",
              content_hash AS "contentHash", created_at AS "createdAt"
         FROM anamnesis_responses WHERE patient_id = $1 ORDER BY created_at`,
      [id],
    )
  ).rows;
  const entries = (
    await db.query(
      `SELECT id, kind, content, author_name AS "authorName", author_cro AS "authorCro", amends_id AS "amendsId",
              created_at AS "createdAt", signed_at AS "signedAt", content_hash AS "contentHash",
              signature_method AS "signatureMethod"
         FROM clinical_entries WHERE patient_id = $1 ORDER BY created_at`,
      [id],
    )
  ).rows;
  return {
    format: 'fichaclin-prontuario-v1',
    generatedAt: new Date().toISOString(),
    clinic,
    patient,
    consents,
    anamnesis,
    entries,
    notice: NOTICE,
  };
}

export type PatientRecord = Awaited<ReturnType<typeof buildRecord>>;

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** CSV com separador ";" e BOM, para abrir direto no Excel em português. */
function csv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const t = v == null ? '' : String(v);
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

export async function exportRoutes(app: FastifyInstance) {
  app.get('/api/patients/:id/export', { preHandler: guards(requirePermission('export')) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const a = auth(req);
    return tenant(req, async (db) => {
      const record = await buildRecord(db, id, await clinicInfo(db, a.clinicId!));
      await auditFor(req, db, { action: 'record.export', entity: 'patient', entityId: id, patientId: id });
      return record;
    });
  });

  // Exportação em lote (todos, ativos ou inativos) — usada em Pacientes e em Configurações · Plano.
  app.get('/api/patients/export-all', { preHandler: guards(requirePermission('export')) }, async (req, reply) => {
    const { status } = z.object({ status: z.enum(['all', 'active', 'inactive']).default('all') }).parse(req.query);
    const a = auth(req);
    const { zip, count, clinicName } = await tenant(req, async (db) => {
      const clinic = await clinicInfo(db, a.clinicId!);
      const exporter = (await db.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [a.userId])).rows[0]?.name ?? '—';
      const where = status === 'all' ? '' : `WHERE active = ${status === 'active'}`;
      const ids = (await db.query<{ id: string }>(`SELECT id FROM patients ${where} ORDER BY full_name`)).rows.map((r) => r.id);
      const files: Zippable = {};
      const index: (string | number | null)[][] = [
        ['Nome', 'Nome social', 'Nascimento', 'CPF', 'Telefone', 'E-mail', 'Situação', 'Responsável legal', 'Registros clínicos', 'Anamneses', 'Pasta'],
      ];
      for (const id of ids) {
        const r = await buildRecord(db, id, clinic);
        const p = r.patient;
        const folder = `pacientes/${slug(p.fullName)}-${String(id).slice(0, 8)}`;
        files[`${folder}/prontuario.json`] = strToU8(JSON.stringify(r, null, 2));
        files[`${folder}/prontuario.html`] = strToU8(recordToHtml(r));
        index.push([
          p.fullName, p.socialName, p.birthDate, p.cpf, p.phone, p.email, p.active ? 'Ativo' : 'Inativo',
          p.guardian?.name ?? null, r.entries.length, r.anamnesis.length, folder,
        ]);
        // REQ-07: cada prontuário exportado fica na trilha do paciente.
        await auditFor(req, db, { action: 'record.export', entity: 'patient', entityId: id, patientId: id, metadata: { bulk: true } });
      }
      const generatedAt = new Date();
      files['pacientes.csv'] = strToU8(csv(index));
      files['LEIA-ME.txt'] = strToU8(
        [
          `Exportação de prontuários — ${clinic.legalName || clinic.name}`,
          `Gerada em ${generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} por ${exporter}`,
          `Pacientes: ${ids.length} (${status === 'all' ? 'todos' : status === 'active' ? 'ativos' : 'inativos'})`,
          '',
          'Conteúdo:',
          '  pacientes.csv                       índice de pacientes (abre no Excel)',
          '  pacientes/<nome>/prontuario.json    dados estruturados completos (formato fichaclin-prontuario-v1)',
          '  pacientes/<nome>/prontuario.html    versão para leitura e impressão (abra no navegador e use "Salvar como PDF")',
          '',
          'ATENÇÃO: este arquivo contém dados pessoais sensíveis de saúde (LGPD art. 5º, II).',
          'Guarde em local seguro e criptografado. O prontuário deve ser mantido por no mínimo 20 anos',
          'a partir do último registro (Lei 13.787/2018).',
          '',
          NOTICE,
        ].join('\r\n'),
      );
      await auditFor(req, db, { action: 'record.export_bulk', entity: 'clinic', entityId: a.clinicId, metadata: { status, count: ids.length } });
      return { zip: zipSync(files, { level: 6 }), count: ids.length, clinicName: clinic.name as string };
    });
    const date = new Date().toISOString().slice(0, 10);
    reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="fichaclin-${slug(clinicName)}-${status}-${date}.zip"`)
      .header('x-fichaclin-count', String(count))
      .header('cache-control', 'no-store');
    return reply.send(Buffer.from(zip));
  });
}
