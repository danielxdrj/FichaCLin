import { formatDateTime } from './format';

export interface ConsentRecord {
  purpose: 'marketing' | 'image' | 'research';
  granted: boolean;
  textVersion: string;
  grantedByName: string;
  grantedByRelation: 'paciente' | 'responsavel';
  createdAt: string;
  collectedBy: string;
  isInitial: boolean;
}

/**
 * Texto único para tela e exportação (REQ-15): situação, de quem é a decisão, quem registrou, quando e versão.
 * "Não autorizado (padrão do cadastro)" deixa claro que ninguém recusou: a caixa apenas nasceu desmarcada.
 */
export function consentStatus(c: ConsentRecord): string {
  if (!c.granted && c.isInitial) return 'Não autorizado (padrão do cadastro)';
  return c.granted ? 'Autorizado' : 'Não autorizado';
}

export function consentDetail(c: ConsentRecord): string {
  const who = c.grantedByRelation === 'responsavel' ? `${c.grantedByName} (responsável legal)` : `${c.grantedByName} (paciente)`;
  const base = `Registrado por ${c.collectedBy} em ${formatDateTime(c.createdAt)} · texto ${c.textVersion.replace(/^.*-/, '')}`;
  return c.granted || !c.isInitial ? `Decisão de ${who} · ${base}` : base;
}
