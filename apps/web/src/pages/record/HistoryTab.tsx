import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { Icon } from '../../components/Icon';
import { Card, ErrorAlert, Field, Input, Textarea } from '../../components/ui';
import type { Patient } from '../PatientRecord';
import { STATUS } from './OdontogramTab';

interface Entry {
  id: string; kind: 'evolution' | 'odontogram' | 'addendum'; content: any; authorId: string; authorName: string; authorCro: string | null;
  amendsId: string | null; createdAt: string; signedAt: string | null; contentHash: string | null;
}

/** 06 — Histórico / evolução (REQ-19, REQ-04). */
export function HistoryTab({ patient, readOnly }: { patient: Patient; readOnly: boolean }) {
  const { can, me } = useSession();
  const editable = can('clinical:write') && !readOnly && patient.active;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [form, setForm] = useState({ title: '', text: '' });
  const [addendumFor, setAddendumFor] = useState<string | null>(null);
  const [addendum, setAddendum] = useState('');
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setEntries((await api<{ entries: Entry[] }>(`/patients/${patient.id}/entries`)).entries);
    } catch (err) {
      setError(err);
    }
  }, [patient.id]);
  useEffect(() => { load(); }, [load]);

  async function create(sign: boolean) {
    try {
      await post(`/patients/${patient.id}/entries`, { kind: 'evolution', content: form, sign });
      setForm({ title: '', text: '' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function verify(id: string) {
    const r = await api<{ valid: boolean }>(`/entries/${id}/verify`);
    setVerified((v) => ({ ...v, [id]: r.valid }));
  }

  const main = entries.filter((e) => e.kind !== 'addendum').reverse();
  const addenda = (id: string) => entries.filter((e) => e.amendsId === id);

  return (
    <div className="grid-2">
      <Card title="Evolução clínica" bodyClass="card-body">
        {main.length === 0 && <div className="empty">Nenhum registro.</div>}
        <div className="timeline">
          {main.map((e) => (
            <div key={e.id} className="tl-item">
              <div className="tl-date">
                <strong>{new Date(e.createdAt).toLocaleDateString('pt-BR')}</strong>
                {new Date(e.createdAt).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <div className="row wrap">
                  <strong>{e.kind === 'odontogram' ? 'Odontograma atualizado' : e.content.title}</strong>
                  {e.signedAt
                    ? <span className="tag success"><Icon name="lock" size={12} /> Assinado</span>
                    : <span className="tag warning">Rascunho</span>}
                </div>
                {e.kind === 'evolution' && <p style={{ whiteSpace: 'pre-wrap' }}>{e.content.text}</p>}
                {e.kind === 'odontogram' && (
                  <p className="muted">
                    {Object.entries(e.content.teeth as Record<string, { status: string; faces: string[] }>)
                      .map(([n, t]) => `${n}: ${STATUS[t.status]?.label ?? t.status}${t.faces.length ? ` (${t.faces.join('')})` : ''}`)
                      .join(' · ') || 'Sem alterações registradas'}
                  </p>
                )}
                <span className="subtle">
                  {e.authorName}{e.authorCro ? ` · ${e.authorCro}` : ''}{e.signedAt ? ` · assinado em ${formatDateTime(e.signedAt)}` : ''}
                </span>
                {addenda(e.id).map((a) => (
                  <div key={a.id} className="addendum">
                    <strong>Adendo</strong> · <span className="subtle">{a.authorName} · {formatDateTime(a.signedAt)}</span>
                    <p>{a.content.text}</p>
                  </div>
                ))}
                <div className="row wrap">
                  {e.signedAt && (
                    <button className="btn btn-sm btn-ghost" onClick={() => verify(e.id)}>
                      {verified[e.id] === undefined ? 'Verificar integridade' : verified[e.id] ? '✓ Íntegro' : '✗ Alterado'}
                    </button>
                  )}
                  {editable && e.signedAt && (
                    <button className="btn btn-sm" onClick={() => { setAddendumFor(e.id); setAddendum(''); }}>Adicionar adendo</button>
                  )}
                  {editable && !e.signedAt && e.authorId === me?.user.id && (
                    <button className="btn btn-sm btn-primary" onClick={() => act(() => post(`/entries/${e.id}/sign`))}>Assinar</button>
                  )}
                </div>
                {addendumFor === e.id && (
                  <div className="stack" style={{ gap: 8 }}>
                    <Textarea value={addendum} onChange={(ev) => setAddendum(ev.target.value)} placeholder="Correção ou complemento (o registro original não é alterado)" />
                    <div className="row">
                      <button className="btn btn-sm" onClick={() => setAddendumFor(null)}>Cancelar</button>
                      <button className="btn btn-sm btn-primary" disabled={addendum.trim().length < 2}
                        onClick={() => act(async () => { await post(`/entries/${e.id}/addendum`, { text: addendum }); setAddendumFor(null); })}>
                        Assinar adendo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <div className="stack">
        {editable && (
          <Card title="Nova evolução">
            <div className="stack">
              <Field label="Título"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Restauração 36" /></Field>
              <Field label="Descrição"><Textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
              <p className="subtle">Autor, CRO e data/hora são preenchidos automaticamente.</p>
              <div className="row">
                <button className="btn" disabled={form.title.length < 2 || form.text.length < 2} onClick={() => create(false)}>Salvar rascunho</button>
                <button className="btn btn-primary" disabled={form.title.length < 2 || form.text.length < 2} onClick={() => create(true)}>Salvar e assinar</button>
              </div>
            </div>
          </Card>
        )}
        <div className="alert warning">
          <Icon name="alert" />
          <div>
            Assinatura eletrônica simples (login + 2FA + carimbo de tempo + hash). Registros assinados não podem ser
            alterados, só complementados por adendo. Sem certificado ICP-Brasil, mantenha a via em papel assinada
            (Res. CFO 91/2009).
          </div>
        </div>
        <ErrorAlert error={error} />
      </div>
    </div>
  );
}