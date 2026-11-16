/**
 * Dados FICTÍCIOS de desenvolvimento. Nenhum nome, CPF ou contato aqui pertence a pessoa real.
 * Nunca rode este seed em produção.
 *
 * Credenciais de desenvolvimento (somente ambiente local):
 *   senha de todos os usuários: DEV_PASSWORD abaixo
 *   2FA: `npm run dev:totp` mostra o código atual de cada usuário
 */
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { hashPassword } from '../services/password.js';
import { signatureHash, canonicalJson, sha256 } from '../domain/hash.js';

export const DEV_PASSWORD = 'fichaclin-dev-2026';

export const DEV_USERS = [
  { key: 'helena', email: 'helena.prado@dev.fichaclin.test', name: 'Dra. Helena Prado', cro: 'CRO-SP 00001', totp: 'JBSWY3DPEHPK3PXP' },
  { key: 'rafael', email: 'rafael.lima@dev.fichaclin.test', name: 'Dr. Rafael Lima', cro: 'CRO-SP 00002', totp: 'KRSXG5CTMVRXEZLU' },
  { key: 'camila', email: 'camila.souza@dev.fichaclin.test', name: 'Camila Souza', cro: null, totp: null },
] as const;

const RASCUNHO = '**RASCUNHO — texto de exemplo, NÃO usar em produção. Validar com advogado (REQ-34).**\n\n';

const LEGAL_DOCS = [
  {
    kind: 'terms', title: 'Termos de Uso', body: RASCUNHO +
      '1. O Fichaclin é um software de prontuário odontológico contratado pelo consultório.\n' +
      '2. Usuários devem ter 18 anos ou mais e acessar em nome de um consultório contratante (REQ-17).\n' +
      '3. O consultório é o controlador dos dados dos pacientes; o Fichaclin atua como operador (REQ-01).\n' +
      '4. O dentista é responsável pelo conteúdo clínico; o sistema não substitui o julgamento profissional.\n' +
      '5. Em caso de inadimplência, o acesso é suspenso para escrita, mas os prontuários não são apagados e podem ser exportados (REQ-32).',
  },
  {
    kind: 'privacy', title: 'Política de Privacidade', body: RASCUNHO +
      '- Dados de conta, cobrança e registros de acesso: o Fichaclin é controlador.\n' +
      '- Dados de pacientes: o Fichaclin é operador; o paciente deve procurar o consultório para exercer seus direitos.\n' +
      '- Registros de acesso (IP, data e hora) são mantidos por 6 meses (Marco Civil, art. 15).\n' +
      '- Contato do encarregado: ver tela de Suporte.',
  },
  {
    kind: 'dpa', title: 'Acordo de Tratamento de Dados (DPA)', body: RASCUNHO +
      '- Finalidade: prestação do serviço de prontuário eletrônico.\n' +
      '- Suboperadores: hospedagem, armazenamento de arquivos, e-mail transacional (lista a definir).\n' +
      '- Aviso de incidente ao consultório em até 24 horas após a confirmação.\n' +
      '- Devolução e eliminação dos dados ao fim do contrato, respeitada a guarda legal.',
  },
];

const TEMPLATE_QUESTIONS = [
  { id: 'tratamento', section: 'Saúde geral', text: 'Está em tratamento médico atualmente?', type: 'yesno', alert: false },
  { id: 'medicamentos', section: 'Saúde geral', text: 'Faz uso de algum medicamento?', type: 'yesno', alert: false },
  { id: 'alergia', section: 'Saúde geral', text: 'Tem alergia a algum medicamento ou anestésico?', type: 'yesno', alert: true },
  { id: 'cardiaco', section: 'Saúde geral', text: 'Tem problema cardíaco ou pressão alta?', type: 'yesno', alert: true },
  { id: 'diabetes', section: 'Saúde geral', text: 'Tem diabetes?', type: 'yesno', alert: true },
  { id: 'anticoagulante', section: 'Saúde geral', text: 'Usa anticoagulante?', type: 'yesno', alert: true },
  { id: 'gestante', section: 'Saúde geral', text: 'Está gestante?', type: 'yesno', alert: true },
  { id: 'sangramento', section: 'Histórico odontológico', text: 'Teve sangramento excessivo após extração?', type: 'yesno', alert: false },
  { id: 'queixa', section: 'Histórico odontológico', text: 'Qual a queixa principal?', type: 'text', alert: false },
];

const PATIENTS = [
  { fullName: 'Mariana Costa Ribeiro', birthDate: '1988-05-14', sex: 'Feminino', profession: 'Arquiteta', maritalStatus: 'Casado(a)', phone: '(11) 90000-0001', email: 'mariana.ribeiro@exemplo.test', city: 'São Paulo' },
  { fullName: 'João Pedro Almeida', birthDate: '1975-11-02', sex: 'Masculino', profession: 'Engenheiro', maritalStatus: 'Divorciado(a)', phone: '(11) 90000-0002', email: 'joao.almeida@exemplo.test', city: 'São Paulo' },
  { fullName: 'Beatriz Nogueira Santos', birthDate: '1996-03-21', sex: 'Feminino', profession: 'Designer', maritalStatus: 'Solteiro(a)', phone: '(11) 90000-0003', email: null, city: 'Osasco' },
  { fullName: 'Lucas Ferreira Gomes', birthDate: '2015-08-09', sex: 'Masculino', profession: 'Estudante', maritalStatus: 'Solteiro(a)', phone: '(11) 90000-0004', email: null, city: 'São Paulo',
    guardian: { name: 'Patrícia Ferreira Gomes', cpf: '000.000.000-00', relationship: 'Mãe', phone: '(11) 90000-0005' } },
  { fullName: 'Antônio Carlos Mendes', birthDate: '1952-01-30', sex: 'Masculino', profession: 'Aposentado', maritalStatus: 'Casado(a)', phone: '(11) 90000-0006', email: null, city: 'Guarulhos' },
  { fullName: 'Fernanda Oliveira Prado', birthDate: '1983-12-11', sex: 'Feminino', profession: 'Professora', maritalStatus: 'Casado(a)', phone: '(11) 90000-0007', email: 'fernanda.prado@exemplo.test', city: 'São Paulo' },
];

export async function seed(ownerUrl = config.ownerDatabaseUrl): Promise<'seeded' | 'skipped'> {
  const db = new pg.Client({ connectionString: ownerUrl });
  await db.connect();
  try {
    const existing = await db.query('SELECT 1 FROM clinics LIMIT 1');
    if (existing.rowCount) return 'skipped';
    await db.query('BEGIN');

    for (const d of LEGAL_DOCS) {
      await db.query('INSERT INTO legal_documents (kind, version, title, body) VALUES ($1, 1, $2, $3)', [d.kind, d.title, d.body]);
    }

    const pwd = await hashPassword(DEV_PASSWORD);
    const users: Record<string, string> = {};
    for (const u of DEV_USERS) {
      const { rows } = await db.query(
        'INSERT INTO users (email, name, cro, password_hash, totp_secret, totp_enabled) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [u.email, u.name, u.cro, pwd, u.totp, Boolean(u.totp)],
      );
      users[u.key] = rows[0].id;
    }

    const clinicA = (
      await db.query(
        `INSERT INTO clinics (name, legal_name, cnpj, tech_lead_name, tech_lead_cro, phone, email, address, billing_status, plan, trial_ends_at)
         VALUES ('Clínica Sorriso Prado', 'Sorriso Prado Odontologia Ltda. (fictícia)', '00.000.000/0001-00', 'Dra. Helena Prado', 'CRO-SP 00001',
                 '(11) 3000-0000', 'contato@sorrisoprado.test', $1, 'trial', 'essencial', now() + interval '18 days') RETURNING id`,
        [{ cep: '00000-000', street: 'Rua das Acácias', number: '120', district: 'Jardim Exemplo', city: 'São Paulo', state: 'SP' }],
      )
    ).rows[0].id;
    const clinicB = (
      await db.query(
        `INSERT INTO clinics (name, legal_name, cnpj, tech_lead_name, tech_lead_cro, address, billing_status, plan)
         VALUES ('Odonto Centro Vila Nova', 'Odonto Centro Ltda. (fictícia)', '00.000.000/0002-00', 'Dra. Helena Prado', 'CRO-SP 00001',
                 $1, 'suspended', 'essencial') RETURNING id`,
        [{ city: 'Campinas', state: 'SP' }],
      )
    ).rows[0].id;

    const memberships: [string, string, string][] = [
      [clinicA, users.helena, 'owner'],
      [clinicA, users.rafael, 'dentist'],
      [clinicA, users.camila, 'reception'],
      [clinicB, users.helena, 'owner'],
    ];
    for (const [c, u, r] of memberships) {
      await db.query('INSERT INTO memberships (clinic_id, user_id, role) VALUES ($1,$2,$3)', [c, u, r]);
    }

    const tpl = (
      await db.query(
        `INSERT INTO anamnesis_templates (clinic_id, version, title, questions, created_by)
         VALUES ($1, 1, 'Anamnese odontológica padrão', $2, $3) RETURNING id`,
        [clinicA, JSON.stringify(TEMPLATE_QUESTIONS), users.helena],
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO anamnesis_templates (clinic_id, version, title, questions, created_by)
       VALUES ($1, 1, 'Anamnese padrão', $2, $3)`,
      [clinicB, JSON.stringify(TEMPLATE_QUESTIONS.slice(0, 5)), users.helena],
    );

    const patientIds: string[] = [];
    for (const p of PATIENTS) {
      const { rows } = await db.query(
        `INSERT INTO patients (clinic_id, full_name, birth_date, sex, profession, marital_status, phone, email, address, guardian, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [clinicA, p.fullName, p.birthDate, p.sex, p.profession, p.maritalStatus, p.phone, p.email,
         { city: p.city, state: 'SP' }, 'guardian' in p ? p.guardian : null, users.camila],
      );
      patientIds.push(rows[0].id);
      const grantor = 'guardian' in p && p.guardian ? { n: p.guardian.name, r: 'responsavel' } : { n: p.fullName, r: 'paciente' };
      for (const purpose of ['marketing', 'image', 'research']) {
        await db.query(
          `INSERT INTO patient_consents (clinic_id, patient_id, purpose, granted, text_version, granted_by_name, granted_by_relation, collected_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [clinicA, rows[0].id, purpose, purpose === 'marketing' && p.fullName.startsWith('Mariana'), `${purpose}-v1`, grantor.n, grantor.r, users.camila],
        );
      }
    }
    // Paciente do consultório B (para demonstrar o isolamento — REQ-26).
    await db.query(
      `INSERT INTO patients (clinic_id, full_name, birth_date, phone, created_by) VALUES ($1, 'Paciente do Consultório B', '1990-01-01', '(19) 90000-0000', $2)`,
      [clinicB, users.helena],
    );

    // Anamnese e registros clínicos assinados da Mariana.
    const mariana = patientIds[0];
    const answers = {
      tratamento: { value: false }, medicamentos: { value: true, note: 'Losartana 50 mg' }, alergia: { value: true, note: 'Penicilina' },
      cardiaco: { value: true, note: 'Hipertensão controlada' }, diabetes: { value: false }, anticoagulante: { value: false },
      gestante: { value: false }, sangramento: { value: false }, queixa: { value: 'Sensibilidade no dente 36 ao frio' },
    };
    const signer = { name: 'Mariana Costa Ribeiro', relation: 'paciente' };
    await db.query(
      `INSERT INTO anamnesis_responses (clinic_id, patient_id, template_id, template_version, questions_snapshot, answers, author_id,
                                        signed_by_name, signed_by_relation, content_hash)
       VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9)`,
      [clinicA, mariana, tpl, JSON.stringify(TEMPLATE_QUESTIONS), answers, users.helena, signer.name, signer.relation,
       sha256(canonicalJson({ patientId: mariana, templateId: tpl, answers, signer }))],
    );

    const entries = [
      { kind: 'evolution', content: { title: 'Avaliação inicial', text: 'Exame clínico e radiográfico. Cárie oclusal no 36. Planejada restauração em resina.' }, daysAgo: 40 },
      { kind: 'odontogram', content: {
          teeth: { '36': { status: 'carie', faces: ['O'] }, '46': { status: 'restaurado', faces: ['O', 'D'] }, '18': { status: 'ausente', faces: [] }, '21': { status: 'tratamento_canal', faces: [] } },
          procedures: [{ tooth: '36', description: 'Restauração em resina composta', status: 'planejado' }],
        }, daysAgo: 40 },
      { kind: 'evolution', content: { title: 'Restauração 36', text: 'Anestesia infiltrativa. Restauração em resina composta classe I no 36. Paciente orientada.' }, daysAgo: 12 },
    ];
    for (const e of entries) {
      const { rows } = await db.query(
        `INSERT INTO clinical_entries (clinic_id, patient_id, kind, content, author_id, author_name, author_cro, created_at)
         VALUES ($1,$2,$3,$4,$5,'Dra. Helena Prado','CRO-SP 00001', now() - make_interval(days => $6)) RETURNING id, created_at`,
        [clinicA, mariana, e.kind, e.content, users.helena, e.daysAgo],
      );
      const signedAt = new Date(new Date(rows[0].created_at).getTime() + 15 * 60_000);
      const stored = (await db.query('SELECT content FROM clinical_entries WHERE id = $1', [rows[0].id])).rows[0].content;
      const hash = signatureHash({
        entryId: rows[0].id, patientId: mariana, kind: e.kind, content: stored, authorId: users.helena,
        authorCro: 'CRO-SP 00001', amendsId: null, createdAt: new Date(rows[0].created_at).toISOString(), signedAt: signedAt.toISOString(),
      });
      await db.query(
        `UPDATE clinical_entries SET signed_at = $2, content_hash = $3, signature_method = 'simples-2fa' WHERE id = $1`,
        [rows[0].id, signedAt, hash],
      );
    }

    await db.query('COMMIT');
    return 'seeded';
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .then((r) =>
      console.log(r === 'seeded' ? 'Seed de desenvolvimento aplicado (dados fictícios).' : 'Banco já possui dados; seed ignorado.'),
    )
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
