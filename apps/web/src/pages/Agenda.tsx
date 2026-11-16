import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, patch, post } from '../lib/api';
import { useSession } from '../lib/session';
import { Icon } from '../components/Icon';
import {
  ConfirmDialog, EmptyState, ErrorAlert, Field, Input, Loading, Modal, PageHead, Segmented, Select, Status, Textarea, useToast,
} from '../components/ui';

// Valores fixos definidos no backend (routes/agenda.ts e migração 005).
const KIND_LABEL: Record<string, string> = { consulta: 'Consulta', retorno: 'Retorno', compromisso: 'Compromisso', lembrete: 'Lembrete' };
const STATUS_LABEL: Record<string, string> = {
  agendado: 'Agendado', confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado', faltou: 'Faltou',
};
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'off'> = {
  agendado: 'info', confirmado: 'ok', concluido: 'off', cancelado: 'bad', faltou: 'warn',
};

interface AgendaEvent {
  id: string; kind: string; title: string; startsAt: string; endsAt: string; status: string; notes: string | null;
  patientId: string | null; patientName: string | null; patientSocialName: string | null;
  professionalId: string | null; professionalName: string | null;
}
type View = 'dia' | 'semana';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayTitle = (d: Date) => {
  const t = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1); // "Segunda-feira, 16 de novembro"
};
const toInputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Agenda do consultório — compromissos planejados (consultas, retornos, compromissos, lembretes).
 * Não é a auditoria: o que aconteceu no sistema fica em Auditoria; aqui fica o que está marcado.
 */
export function AgendaPage() {
  const { can, me } = useSession();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<View>('dia');
  const [professionalId, setProfessionalId] = useState('');
  const [professionals, setProfessionals] = useState<{ id: string; name: string }[]>([]);
  const [events, setEvents] = useState<AgendaEvent[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<AgendaEvent | 'new' | null>(null);
  const toast = useToast();
  const writable = can('patients:write') && me?.current?.billingStatus !== 'suspended';

  const range = useMemo(() => ({ from: day, to: addDays(day, view === 'dia' ? 1 : 7) }), [day, view]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
      if (professionalId) q.set('professionalId', professionalId);
      setEvents((await api<{ events: AgendaEvent[] }>(`/agenda?${q}`)).events);
    } catch (err) {
      setError(err);
    }
  }, [range, professionalId]);
  useEffect(() => { setEvents(null); load(); }, [load]);
  useEffect(() => { api('/agenda/professionals').then((r) => setProfessionals(r.professionals)).catch(() => {}); }, []);

  const days = view === 'dia' ? [day] : Array.from({ length: 7 }, (_, i) => addDays(day, i));
  const isToday = startOfDay(new Date()).getTime() === day.getTime();

  return (
    <>
      <PageHead
        title="Agenda"
        subtitle="Consultas, retornos e compromissos do consultório."
        actions={writable && <button className="btn btn-primary" onClick={() => setEditing('new')}>Novo compromisso</button>}
      />

      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="row wrap">
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-sm btn-ghost" aria-label={view === 'dia' ? 'Dia anterior' : 'Semana anterior'} onClick={() => setDay(addDays(day, view === 'dia' ? -1 : -7))}><Icon name="chevronLeft" size={16} /></button>
            <button className="btn btn-sm" disabled={isToday} onClick={() => setDay(startOfDay(new Date()))}>Hoje</button>
            <button className="btn btn-sm btn-ghost" aria-label={view === 'dia' ? 'Próximo dia' : 'Próxima semana'} onClick={() => setDay(addDays(day, view === 'dia' ? 1 : 7))}><Icon name="chevronRight" size={16} /></button>
          </div>
          <input className="input" type="date" aria-label="Ir para a data" style={{ width: 160, height: 32 }} value={toInputDate(day)}
            onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split('-').map(Number); setDay(new Date(y, m - 1, d)); } }} />
          <Segmented<View> label="Visualização" value={view} onChange={setView} options={[['dia', 'Dia'], ['semana', '7 dias']]} />
        </div>
        <div style={{ width: 220 }}>
          <Select aria-label="Filtrar por profissional" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}
            options={[['', 'Todos os profissionais'], ...professionals.map((p) => [p.id, p.name] as [string, string])]} />
        </div>
      </div>

      <ErrorAlert error={error} />
      {!events ? <Loading /> : (
        <div className="stack" style={{ gap: 20 }}>
          {days.map((d) => {
            const list = events.filter((e) => startOfDay(new Date(e.startsAt)).getTime() === d.getTime());
            return (
              <div key={d.toISOString()}>
                <h2 style={{ fontSize: 14, marginBottom: 8 }}>{dayTitle(d)}</h2>
                <div className="panel agenda-day">
                  {list.length === 0 ? (
                    <EmptyState title="Nenhum compromisso">{view === 'dia' && writable ? 'Use "Novo compromisso" para agendar.' : undefined}</EmptyState>
                  ) : list.map((e) => (
                    <div key={e.id} className={`agenda-row ${e.status === 'cancelado' ? 'cancelled' : ''}`} role="button" tabIndex={0}
                      onClick={() => setEditing(e)} onKeyDown={(k) => { if (k.key === 'Enter') setEditing(e); }}
                      aria-label={`${hhmm(e.startsAt)} ${e.title}, ${STATUS_LABEL[e.status]}`}>
                      <div className="agenda-time">{hhmm(e.startsAt)}<small>até {hhmm(e.endsAt)}</small></div>
                      <div style={{ minWidth: 0 }}>
                        <div className="agenda-kind">{KIND_LABEL[e.kind]}</div>
                        <div className="agenda-title"><strong>{e.title}</strong></div>
                        <div className="subtle">
                          {[e.patientSocialName || e.patientName, e.professionalName].filter(Boolean).join(' · ') || 'Sem paciente vinculado'}
                        </div>
                      </div>
                      <Status tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Status>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <EventModal event={editing === 'new' ? null : editing} defaultDay={day} professionals={professionals} writable={writable}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => { setEditing(null); await load(); toast.show(msg); }} />
      )}
      {toast.node}
    </>
  );
}

function EventModal({ event, defaultDay, professionals, writable, onClose, onSaved }: {
  event: AgendaEvent | null; defaultDay: Date; professionals: { id: string; name: string }[]; writable: boolean;
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const initialStart = event ? new Date(event.startsAt) : new Date(defaultDay.getFullYear(), defaultDay.getMonth(), defaultDay.getDate(), 9, 0);
  const initialEnd = event ? new Date(event.endsAt) : new Date(initialStart.getTime() + 30 * 60000);
  const time = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const [form, setForm] = useState({
    kind: event?.kind ?? 'consulta', title: event?.title ?? '', date: toInputDate(initialStart),
    start: time(initialStart), end: time(initialEnd), patientId: event?.patientId ?? '',
    professionalId: event?.professionalId ?? '', notes: event?.notes ?? '',
  });
  const [patients, setPatients] = useState<{ id: string; fullName: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  const locked = !writable || event?.status === 'cancelado';

  useEffect(() => { api('/patients?status=active').then((r) => setPatients(r.patients)).catch(() => {}); }, []);

  function payload() {
    const [y, m, d] = form.date.split('-').map(Number);
    const at = (t: string) => { const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, d, h, mi).toISOString(); };
    return {
      kind: form.kind, title: form.title, startsAt: at(form.start), endsAt: at(form.end),
      patientId: form.patientId || null, professionalId: form.professionalId || null, notes: form.notes || null,
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (event) await patch(`/agenda/${event.id}`, { event: payload() });
      else await post('/agenda', payload());
      onSaved(event ? 'Compromisso atualizado.' : 'Compromisso agendado.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: string, msg: string) {
    setError(null);
    try {
      await patch(`/agenda/${event!.id}`, { status });
      onSaved(msg);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal title={event ? 'Compromisso' : 'Novo compromisso'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          <div className="form-grid">
            <Field className="col-4" label="Tipo">
              <Select value={form.kind} onChange={(e) => set('kind', e.target.value)} options={Object.entries(KIND_LABEL)} />
            </Field>
            <Field className="col-8" label="Título"><Input value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Avaliação inicial" required /></Field>
            <Field className="col-4" label="Data"><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required /></Field>
            <Field className="col-4" label="Início"><Input type="time" value={form.start} onChange={(e) => set('start', e.target.value)} required /></Field>
            <Field className="col-4" label="Término"><Input type="time" value={form.end} onChange={(e) => set('end', e.target.value)} required /></Field>
            <Field className="col-6" label="Paciente">
              <Select value={form.patientId} onChange={(e) => set('patientId', e.target.value)}
                options={[['', 'Nenhum'], ...patients.map((p) => [p.id, p.fullName] as [string, string]),
                  ...(event?.patientId && !patients.some((p) => p.id === event.patientId) ? [[event.patientId, event.patientName ?? 'Paciente'] as [string, string]] : [])]} />
            </Field>
            <Field className="col-6" label="Profissional">
              <Select value={form.professionalId} onChange={(e) => set('professionalId', e.target.value)}
                options={[['', 'Nenhum'], ...professionals.map((p) => [p.id, p.name] as [string, string])]} />
            </Field>
          </div>
          <Field label="Observação administrativa" hint="Não registre informações clínicas aqui: elas pertencem ao prontuário do paciente.">
            <Textarea value={form.notes} maxLength={500} onChange={(e) => set('notes', e.target.value)} style={{ minHeight: 64 }} />
          </Field>
        </fieldset>
        {event?.patientId && <Link to={`/pacientes/${event.patientId}`}>Abrir ficha do paciente</Link>}
        <ErrorAlert error={error} />
        {event && writable && event.status !== 'cancelado' && (
          <div className="row wrap">
            <span className="subtle">Situação:</span>
            {(['confirmado', 'concluido', 'faltou'] as const).map((s) => (
              <button key={s} type="button" className="btn btn-sm" disabled={event.status === s}
                onClick={() => setStatus(s, `Marcado como ${STATUS_LABEL[s].toLowerCase()}.`)}>{STATUS_LABEL[s]}</button>
            ))}
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setCancelling(true)}>Cancelar compromisso</button>
          </div>
        )}
        {event?.status === 'cancelado' && <p className="subtle">Compromisso cancelado. O registro é mantido no histórico da agenda.</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Fechar</button>
          {!locked && <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : event ? 'Salvar alterações' : 'Agendar'}</button>}
        </div>
      </form>
      {cancelling && (
        <ConfirmDialog title="Cancelar compromisso" confirmLabel="Cancelar compromisso" danger
          message="O compromisso fica marcado como cancelado e continua visível no histórico da agenda."
          onCancel={() => setCancelling(false)}
          onConfirm={() => { setCancelling(false); setStatus('cancelado', 'Compromisso cancelado.'); }} />
      )}
    </Modal>
  );
}
