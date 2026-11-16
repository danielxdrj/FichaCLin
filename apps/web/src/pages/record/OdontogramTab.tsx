import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { Card, ErrorAlert, Input, Select } from '../../components/ui';
import type { Patient } from '../PatientRecord';

type Face = 'M' | 'D' | 'V' | 'L' | 'O';
interface ToothState { status: string; faces: Face[]; note?: string }
interface Chart { teeth: Record<string, ToothState>; procedures: { tooth: string; description: string; status: 'planejado' | 'realizado' }[] }

export const STATUS: Record<string, { label: string; color: string; byFace: boolean }> = {
  higido: { label: 'Hígido', color: 'var(--odonto-higido)', byFace: false },
  carie: { label: 'Cárie', color: 'var(--odonto-carie)', byFace: true },
  restaurado: { label: 'Restauração', color: 'var(--odonto-restauracao)', byFace: true },
  tratamento_canal: { label: 'Canal', color: 'var(--odonto-canal)', byFace: false },
  coroa: { label: 'Coroa', color: 'var(--odonto-coroa)', byFace: false },
  ausente: { label: 'Ausente / extraído', color: 'var(--odonto-extracao)', byFace: false },
};

const UPPER = [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28]];
const LOWER = [[48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]];

function ToothIcon({ state }: { state?: ToothState }) {
  const s = state ? STATUS[state.status] : undefined;
  const fill = (f: Face) => (s?.byFace && state!.faces.includes(f) ? s.color : 'var(--odonto-higido)');
  const whole = s && !s.byFace && state!.status !== 'higido' ? s.color : null;
  const stroke = 'var(--odonto-contorno)';
  return (
    <svg viewBox="0 0 34 34">
      <polygon points="1,1 33,1 24,10 10,10" fill={fill('V')} stroke={stroke} />
      <polygon points="1,33 33,33 24,24 10,24" fill={fill('L')} stroke={stroke} />
      <polygon points="1,1 10,10 10,24 1,33" fill={fill('M')} stroke={stroke} />
      <polygon points="33,1 24,10 24,24 33,33" fill={fill('D')} stroke={stroke} />
      <rect x="10" y="10" width="14" height="14" fill={fill('O')} stroke={stroke} />
      {whole && state?.status === 'ausente' && <path d="M3 3 31 31 M31 3 3 31" stroke={whole} strokeWidth="3" />}
      {whole && state?.status === 'tratamento_canal' && <rect x="2" y="2" width="30" height="30" fill="none" stroke={whole} strokeWidth="3" />}
      {whole && state?.status === 'coroa' && <circle cx="17" cy="17" r="15" fill="none" stroke={whole} strokeWidth="3" />}
    </svg>
  );
}

/** 05 — Odontograma. Cada gravação é um registro assinado e imutável (REQ-19). */
export function OdontogramTab({ patient, readOnly }: { patient: Patient; readOnly: boolean }) {
  const { can } = useSession();
  const editable = can('clinical:write') && !readOnly && patient.active;
  const [saved, setSaved] = useState<{ content: Chart; authorName: string; authorCro: string; signedAt: string } | null>(null);
  const [chart, setChart] = useState<Chart>({ teeth: {}, procedures: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [proc, setProc] = useState({ description: '', status: 'planejado' as 'planejado' | 'realizado' });
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const r = await api(`/patients/${patient.id}/odontogram`);
      setSaved(r.entry);
      setChart(r.entry?.content ?? { teeth: {}, procedures: [] });
      setDirty(false);
    } catch (err) {
      setError(err);
    }
  }, [patient.id]);
  useEffect(() => { load(); }, [load]);

  const tooth = selected ? chart.teeth[selected] ?? { status: 'higido', faces: [] } : null;
  function update(t: ToothState) {
    const teeth = { ...chart.teeth };
    if (t.status === 'higido' && !t.note) delete teeth[selected!];
    else teeth[selected!] = { ...t, faces: STATUS[t.status].byFace ? t.faces : [] };
    setChart({ ...chart, teeth });
    setDirty(true);
  }

  async function signSave() {
    try {
      await post(`/patients/${patient.id}/entries`, { kind: 'odontogram', content: chart, sign: true });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  const renderRow = (quads: number[][]) => (
    <div className="arch">
      {quads.map((q, i) => (
        <div key={i} className="quad">
          {q.map((n) => (
            <button key={n} className={`tooth ${selected === String(n) ? 'selected' : ''}`} onClick={() => setSelected(String(n))} type="button">
              <small>{n}</small>
              <ToothIcon state={chart.teeth[String(n)]} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid-2">
      <div className="stack">
        <Card title="Odontograma" actions={saved && <span className="subtle">Última versão: {saved.authorName} · {saved.authorCro} · {formatDateTime(saved.signedAt)}</span>}>
          <div className="odonto">
            {renderRow(UPPER)}
            {renderRow(LOWER)}
          </div>
          <div className="legend" style={{ marginTop: 16 }}>
            {Object.entries(STATUS).map(([k, s]) => <span key={k}><i style={{ background: s.color }} />{s.label}</span>)}
          </div>
        </Card>
        <Card title="Procedimentos">
          {chart.procedures.length === 0 ? <p className="muted">Nenhum procedimento.</p> : (
            <table className="table">
              <thead><tr><th>Dente</th><th>Procedimento</th><th>Situação</th></tr></thead>
              <tbody>
                {chart.procedures.map((p, i) => (
                  <tr key={i}>
                    <td>{p.tooth}</td><td>{p.description}</td>
                    <td><span className={`tag ${p.status === 'realizado' ? 'success' : 'info'}`}>{p.status === 'realizado' ? 'Realizado' : 'Planejado'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <div className="stack">
        <Card title={selected ? `Dente ${selected}` : 'Selecione um dente'}>
          {!tooth ? <p className="muted">Clique em um dente para ver ou registrar a situação.</p> : (
            <div className="stack">
              <div className="row wrap">
                {Object.entries(STATUS).map(([k, s]) => (
                  <button key={k} type="button" disabled={!editable} className={`btn btn-sm ${tooth.status === k ? 'btn-primary' : ''}`}
                    onClick={() => update({ ...tooth, status: k })}>{s.label}</button>
                ))}
              </div>
              {STATUS[tooth.status]?.byFace && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="subtle">Faces (M mesial · D distal · V vestibular · L lingual/palatina · O oclusal/incisal)</span>
                  <div className="row">
                    {(['M', 'D', 'V', 'L', 'O'] as Face[]).map((f) => (
                      <button key={f} type="button" disabled={!editable} className={`btn btn-sm ${tooth.faces.includes(f) ? 'btn-primary' : ''}`}
                        onClick={() => update({ ...tooth, faces: tooth.faces.includes(f) ? tooth.faces.filter((x) => x !== f) : [...tooth.faces, f] })}>{f}</button>
                    ))}
                  </div>
                </div>
              )}
              {editable && (
                <div className="stack" style={{ gap: 8 }}>
                  <span className="subtle">Adicionar procedimento neste dente</span>
                  <Input placeholder="Ex.: Restauração em resina" value={proc.description} onChange={(e) => setProc({ ...proc, description: e.target.value })} />
                  <div className="row">
                    <Select value={proc.status} onChange={(e) => setProc({ ...proc, status: e.target.value as 'planejado' })} options={[['planejado', 'Planejado'], ['realizado', 'Realizado']]} />
                    <button type="button" className="btn btn-sm" disabled={proc.description.trim().length < 2} onClick={() => {
                      setChart({ ...chart, procedures: [...chart.procedures, { tooth: selected!, ...proc }] });
                      setProc({ description: '', status: 'planejado' });
                      setDirty(true);
                    }}>Adicionar</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
        {editable && (
          <Card title="Salvar">
            <p className="subtle" style={{ marginBottom: 12 }}>
              Salvar cria uma nova versão assinada (autor, CRO, data/hora e hash). Versões anteriores permanecem no histórico.
            </p>
            <ErrorAlert error={error} />
            <button className="btn btn-primary" disabled={!dirty} onClick={signSave}>Salvar e assinar odontograma</button>
          </Card>
        )}
      </div>
    </div>
  );
}
