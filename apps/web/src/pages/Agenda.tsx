import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
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
type Mode = 'lista' | 'calendario';
const MODE_KEY = 'fichaclin-agenda-modo';
const HOUR_START = 7;
const HOUR_END = 21;
const HOUR_PX = 52;

/** Semana começando na segunda-feira. */
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'calendario' ? 'calendario' : 'lista';
  } catch {
    return 'lista';
  }
}

export function AgendaPage() {
  const { can, me } = useSession();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [mode, setModeState] = useState<Mode>(readMode);
  const [view, setView] = useState<View>('dia');
  const [professionalId, setProfessionalId] = useState('');
  const [professionals, setProfessionals] = useState<{ id: string; name: string }[]>([]);
  const [events, setEvents] = useState<AgendaEvent[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ event: AgendaEvent | null; start?: Date } | null>(null);
  const toast = useToast();
  const writable = can('patients:write') && me?.current?.billingStatus !== 'suspended';

  function setMode(m: Mode) {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* preferência só nesta sessão */ }
  }

  // Lista: dia ou 7 dias a partir da data. Calendário: semana (seg–dom) que contém a data.
  const range = useMemo(() => {
    if (mode === 'calendario') { const w = startOfWeek(day); return { from: w, to: addDays(w, 7) }; }
    return { from: day, to: addDays(day, view === 'dia' ? 1 : 7) };
  }, [day, view, mode]);

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

  const step = mode === 'calendario' || view === 'semana' ? 7 : 1;
  const isToday = startOfDay(new Date()).getTime() === day.getTime();
  const openNew = (start?: Date) => { if (writable) setEditing({ event: null, start }); };

  return (
    <>
      <PageHead
        title="Agenda"
        subtitle="Consultas, retornos e compromissos do consultório."
        actions={writable && <button className="btn btn-primary" onClick={() => openNew()}>Novo compromisso</button>}
      />

      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="row wrap">
          <Segmented<Mode> label="Forma de visualização" value={mode} onChange={setMode} options={[['lista', 'Lista'], ['calendario', 'Calendário']]} />
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-sm btn-ghost" aria-label={step === 1 ? 'Dia anterior' : 'Semana anterior'} onClick={() => setDay(addDays(day, -step))}><Icon name="chevronLeft" size={16} /></button>
            <button className="btn btn-sm" disabled={isToday} onClick={() => setDay(startOfDay(new Date()))}>Hoje</button>
            <button className="btn btn-sm btn-ghost" aria-label={step === 1 ? 'Próximo dia' : 'Próxima semana'} onClick={() => setDay(addDays(day, step))}><Icon name="chevronRight" size={16} /></button>
          </div>
          {mode === 'lista' ? (
            <>
              <input className="input" type="date" aria-label="Ir para a data" style={{ width: 160, height: 32 }} value={toInputDate(day)}
                onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split('-').map(Number); setDay(new Date(y, m - 1, d)); } }} />
              <Segmented<View> label="Período" value={view} onChange={setView} options={[['dia', 'Dia'], ['semana', '7 dias']]} />
            </>
          ) : (
            <strong style={{ fontSize: 14 }}>{weekTitle(range.from)}</strong>
          )}
        </div>
        <div style={{ width: 220 }}>
          <Select aria-label="Filtrar por profissional" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}
            options={[['', 'Todos os profissionais'], ...professionals.map((p) => [p.id, p.name] as [string, string])]} />
        </div>
      </div>

      <ErrorAlert error={error} />
      {!events ? <Loading /> : mode === 'lista' ? (
        <AgendaList events={events} days={view === 'dia' ? [day] : Array.from({ length: 7 }, (_, i) => addDays(day, i))}
          hint={view === 'dia' && writable} onOpen={(e) => setEditing({ event: e })} />
      ) : (
        <div className="cal-layout">
          <aside className="cal-side">
            <MiniMonth selected={day} weekStart={range.from} onPick={setDay} />
            <div className="cal-legend">
              {Object.entries(KIND_LABEL).map(([k, l]) => <span key={k}><i className={`cal-swatch kind-${k}`} />{l}</span>)}
            </div>
          </aside>
          <WeekGrid weekStart={range.from} events={events} writable={writable}
            onOpen={(e) => setEditing({ event: e })} onSlot={(d) => openNew(d)} />
        </div>
      )}

      {editing && (
        <EventModal event={editing.event} defaultStart={editing.start ?? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0)}
          professionals={professionals} writable={writable}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => { setEditing(null); await load(); toast.show(msg); }} />
      )}
      {toast.node}
    </>
  );
}

const weekTitle = (from: Date) => {
  const to = addDays(from, 6);
  const f = (d: Date, withMonth: boolean) => d.toLocaleDateString('pt-BR', withMonth ? { day: '2-digit', month: 'short' } : { day: '2-digit' });
  return `${f(from, from.getMonth() !== to.getMonth())} – ${f(to, true)} de ${to.getFullYear()}`;
};

function AgendaList({ events, days, hint, onOpen }: { events: AgendaEvent[]; days: Date[]; hint: boolean; onOpen: (e: AgendaEvent) => void }) {
  return (
    <div className="stack" style={{ gap: 20 }}>
      {days.map((d) => {
        const list = events.filter((e) => startOfDay(new Date(e.startsAt)).getTime() === d.getTime());
        return (
          <div key={d.toISOString()}>
            <h2 style={{ fontSize: 14, marginBottom: 8 }}>{dayTitle(d)}</h2>
            <div className="panel agenda-day">
              {list.length === 0 ? (
                <EmptyState title="Nenhum compromisso">{hint ? 'Use "Novo compromisso" para agendar.' : undefined}</EmptyState>
              ) : list.map((e) => (
                <div key={e.id} className={`agenda-row ${e.status === 'cancelado' ? 'cancelled' : ''}`} role="button" tabIndex={0}
                  onClick={() => onOpen(e)} onKeyDown={(k) => { if (k.key === 'Enter') onOpen(e); }}
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
  );
}

/** Minicalendário do mês para saltar de semana. */
function MiniMonth({ selected, weekStart, onPick }: { selected: Date; weekStart: Date; onPick: (d: Date) => void }) {
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  useEffect(() => { setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1)); }, [selected]);
  const first = startOfWeek(month);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const today = startOfDay(new Date()).getTime();
  const weekEnd = addDays(weekStart, 7).getTime();
  return (
    <div className="mini-month">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <button className="icon-btn mini-nav" aria-label="Mês anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><Icon name="chevronLeft" size={14} /></button>
        <strong style={{ fontSize: 13 }}>{monthTitle(month)}</strong>
        <button className="icon-btn mini-nav" aria-label="Próximo mês" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Icon name="chevronRight" size={14} /></button>
      </div>
      <div className="mini-grid" aria-label="Calendário do mês">
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => <span key={i} className="mini-dow" aria-hidden="true">{d}</span>)}
        {cells.map((d) => {
          const t = d.getTime();
          const cls = [
            'mini-day',
            d.getMonth() !== month.getMonth() ? 'out' : '',
            t === today ? 'today' : '',
            t >= weekStart.getTime() && t < weekEnd ? 'in-week' : '',
          ].join(' ');
          return (
            <button key={t} className={cls} onClick={() => onPick(d)}
              aria-label={d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const monthTitle = (d: Date) => {
  const t = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Distribui compromissos sobrepostos lado a lado dentro do dia. */
function layoutDay(list: AgendaEvent[]) {
  const sorted = [...list].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  const placed: { e: AgendaEvent; lane: number; lanes: number }[] = [];
  let cluster: { e: AgendaEvent; lane: number; lanes: number }[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const n = Math.max(...cluster.map((c) => c.lane)) + 1;
    cluster.forEach((c) => { c.lanes = n; });
    placed.push(...cluster);
    cluster = [];
  };
  for (const e of sorted) {
    const s = +new Date(e.startsAt);
    if (cluster.length && s >= clusterEnd) flush();
    const laneEnds: number[] = [];
    cluster.forEach((c) => { laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? 0, +new Date(c.e.endsAt)); });
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) lane = laneEnds.length;
    cluster.push({ e, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, +new Date(e.endsAt));
  }
  if (cluster.length) flush();
  return placed;
}

function WeekGrid({ weekStart, events, writable, onOpen, onSlot }: {
  weekStart: Date; events: AgendaEvent[]; writable: boolean; onOpen: (e: AgendaEvent) => void; onSlot: (d: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const today = startOfDay(new Date()).getTime();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const minutesFromStart = (d: Date) => (d.getHours() - HOUR_START) * 60 + d.getMinutes();
  const outside = events.filter((e) => { const h = new Date(e.startsAt).getHours(); return h < HOUR_START || h >= HOUR_END; }).length;
  const gridVars = { '--hours': hours.length, '--hour-px': `${HOUR_PX}px` } as CSSProperties;

  return (
    <div className="panel cal-wrap">
      <div className="cal-scroll">
        <div className="cal-grid" style={gridVars}>
          <div className="cal-corner" />
          {days.map((d) => (
            <div key={+d} className={`cal-dayhead ${+d === today ? 'today' : ''}`}>
              <span>{d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</span>
              <strong>{d.getDate()}</strong>
            </div>
          ))}
          <div className="cal-hours">
            {hours.map((h) => <div key={h} className="cal-hour">{String(h).padStart(2, '0')}:00</div>)}
          </div>
          {days.map((d) => {
            const list = events.filter((e) => startOfDay(new Date(e.startsAt)).getTime() === +d);
            return (
              <div key={+d} className={`cal-col ${+d === today ? 'today' : ''} ${writable ? 'writable' : ''}`}
                onClick={(ev) => {
                  if (!writable || ev.target !== ev.currentTarget) return;
                  const mins = Math.max(0, Math.floor((ev.nativeEvent.offsetY / HOUR_PX) * 2) * 30); // blocos de 30 min
                  onSlot(new Date(d.getFullYear(), d.getMonth(), d.getDate(), HOUR_START, mins));
                }}
                title={writable ? 'Clique em um horário livre para agendar' : undefined}>
                {layoutDay(list).map(({ e, lane, lanes }) => {
                  const s = new Date(e.startsAt);
                  const end = new Date(e.endsAt);
                  const startMin = Math.max(0, minutesFromStart(s));
                  const endMin = Math.min(minutesFromStart(end), (HOUR_END - HOUR_START) * 60);
                  const top = (startMin / 60) * HOUR_PX;
                  const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_PX - 2);
                  return (
                    <button key={e.id} className={`cal-event kind-${e.kind} ${e.status === 'cancelado' ? 'cancelled' : ''}`}
                      style={{ top, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                      onClick={() => onOpen(e)}
                      aria-label={`${dayTitle(d)}, ${hhmm(e.startsAt)} a ${hhmm(e.endsAt)}: ${e.title}, ${STATUS_LABEL[e.status]}`}>
                      <span className="cal-event-time">{hhmm(e.startsAt)}</span>
                      <span className="cal-event-title">{e.title}</span>
                      {height > 44 && <span className="cal-event-meta">{e.patientSocialName || e.patientName || e.professionalName || KIND_LABEL[e.kind]}</span>}
                    </button>
                  );
                })}
                {+d === today && now.getHours() >= HOUR_START && now.getHours() < HOUR_END && (
                  <div className="cal-now" style={{ top: (minutesFromStart(now) / 60) * HOUR_PX }} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {outside > 0 && <p className="subtle panel-pad">{outside} compromisso(s) fora do horário exibido ({HOUR_START}h às {HOUR_END}h): veja na visualização em lista.</p>}
    </div>
  );
}

function EventModal({ event, defaultStart, professionals, writable, onClose, onSaved }: {
  event: AgendaEvent | null; defaultStart: Date; professionals: { id: string; name: string }[]; writable: boolean;
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const initialStart = event ? new Date(event.startsAt) : defaultStart;
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
