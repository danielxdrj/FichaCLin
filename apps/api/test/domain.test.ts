import { describe, expect, it } from 'vitest';
import { ageOn, consentGrantor, isMinor, patientInputSchema, validatePatient } from '../src/domain/patient.js';
import { can, effectivePermissions, requiresMfa } from '../src/domain/permissions.js';
import { canonicalJson, signatureHash } from '../src/domain/hash.js';
import { passwordProblems } from '../src/services/password.js';

const today = new Date('2026-11-16T12:00:00Z');
const base = { fullName: 'Paciente Fictício', phone: '(11) 90000-0000', address: {} };

describe('REQ-11 — idade e responsável legal', () => {
  it('calcula idade considerando mês e dia', () => {
    expect(ageOn('2008-11-16', today)).toBe(18);
    expect(ageOn('2008-11-17', today)).toBe(17);
  });

  it('menor de 18 sem responsável é inválido', () => {
    const input = patientInputSchema.parse({ ...base, birthDate: '2015-01-01' });
    expect(validatePatient(input, today)).toEqual([expect.objectContaining({ field: 'guardian' })]);
  });

  it('menor com responsável e adulto sem responsável são válidos', () => {
    const minor = patientInputSchema.parse({
      ...base, birthDate: '2015-01-01',
      guardian: { name: 'Responsável Fictício', cpf: '00000000000', relationship: 'Mãe', phone: '(11) 90000-0001' },
    });
    expect(validatePatient(minor, today)).toEqual([]);
    expect(validatePatient(patientInputSchema.parse({ ...base, birthDate: '1990-01-01' }), today)).toEqual([]);
  });

  it('rejeita data de nascimento no futuro', () => {
    expect(validatePatient(patientInputSchema.parse({ ...base, birthDate: '2030-01-01' }), today)[0].field).toBe('birthDate');
  });
});

describe('REQ-12 / REQ-14 / REQ-15 — consentimentos', () => {
  it('consentimentos são opcionais e desmarcados por padrão', () => {
    const p = patientInputSchema.parse({ ...base, birthDate: '1990-01-01' });
    expect(p.consents).toEqual({ marketing: false, image: false, research: false });
  });

  it('para menor, quem consente é o responsável', () => {
    const guardian = { name: 'Responsável Fictício', cpf: '0', relationship: 'Pai', phone: '0' };
    expect(consentGrantor({ fullName: 'Criança', birthDate: '2016-01-01', guardian }, today)).toEqual({
      name: 'Responsável Fictício', relation: 'responsavel',
    });
    expect(consentGrantor({ fullName: 'Adulto', birthDate: '1990-01-01', guardian: null }, today).relation).toBe('paciente');
    expect(isMinor('2016-01-01', today)).toBe(true);
  });
});

describe('REQ-22 / REQ-24 — papéis e 2FA', () => {
  it('recepção não acessa dados clínicos por padrão', () => {
    const perms = effectivePermissions('reception', null);
    expect(can(perms, 'patients:write')).toBe(true);
    expect(can(perms, 'clinical:read')).toBe(false);
  });

  it('permissões exclusivas do dono não podem ser concedidas a outros papéis', () => {
    expect(effectivePermissions('dentist', ['clinical:read', 'audit:read', 'users:manage'])).toEqual(['clinical:read']);
  });

  it('2FA é obrigatório para dono e dentista, não para recepção', () => {
    expect(requiresMfa(['owner'])).toBe(true);
    expect(requiresMfa(['dentist'])).toBe(true);
    expect(requiresMfa(['reception'])).toBe(false);
  });
});

describe('REQ-04 — hash da assinatura', () => {
  it('JSON canônico ignora a ordem das chaves', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }));
  });

  it('qualquer alteração de conteúdo muda o hash', () => {
    const p = {
      entryId: 'e', patientId: 'p', kind: 'evolution', content: { text: 'a' }, authorId: 'u', authorCro: 'CRO',
      amendsId: null, createdAt: '2026-01-01T00:00:00.000Z', signedAt: '2026-01-01T00:10:00.000Z',
    };
    expect(signatureHash(p)).toMatch(/^[0-9a-f]{64}$/);
    expect(signatureHash(p)).not.toBe(signatureHash({ ...p, content: { text: 'b' } }));
  });
});

describe('Política de senha', () => {
  it('exige tamanho mínimo, letras e números', () => {
    expect(passwordProblems('curta1')).not.toBeNull();
    expect(passwordProblems('somenteletrasaqui')).not.toBeNull();
    expect(passwordProblems('senha-valida-123')).toBeNull();
  });
});
