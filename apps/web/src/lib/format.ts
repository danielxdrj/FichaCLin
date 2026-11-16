export function initials(name: string): string {
  return name
    .replace(/^(Dra?\.)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T12:00:00') : new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function ageFrom(birthDate: string): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age;
}

/** Mostra só o final do CPF na listagem (minimização de exposição). */
export function maskCpf(cpf: string | null | undefined): string {
  if (!cpf) return '—';
  const digits = cpf.replace(/\D/g, '');
  return digits.length >= 2 ? `•••.•••.•••-${digits.slice(-2)}` : '—';
}

/** Rótulos de apresentação. Os identificadores internos (owner, dentist, reception) não mudam. */
export const ROLE_LABEL: Record<string, string> = { owner: 'Proprietário(a)', dentist: 'Dentista', reception: 'Recepção' };

export const ACTION_LABEL: Record<string, string> = {
  'patient.view': 'Abriu o cadastro',
  'patient.create': 'Cadastrou paciente',
  'patient.update': 'Alterou cadastro',
  'patient.inactivate': 'Inativou paciente',
  'patient.reactivate': 'Reativou paciente',
  'consent.change': 'Alterou consentimento',
  'clinical.view': 'Abriu o histórico clínico',
  'clinical.create': 'Criou registro clínico',
  'clinical.update': 'Editou rascunho',
  'clinical.sign': 'Assinou registro',
  'clinical.addendum': 'Adicionou adendo',
  'odontogram.view': 'Abriu o odontograma',
  'anamnesis.view': 'Abriu a anamnese',
  'anamnesis.create': 'Registrou anamnese',
  'anamnesis_template.create': 'Publicou modelo de anamnese',
  'record.export': 'Exportou o prontuário',
  'record.export_bulk': 'Exportou prontuários em lote',
  'membership.create': 'Adicionou usuário',
  'membership.role_changed': 'Alterou papel',
  'membership.permissions_changed': 'Alterou permissões',
  'membership.active_changed': 'Ativou/desativou usuário',
  'clinic.update': 'Alterou dados do consultório',
  'dpa.accept': 'Aceitou o DPA',
  'support.grant': 'Autorizou acesso do suporte',
  'support.revoke': 'Revogou acesso do suporte',
  'session.enter_clinic': 'Entrou no consultório',
  'clinic.signup': 'Criou a conta do consultório',
  'clinic.require_mfa': 'Alterou exigência de 2FA',
  'support.ticket_create': 'Abriu chamado de suporte',
  'support.ticket_comment': 'Comentou em chamado de suporte',
  'support.ticket_close': 'Encerrou chamado de suporte',
  'support.grant_expired': 'Autorização do suporte expirou',
  'agenda.create': 'Criou compromisso na agenda',
  'agenda.update': 'Alterou compromisso na agenda',
  'agenda.status': 'Alterou situação de compromisso',
};
