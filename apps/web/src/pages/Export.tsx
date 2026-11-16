import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { ErrorAlert } from '../components/ui';
import { STATUS } from './record/OdontogramTab';
import { CONSENT_LABELS } from './PatientForm';
import { consentDetail, consentStatus } from '../lib/consent';

/**
 * REQ-06: exportação do prontuário — dados estruturados (JSON) e versão imprimível/PDF.
 * Disponível mesmo com consultório suspenso (REQ-32).
 */
export function ExportPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api(`/patients/${id}/export`).then(setData).catch(setError);
  }, [id]);

  function downloadJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prontuario-${id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (error) return <div className="content"><ErrorAlert error={error} /></div>;
  if (!data) return <div className="empty">Gerando exportação…</div>;
  const p = data.patient;

  return (
    <div style={{ background: 'var(--neutral-bg)', minHeight: '100vh' }}>
      <div className="no-print row" style={{ padding: '12px 24px', background: 'var(--neutral-surface)', borderBottom: '1px solid var(--neutral-border)' }}>
        <Link to={`/pacientes/${id}`} className="btn btn-sm">Voltar</Link>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={downloadJson}>Baixar dados estruturados (JSON)</button>
        <button className="btn btn-sm btn-primary" onClick={() => window.print()}>Imprimir / salvar em PDF</button>
      </div>
      <article className="print-page">
        <header>
          <h1>Prontuário odontológico</h1>
          <p>{data.clinic.legalName || data.clinic.name}{data.clinic.cnpj ? ` · CNPJ ${data.clinic.cnpj}` : ''}</p>
          <p>Responsável técnico: {data.clinic.techLeadName ?? '—'} {data.clinic.techLeadCro ?? ''}</p>
          <p style={{ fontSize: 12, color: '#555' }}>Gerado em {formatDateTime(data.generatedAt)} · formato {data.format}</p>
        </header>

        <h2>Paciente</h2>
        <table><tbody>
          <tr><th>Nome</th><td>{p.fullName}{p.socialName ? ` (nome social: ${p.socialName})` : ''}</td></tr>
          <tr><th>Nascimento</th><td>{formatDate(p.birthDate)}</td></tr>
          <tr><th>CPF</th><td>{p.cpf ?? '—'}</td></tr>
          <tr><th>Contato</th><td>{p.phone}{p.email ? ` · ${p.email}` : ''}</td></tr>
          {p.guardian && <tr><th>Responsável legal</th><td>{p.guardian.name} ({p.guardian.relationship}) · CPF {p.guardian.cpf} · {p.guardian.phone}</td></tr>}
          <tr><th>Situação</th><td>{p.active ? 'Ativo' : `Inativo desde ${formatDate(p.inactivatedAt)}`}</td></tr>
        </tbody></table>

        <h2>Consentimentos</h2>
        <table><tbody>
          {data.consents.map((c: any) => (
            <tr key={c.purpose}><th>{CONSENT_LABELS[c.purpose as keyof typeof CONSENT_LABELS] ?? c.purpose}</th><td><strong>{consentStatus(c)}</strong><br />{consentDetail(c)}</td></tr>
          ))}
        </tbody></table>

        <h2>Anamneses</h2>
        {data.anamnesis.length === 0 && <p>Nenhuma.</p>}
        {data.anamnesis.map((r: any) => (
          <div key={r.id} style={{ marginBottom: 12 }}>
            <p><strong>{formatDateTime(r.createdAt)}</strong> · modelo v{r.templateVersion} · confirmado por {r.signedByName} ({r.signedByRelation})</p>
            <table><tbody>
              {r.questions.map((q: any) => {
                const a = r.answers[q.id];
                return <tr key={q.id}><td>{q.text}</td><td>{a == null ? '—' : typeof a.value === 'boolean' ? (a.value ? 'Sim' : 'Não') : a.value}{a?.note ? ` — ${a.note}` : ''}</td></tr>;
              })}
            </tbody></table>
            <p style={{ fontSize: 11, color: '#555' }}>Hash: {r.contentHash}</p>
          </div>
        ))}

        <h2>Evolução clínica e odontograma (ordem cronológica)</h2>
        <table>
          <thead><tr><th>Data</th><th>Registro</th><th>Autor</th><th>Assinatura</th></tr></thead>
          <tbody>
            {data.entries.map((e: any) => (
              <tr key={e.id}>
                <td>{formatDateTime(e.createdAt)}</td>
                <td>
                  {e.kind === 'evolution' && <><strong>{e.content.title}</strong><br />{e.content.text}</>}
                  {e.kind === 'addendum' && <><strong>Adendo</strong><br />{e.content.text}</>}
                  {e.kind === 'odontogram' && <><strong>Odontograma</strong><br />{Object.entries(e.content.teeth).map(([n, t]: any) => `${n}: ${STATUS[t.status]?.label ?? t.status}${t.faces.length ? ` (${t.faces.join('')})` : ''}`).join(' · ')}</>}
                </td>
                <td>{e.authorName}<br />{e.authorCro}</td>
                <td style={{ fontSize: 11 }}>{e.signedAt ? <>{formatDateTime(e.signedAt)}<br />{e.signatureMethod}<br />{e.contentHash}</> : 'Rascunho (não assinado)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: '#555', marginTop: 16 }}>{data.notice}</p>
      </article>
    </div>
  );
}
