import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, post } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { Card, EmptyState, ErrorAlert, Textarea } from '../../components/ui';
import type { Patient } from '../PatientRecord';

interface Question { id: string; text: string; type: 'yesno' | 'text'; alert: boolean; section: string }
interface Template { id: string; version: number; title: string; questions: Question[] }
type Answer = { value: boolean | string | null; note?: string };
interface Response {
  id: string; templateVersion: number; questions: Question[]; answers: Record<string, Answer>;
  signedByName: string; signedByRelation: string; createdAt: string; authorName: string; contentHash: string;
}

function groupBySection(qs: Question[]) {
  const map = new Map<string, Question[]>();
  for (const q of qs) map.set(q.section, [...(map.get(q.section) ?? []), q]);
  return [...map.entries()];
}

/** 04 — Anamnese. Respostas são imutáveis e guardam a versão do modelo (REQ-21). */
export function AnamnesisTab({ patient, readOnly }: { patient: Patient; readOnly: boolean }) {
  const { can } = useSession();
  const [template, setTemplate] = useState<Template | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Answer> | null>(null);
  const [confirmSigner, setConfirmSigner] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([
        api<{ template: Template }>('/anamnesis/template'),
        api<{ responses: Response[] }>(`/patients/${patient.id}/anamnesis`),
      ]);
      setTemplate(t.template);
      setResponses(r.responses);
      setSelected(r.responses[0]?.id ?? null);
    } catch (err) {
      setError(err);
    }
  }, [patient.id]);
  useEffect(() => { load(); }, [load]);

  const current = responses.find((r) => r.id === selected) ?? null;
  const alerts = useMemo(
    () => (current ? current.questions.filter((q) => q.alert && current.answers[q.id]?.value === true) : []),
    [current],
  );
  const signer = patient.isMinor && patient.guardian
    ? `${patient.guardian.name} (responsável — ${patient.guardian.relationship})`
    : `${patient.fullName} (paciente)`;

  async function save() {
    try {
      await post(`/patients/${patient.id}/anamnesis`, { templateId: template!.id, answers: draft, signerConfirmed: true });
      setDraft(null);
      setConfirmSigner(false);
      await load();
    } catch (err) {
      setError(err);
    }
  }

  if (draft && template) {
    return (
      <Card title={`Nova anamnese · ${template.title} (v${template.version})`}>
        <div className="stack">
          {groupBySection(template.questions).map(([section, qs]) => (
            <div key={section} className="stack" style={{ gap: 6 }}>
              <h3>{section}</h3>
              {qs.map((q) => (
                <div key={q.id} className="row wrap" style={{ padding: '6px 0', borderBottom: '1px solid var(--neutral-border)' }}>
                  <div style={{ flex: 1, minWidth: 260 }}>{q.text} {q.alert && <span className="tag danger">Alerta</span>}</div>
                  {q.type === 'yesno' ? (
                    <div className="row">
                      {[['Sim', true], ['Não', false]].map(([label, v]) => (
                        <button key={String(label)} type="button"
                          className={`btn btn-sm ${draft[q.id]?.value === v ? 'btn-primary' : ''}`}
                          onClick={() => setDraft({ ...draft, [q.id]: { ...draft[q.id], value: v as boolean } })}>
                          {label}
                        </button>
                      ))}
                      <input className="input" style={{ width: 220, height: 30 }} placeholder="Observação"
                        value={draft[q.id]?.note ?? ''} onChange={(e) => setDraft({ ...draft, [q.id]: { value: draft[q.id]?.value ?? null, note: e.target.value } })} />
                    </div>
                  ) : (
                    <div style={{ flexBasis: '100%' }}>
                      <Textarea value={String(draft[q.id]?.value ?? '')} onChange={(e) => setDraft({ ...draft, [q.id]: { value: e.target.value } })} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          <label className="check">
            <input type="checkbox" checked={confirmSigner} onChange={(e) => setConfirmSigner(e.target.checked)} />
            <span>As respostas foram fornecidas e confirmadas por <strong>{signer}</strong>.</span>
          </label>
          <div className="alert info">
            Após salvar, a anamnese não pode ser alterada; uma nova anamnese cria um novo registro. Mantenha a via em papel
            assinada pelo {patient.isMinor ? 'responsável' : 'paciente'} enquanto não houver assinatura com certificado ICP-Brasil.
          </div>
          <ErrorAlert error={error} />
          <div className="row">
            <span className="spacer" />
            <button className="btn" onClick={() => setDraft(null)}>Cancelar</button>
            <button className="btn btn-primary" disabled={!confirmSigner} onClick={save}>Salvar anamnese</button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid-2">
      <div className="stack">
        {!current ? (
          <EmptyState title="Nenhuma anamnese registrada" />
        ) : (
          <Card title={`Anamnese de ${formatDateTime(current.createdAt)}`} actions={<span className="subtle">Modelo v{current.templateVersion}</span>}>
            <div className="stack">
              {groupBySection(current.questions).map(([section, qs]) => (
                <div key={section}>
                  <h3 style={{ marginBottom: 6 }}>{section}</h3>
                  <table className="table">
                    <tbody>
                      {qs.map((q) => {
                        const a = current.answers[q.id];
                        const yes = a?.value === true;
                        return (
                          <tr key={q.id}>
                            <td>{q.text}</td>
                            <td style={{ width: 90 }}>
                              {q.type === 'yesno'
                                ? <span className={`tag ${yes ? (q.alert ? 'danger' : 'warning') : ''}`}>{a?.value == null ? '—' : yes ? 'Sim' : 'Não'}</span>
                                : null}
                            </td>
                            <td className="muted">{q.type === 'text' ? String(a?.value ?? '—') : a?.note ?? ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
              <p className="subtle">
                Registrado por {current.authorName}. Confirmado por {current.signedByName} ({current.signedByRelation}). Hash: <span className="mono">{current.contentHash.slice(0, 16)}…</span>
              </p>
            </div>
          </Card>
        )}
      </div>
      <div className="stack">
        {alerts.length > 0 && (
          <Card title="Alertas clínicos">
            <div className="stack" style={{ gap: 8 }}>
              {alerts.map((q) => (
                <div key={q.id} className="alert danger">
                  <div><strong>{q.text.replace('?', '')}</strong>{current?.answers[q.id]?.note ? ` — ${current.answers[q.id].note}` : ''}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
        <Card title="Histórico de anamneses" actions={can('clinical:write') && !readOnly && template && (
          <button className="btn btn-sm btn-primary" onClick={() => setDraft({})}>Nova anamnese</button>
        )}>
          {responses.length === 0 ? <p className="muted">Sem registros.</p> : (
            <div className="stack" style={{ gap: 6 }}>
              {responses.map((r) => (
                <button key={r.id} className={`clinic-option`} style={{ padding: 10, borderColor: r.id === selected ? 'var(--brand-primary)' : undefined }} onClick={() => setSelected(r.id)}>
                  <div style={{ flex: 1 }}>
                    <strong>{formatDateTime(r.createdAt)}</strong>
                    <div className="subtle">Modelo v{r.templateVersion} · {r.authorName}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <ErrorAlert error={error} />
        </Card>
      </div>
    </div>
  );
}
