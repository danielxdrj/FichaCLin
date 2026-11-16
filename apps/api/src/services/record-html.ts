import type { PatientRecord } from '../routes/export.js';

/**
 * Versão imprimível do prontuário (mesmo conteúdo da página de exportação da web), usada na exportação em lote.
 * HTML autocontido: sem scripts e sem recursos externos.
 */
const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmtDate = (v: unknown) => {
  if (!v) return '—';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.length === 10
    ? new Date(s + 'T12:00:00').toLocaleDateString('pt-BR')
    : new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
};

const CONSENT_LABEL: Record<string, string> = {
  marketing: 'Lembretes e novidades por WhatsApp e e-mail',
  image: 'Uso de fotos clínicas em redes sociais e portfólio',
  research: 'Uso dos dados em pesquisa ou estatística não anonimizada',
};
const TOOTH_STATUS: Record<string, string> = {
  higido: 'Hígido', carie: 'Cárie', restaurado: 'Restauração', tratamento_canal: 'Canal', coroa: 'Coroa', ausente: 'Ausente / extraído',
};

/** Mesmo texto da tela (apps/web/src/lib/consent.ts). */
function consentText(c: any) {
  const status = !c.granted && c.isInitial ? 'Não autorizado (padrão do cadastro)' : c.granted ? 'Autorizado' : 'Não autorizado';
  const who = c.grantedByRelation === 'responsavel' ? `${c.grantedByName} (responsável legal)` : `${c.grantedByName} (paciente)`;
  const base = `Registrado por ${c.collectedBy} em ${fmtDate(c.createdAt)} · texto ${String(c.textVersion).replace(/^.*-/, '')}`;
  return `<strong>${esc(status)}</strong><br>${esc(c.granted || !c.isInitial ? `Decisão de ${who} · ${base}` : base)}`;
}

export function recordToHtml(r: PatientRecord): string {
  const p: any = r.patient;
  const c: any = r.clinic;
  const rows = (pairs: [string, string][]) => pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('');
  const anamnesis = r.anamnesis
    .map((a: any) => `
      <p><strong>${esc(fmtDate(a.createdAt))}</strong> · modelo v${esc(a.templateVersion)} · confirmado por ${esc(a.signedByName)} (${esc(a.signedByRelation)})</p>
      <table>${a.questions.map((q: any) => {
        const ans = a.answers[q.id];
        const val = ans == null ? '—' : typeof ans.value === 'boolean' ? (ans.value ? 'Sim' : 'Não') : ans.value;
        return `<tr><td>${esc(q.text)}</td><td>${esc(val)}${ans?.note ? ` — ${esc(ans.note)}` : ''}</td></tr>`;
      }).join('')}</table>
      <p class="small">Hash: ${esc(a.contentHash)}</p>`)
    .join('') || '<p>Nenhuma.</p>';
  const entries = r.entries
    .map((e: any) => {
      let body = '';
      if (e.kind === 'evolution') body = `<strong>${esc(e.content.title)}</strong><br>${esc(e.content.text)}`;
      else if (e.kind === 'addendum') body = `<strong>Adendo</strong><br>${esc(e.content.text)}`;
      else body = `<strong>Odontograma</strong><br>${esc(Object.entries(e.content.teeth ?? {}).map(([n, t]: [string, any]) => `${n}: ${TOOTH_STATUS[t.status] ?? t.status}${t.faces?.length ? ` (${t.faces.join('')})` : ''}`).join(' · '))}`;
      const sig = e.signedAt ? `${esc(fmtDate(e.signedAt))}<br>${esc(e.signatureMethod)}<br>${esc(e.contentHash)}` : 'Rascunho (não assinado)';
      return `<tr><td>${esc(fmtDate(e.createdAt))}</td><td>${body}</td><td>${esc(e.authorName)}<br>${esc(e.authorCro ?? '')}</td><td class="small">${sig}</td></tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prontuário — ${esc(p.fullName)}</title>
<style>
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #111; max-width: 820px; margin: 24px auto; padding: 0 16px; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 22px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
  td, th { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; } th { width: 30%; background: #f7f7f7; }
  .small { font-size: 11px; color: #555; word-break: break-all; } p { margin: 4px 0; }
</style></head><body>
<h1>Prontuário odontológico</h1>
<p>${esc(c.legalName || c.name)}${c.cnpj ? ` · CNPJ ${esc(c.cnpj)}` : ''}</p>
<p>Responsável técnico: ${esc(c.techLeadName ?? '—')} ${esc(c.techLeadCro ?? '')}</p>
<p class="small">Gerado em ${esc(fmtDate(r.generatedAt))} · formato ${esc(r.format)}</p>
<h2>Paciente</h2>
<table>${rows([
  ['Nome', `${esc(p.fullName)}${p.socialName ? ` (nome social: ${esc(p.socialName)})` : ''}`],
  ['Nascimento', esc(fmtDate(p.birthDate))],
  ['CPF', esc(p.cpf ?? '—')],
  ['Contato', `${esc(p.phone)}${p.email ? ` · ${esc(p.email)}` : ''}`],
  ...(p.guardian ? [['Responsável legal', esc(`${p.guardian.name} (${p.guardian.relationship}) · CPF ${p.guardian.cpf} · ${p.guardian.phone}`)] as [string, string]] : []),
  ['Situação', p.active ? 'Ativo' : `Inativo desde ${esc(fmtDate(p.inactivatedAt))}`],
])}</table>
<h2>Consentimentos</h2>
<table>${r.consents.map((x: any) => `<tr><th>${esc(CONSENT_LABEL[x.purpose] ?? x.purpose)}</th><td>${consentText(x)}</td></tr>`).join('')}</table>
<h2>Anamneses</h2>${anamnesis}
<h2>Evolução clínica e odontograma (ordem cronológica)</h2>
<table><thead><tr><th style="width:auto">Data</th><th style="width:auto">Registro</th><th style="width:auto">Autor</th><th style="width:auto">Assinatura</th></tr></thead><tbody>${entries || '<tr><td colspan="4">Nenhum registro.</td></tr>'}</tbody></table>
<p class="small">${esc(r.notice)}</p>
</body></html>`;
}
