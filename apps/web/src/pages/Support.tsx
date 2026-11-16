import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, post } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Icon } from '../components/Icon';
import {
  ConfirmDialog, EmptyState, ErrorAlert, Field, Input, Loading, Modal, PageHead, Section, Select, Status, Textarea, useToast,
} from '../components/ui';

// Valores fixos definidos no backend (routes/support.ts e migração 005).
export const CATEGORY_LABEL: Record<string, string> = {
  problema_tecnico: 'Problema técnico',
  erro_funcionalidade: 'Erro ao usar uma funcionalidade',
  acesso: 'Problema de acesso',
  seguranca: 'Problema de segurança',
  duvida: 'Dúvida sobre o sistema',
  orientacao: 'Solicitação de orientação',
  outro: 'Outro(a)',
};
const PRIORITY_LABEL: Record<string, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', critica: 'Crítica' };
const STATUS_LABEL: Record<string, string> = {
  aberta: 'Aberta', em_analise: 'Em análise', aguardando_cliente: 'Aguardando você', resolvida: 'Resolvida', encerrada: 'Encerrada',
};
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'off'> = {
  aberta: 'info', em_analise: 'info', aguardando_cliente: 'warn', resolvida: 'ok', encerrada: 'off',
};
const GRANT_TONE: Record<string, 'ok' | 'off' | 'bad'> = { ativa: 'ok', expirada: 'off', revogada: 'bad' };

interface Ticket {
  id: string; number: number; category: string; categoryOther: string | null; priority: string; subject: string;
  status: string; createdAt: string; updatedAt: string; createdBy: string;
}
interface Grant {
  id: string; reason: string; startsAt: string; expiresAt: string; revokedAt: string | null; durationHours: number;
  grantedBy: string; revokedBy: string | null; ticketNumber: number | null; ticketId: string | null; status: 'ativa' | 'expirada' | 'revogada';
}
interface SupportData { dpo: { name: string; email: string }; tickets: Ticket[]; grants: Grant[]; canManage: boolean; seesAll: boolean }

function categoryText(t: Pick<Ticket, 'category' | 'categoryOther'>) {
  return t.category === 'outro' && t.categoryOther ? `Outro: ${t.categoryOther}` : CATEGORY_LABEL[t.category];
}

/**
 * Suporte: canal oficial do Fichaclin.
 * - Chamados: abrir, acompanhar, comentar e encerrar.
 * - Acesso do suporte ao ambiente (REQ-30): só o(a) proprietário(a) autoriza, sempre com prazo; tudo vai para a auditoria.
 * - Canal do encarregado de dados (REQ-10).
 */
export function SupportPage() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<SupportData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [granting, setGranting] = useState<{ ticketId?: string } | null>(null);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api<SupportData>('/support'));
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = (t: Ticket) => navigate(`/suporte/${t.id}`);

  return (
    <>
      <PageHead
        title="Suporte"
        subtitle="Canal oficial de atendimento do Fichaclin. Acompanhe aqui suas solicitações."
        actions={<button className="btn btn-primary" onClick={() => setCreating(true)}>Nova solicitação</button>}
      />
      <ErrorAlert error={error} />
      {!data ? <Loading /> : (
        <>
          <div className={ticketId ? 'master-detail' : ''}>
            <Section title="Solicitações" description={data.seesAll ? 'Todas as solicitações do consultório.' : 'Solicitações abertas por você.'}>
              <div className="panel">
                {data.tickets.length === 0 ? (
                  <EmptyState title="Nenhuma solicitação ainda">Use "Nova solicitação" para falar com a equipe do Fichaclin.</EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="table" aria-label="Solicitações de suporte">
                      <thead>
                        <tr>
                          <th>Solicitação</th><th>Categoria</th><th>Situação</th><th>Prioridade</th><th>Criada em</th>
                          {data.seesAll && !ticketId && <th>Aberta por</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {data.tickets.map((t) => (
                          <tr key={t.id} className={`clickable ${t.id === ticketId ? 'selected' : ''}`} tabIndex={0}
                            aria-selected={t.id === ticketId} onClick={() => open(t)}
                            onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') open(t); }}>
                            <td><span className="subtle">#{t.number}</span> <strong>{t.subject}</strong></td>
                            <td>{categoryText(t)}</td>
                            <td><Status tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Status></td>
                            <td>{PRIORITY_LABEL[t.priority]}</td>
                            <td>{formatDateTime(t.createdAt)}</td>
                            {data.seesAll && !ticketId && <td>{t.createdBy}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Section>
            {ticketId && (
              <div className="detail">
                <TicketDetail id={ticketId} canManage={data.canManage} onChanged={load} onClose={() => navigate('/suporte')}
                  onGrant={(id) => setGranting({ ticketId: id })} toast={toast.show} />
              </div>
            )}
          </div>

          {data.canManage && (
            <div className="section" style={{ marginTop: 28 }}>
              <div className="section-head">
                <div>
                  <h2>Acesso do suporte ao ambiente</h2>
                  <p>A equipe do Fichaclin só entra no ambiente do consultório com a sua autorização, por prazo limitado (máximo 72 horas).</p>
                </div>
                <button className="btn" onClick={() => setGranting({})}><Icon name="lock" size={16} /> Autorizar acesso</button>
              </div>
              <div className="panel">
                {data.grants.length === 0 ? (
                  <EmptyState title="Nenhuma autorização concedida">O suporte não tem e nunca teve acesso ao ambiente deste consultório.</EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="table" aria-label="Autorizações de acesso do suporte">
                      <thead><tr><th>Motivo</th><th>Autorizado por</th><th>Início</th><th>Expiração</th><th>Duração</th><th>Situação</th><th /></tr></thead>
                      <tbody>
                        {data.grants.map((g) => (
                          <tr key={g.id}>
                            <td>
                              {g.reason}
                              {g.ticketNumber && <div className="subtle"><Link to={`/suporte/${g.ticketId}`}>Solicitação #{g.ticketNumber}</Link></div>}
                            </td>
                            <td>{g.grantedBy}</td>
                            <td>{formatDateTime(g.startsAt)}</td>
                            <td>{formatDateTime(g.revokedAt ?? g.expiresAt)}</td>
                            <td>{g.durationHours} h</td>
                            <td>
                              <Status tone={GRANT_TONE[g.status]}>{g.status === 'ativa' ? 'Ativa' : g.status === 'expirada' ? 'Expirada' : 'Revogada'}</Status>
                              {g.revokedBy && <div className="subtle">por {g.revokedBy}</div>}
                            </td>
                            <td className="num">{g.status === 'ativa' && <button className="btn btn-sm" onClick={() => setRevoking(g)}>Revogar</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <p className="subtle">
                Concessões, revogações e expirações ficam registradas na <Link to="/auditoria">Auditoria</Link>.
              </p>
            </div>
          )}

          <p className="subtle" style={{ marginTop: 28 }}>
            Encarregado de dados (LGPD): {data.dpo.name} · <a href={`mailto:${data.dpo.email}`}>{data.dpo.email}</a>.
            Pacientes que queiram exercer direitos sobre seus dados devem procurar o consultório.
          </p>
        </>
      )}

      {creating && (
        <NewTicketModal onClose={() => setCreating(false)} onDone={async (r) => {
          setCreating(false);
          await load();
          toast.show(`Solicitação #${r.number} criada.`);
          navigate(`/suporte/${r.id}`);
        }} />
      )}
      {granting && data && (
        <GrantModal tickets={data.tickets.filter((t) => t.status !== 'encerrada')} initialTicketId={granting.ticketId}
          onClose={() => setGranting(null)} onDone={async () => { setGranting(null); await load(); toast.show('Acesso autorizado.'); }} />
      )}
      {revoking && (
        <ConfirmDialog title="Revogar acesso do suporte" confirmLabel="Revogar agora" danger
          message={`O acesso autorizado por ${revoking.grantedBy} termina imediatamente.`}
          onCancel={() => setRevoking(null)}
          onConfirm={async () => {
            const g = revoking;
            setRevoking(null);
            try {
              await post(`/support/grants/${g.id}/revoke`);
              await load();
              toast.show('Acesso revogado.');
            } catch (err) {
              setError(err);
            }
          }} />
      )}
      {toast.node}
    </>
  );
}

function TicketDetail({ id, canManage, onChanged, onClose, onGrant, toast }: {
  id: string; canManage: boolean; onChanged: () => void; onClose: () => void; onGrant: (id: string) => void; toast: (m: string) => void;
}) {
  const [detail, setDetail] = useState<{ ticket: Ticket & { description: string }; events: any[] } | null>(null);
  const [comment, setComment] = useState('');
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await api(`/support/tickets/${id}`));
    } catch (err) {
      setError(err);
    }
  }, [id]);
  useEffect(() => { setDetail(null); load(); }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    try {
      await post(`/support/tickets/${id}/comments`, { body: comment });
      setComment('');
      await load();
      onChanged();
      toast('Comentário enviado.');
    } catch (err) {
      setError(err);
    }
  }

  if (error && !detail) return <ErrorAlert error={error} />;
  if (!detail) return <Loading />;
  const t = detail.ticket;
  const closed = t.status === 'encerrada';

  return (
    <div className="panel">
      <div className="panel-pad stack" style={{ gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <span className="subtle">Solicitação #{t.number}</span>
            <h2 style={{ fontSize: 16 }}>{t.subject}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar detalhes"><Icon name="x" size={16} /></button>
        </div>
        <dl className="kv">
          <dt>Situação</dt><dd><Status tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Status></dd>
          <dt>Categoria</dt><dd>{categoryText(t)}</dd>
          <dt>Prioridade</dt><dd>{PRIORITY_LABEL[t.priority]}</dd>
          <dt>Aberta por</dt><dd>{t.createdBy} · {formatDateTime(t.createdAt)}</dd>
        </dl>
        <p style={{ whiteSpace: 'pre-wrap' }}>{t.description}</p>
      </div>
      <div className="divider" />
      <div className="panel-pad stack" style={{ gap: 10 }}>
        <h3>Histórico</h3>
        {detail.events.length === 0 && <p className="subtle">Sem atualizações ainda. A equipe do Fichaclin responde por aqui.</p>}
        {detail.events.map((e) => (
          <div key={e.id} style={{ borderLeft: '2px solid var(--neutral-border-strong)', paddingLeft: 10 }}>
            <div className="subtle">{e.author} · {formatDateTime(e.createdAt)}</div>
            {e.kind === 'comentario'
              ? <p style={{ whiteSpace: 'pre-wrap' }}>{e.body}</p>
              : <p className="muted">Situação alterada: {STATUS_LABEL[e.fromStatus] ?? e.fromStatus} → {STATUS_LABEL[e.toStatus] ?? e.toStatus}</p>}
          </div>
        ))}
        {!closed && (
          <form className="stack" style={{ gap: 8 }} onSubmit={send}>
            <Field label="Adicionar comentário">
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Mais detalhes, respostas ao suporte…" />
            </Field>
            <ErrorAlert error={error} />
            <div className="row wrap" style={{ justifyContent: 'space-between' }}>
              <div className="row wrap">
                <button type="button" className="btn btn-sm" onClick={() => setClosing(true)}>Encerrar solicitação</button>
                {canManage && <button type="button" className="btn btn-sm" onClick={() => onGrant(t.id)}>Autorizar acesso para esta solicitação</button>}
              </div>
              <button className="btn btn-sm btn-primary" disabled={comment.trim().length < 2}>Enviar</button>
            </div>
          </form>
        )}
        {closed && <p className="subtle">Solicitação encerrada em {formatDateTime(t.updatedAt)}. Para um novo problema, abra outra solicitação.</p>}
      </div>
      {closing && (
        <ConfirmDialog title="Encerrar solicitação" confirmLabel="Encerrar"
          message="A solicitação deixa de receber comentários. Se o problema voltar, abra uma nova."
          onCancel={() => setClosing(false)}
          onConfirm={async () => {
            setClosing(false);
            try {
              await post(`/support/tickets/${id}/close`);
              await load();
              onChanged();
              toast('Solicitação encerrada.');
            } catch (err) {
              setError(err);
            }
          }} />
      )}
    </div>
  );
}

function NewTicketModal({ onClose, onDone }: { onClose: () => void; onDone: (r: { id: string; number: number }) => void }) {
  const [form, setForm] = useState({ category: '', categoryOther: '', priority: 'normal', subject: '', description: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onDone(await post('/support/tickets', { ...form, categoryOther: form.category === 'outro' ? form.categoryOther : null }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nova solicitação" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field className="col-8" label="Motivo">
            <Select value={form.category} onChange={(e) => set('category', e.target.value)} required
              options={[['', 'Selecione'], ...Object.entries(CATEGORY_LABEL)]} />
          </Field>
          <Field className="col-4" label="Prioridade">
            <Select value={form.priority} onChange={(e) => set('priority', e.target.value)} options={Object.entries(PRIORITY_LABEL)} />
          </Field>
          {form.category === 'outro' && (
            <Field className="col-12" label="Informe o motivo">
              <Input value={form.categoryOther} maxLength={120} onChange={(e) => set('categoryOther', e.target.value)} required />
            </Field>
          )}
          {form.category === 'seguranca' && (
            <div className="col-12 alert warning">
              Suspeita de acesso indevido ou vazamento? Descreva o que observou e quando, e marque a prioridade como
              Crítica. Se houver risco para pacientes, o consultório (controlador) pode ter prazo legal para comunicar a ANPD.
            </div>
          )}
        </div>
        <Field label="Assunto"><Input value={form.subject} maxLength={140} onChange={(e) => set('subject', e.target.value)} required /></Field>
        <Field label="Descrição" hint="Não inclua dados de pacientes (nome, CPF ou informações clínicas). Descreva a tela e o que aconteceu.">
          <Textarea value={form.description} maxLength={5000} onChange={(e) => set('description', e.target.value)} required />
        </Field>
        <p className="subtle">Anexos ainda não estão disponíveis: arquivos só serão aceitos quando o armazenamento criptografado estiver em produção.</p>
        <ErrorAlert error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar solicitação'}</button>
        </div>
      </form>
    </Modal>
  );
}

function GrantModal({ tickets, initialTicketId, onClose, onDone }: {
  tickets: Ticket[]; initialTicketId?: string; onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState({ ticketId: initialTicketId ?? '', reason: '', hours: '4' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post('/support/grants', { reason: form.reason, hours: Number(form.hours), ticketId: form.ticketId || null });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Autorizar acesso do suporte" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">
          A equipe do Fichaclin poderá acessar o ambiente deste consultório até o prazo escolhido. Você pode revogar a
          qualquer momento. A autorização fica registrada na auditoria.
        </p>
        <Field label="Solicitação relacionada">
          <Select value={form.ticketId} onChange={(e) => setForm({ ...form, ticketId: e.target.value })}
            options={[['', 'Nenhuma'], ...tickets.map((t) => [t.id, `#${t.number} — ${t.subject}`] as [string, string])]} />
        </Field>
        <Field label="Motivo do acesso"><Input value={form.reason} maxLength={300} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ex.: analisar erro na exportação" required /></Field>
        <Field label="Duração">
          <Select value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })}
            options={[['1', '1 hora'], ['4', '4 horas'], ['24', '24 horas'], ['72', '72 horas (máximo)']]} />
        </Field>
        <ErrorAlert error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy || form.reason.trim().length < 5}>{busy ? 'Autorizando…' : 'Autorizar'}</button>
        </div>
      </form>
    </Modal>
  );
}
