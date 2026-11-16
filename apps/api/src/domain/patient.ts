import { z } from 'zod';

/** Idade em anos completos na data de referência (datas ISO 'YYYY-MM-DD'). */
export function ageOn(birthDate: string, today: Date = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  const ty = today.getUTCFullYear();
  const tm = today.getUTCMonth() + 1;
  const td = today.getUTCDate();
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

/** REQ-11: menor de 18 anos exige responsável legal. */
export function isMinor(birthDate: string, today: Date = new Date()): boolean {
  return ageOn(birthDate, today) < 18;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');

export const guardianSchema = z.object({
  name: z.string().trim().min(3, 'Nome do responsável obrigatório'),
  cpf: z.string().trim().min(11, 'CPF do responsável obrigatório'),
  relationship: z.string().trim().min(2, 'Parentesco obrigatório'),
  phone: z.string().trim().min(8, 'Contato do responsável obrigatório'),
});

export const addressSchema = z
  .object({
    cep: z.string().optional(),
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  })
  .default({});

export const CONSENT_PURPOSES = ['marketing', 'image', 'research'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Versão vigente do texto de cada consentimento (REQ-15: registrar versão do texto). */
export const CONSENT_TEXTS: Record<ConsentPurpose, { version: string; text: string }> = {
  marketing: { version: 'marketing-v1', text: 'Autorizo receber lembretes e novidades por WhatsApp e e-mail.' },
  image: { version: 'image-v1', text: 'Autorizo o uso de fotos clínicas em redes sociais e portfólio.' },
  research: { version: 'research-v1', text: 'Autorizo o uso dos meus dados em pesquisa ou estatística não anonimizada.' },
};

/**
 * REQ-14: o cadastro e o prontuário NÃO dependem de consentimento (base legal: tutela da saúde,
 * LGPD art. 11, II, f). Consentimentos abaixo são opcionais e desmarcados por padrão (REQ-15).
 */
export const patientInputSchema = z.object({
  fullName: z.string().trim().min(3, 'Nome completo obrigatório'),
  socialName: z.string().trim().optional().nullable(),
  birthDate: isoDate,
  cpf: z.string().trim().optional().nullable(),
  sex: z.string().optional().nullable(),
  profession: z.string().optional().nullable(),
  maritalStatus: z.string().optional().nullable(),
  phone: z.string().trim().min(8, 'Celular obrigatório'),
  email: z.string().email('E-mail inválido').optional().nullable().or(z.literal('')),
  address: addressSchema,
  notes: z.string().optional().nullable(),
  guardian: guardianSchema.optional().nullable(),
  consents: z
    .object({
      marketing: z.boolean().default(false),
      image: z.boolean().default(false),
      research: z.boolean().default(false),
    })
    .default({}),
});

export type PatientInput = z.infer<typeof patientInputSchema>;

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Regras que dependem de mais de um campo (REQ-11). */
export function validatePatient(input: PatientInput, today: Date = new Date()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const [y] = input.birthDate.split('-').map(Number);
  if (new Date(input.birthDate + 'T00:00:00Z') > today || y < 1900) {
    issues.push({ field: 'birthDate', message: 'Data de nascimento inválida' });
  } else if (isMinor(input.birthDate, today) && !input.guardian) {
    issues.push({ field: 'guardian', message: 'Paciente menor de 18 anos: cadastre o responsável legal' });
  }
  return issues;
}

/**
 * REQ-12: para menores, quem consente é o responsável legal.
 */
export function consentGrantor(input: Pick<PatientInput, 'birthDate' | 'fullName' | 'guardian'>, today = new Date()) {
  if (isMinor(input.birthDate, today) && input.guardian) {
    return { name: input.guardian.name, relation: 'responsavel' as const };
  }
  return { name: input.fullName, relation: 'paciente' as const };
}
