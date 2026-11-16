import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ACTION_LABEL, formatDateTime } from '../lib/format';
import { EmptyState, ErrorAlert, PageHead, Select, Status } from '../components/ui';

/** Tipos de ação para o filtro: valor = prefixos de ação enviados à API (separados por vírgula). */
const ACTION_GROUPS: [string, string][] = [
  ['', 'Todas as ações'],
  ['patient.view,clinical.view,odontogram.view,anamnesis.view', 'Acessos ao prontuário'],
  ['patient.create,patient.update,patient.inactivate,patient.reactivate,consent.', 'Cadastro e consentimentos'],
  ['clinical.create,clinical.update,clinical.sign,clinical.addendum,anamnesis.create', 'Registros clínicos'],
  ['record.export', 'Exportações'],
  ['agenda.', 'Agenda'],
  ['membership.', 'Usuários e permissões'],
  ['clinic.,dpa.,anamnesis_template.,session.', 'Consultório e acesso'],
  ['support.', 'Suporte'],
];

/** Tela nova "Auditoria" (REQ-33): quem acessou cada prontuário. */
export function AuditPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [patients, setPatients] = useState<{ id: string; fullName: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [patientId, setPatientId] = useState('');
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [chain, setChain] = useState<{ intact: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api('/patients?status=all').then((r) => setPatients(r.patients)).catch(setError);
    api('/audit/users').then((r) => setUsers(r.users)).catch(setError);
    api('/audit/verify').then(setChain).catch(setError);
  }, []);

  useEffect(() => {
    const qs = new URLSearchParams({ limit: '200' });
    if (patientId) qs.set('patientId', patientId);
    if (userId) qs.set('userId', userId);
    if (action) qs.set('action', action);
    // Ignora respostas de filtros antigos que cheguem depois da atual.
    let current = true;
    api(`/audit?${qs}`).then((r) => { if (current) setEvents(r.events); }).catch((err) => { if (current) setError(err); });
    return () => { current = false; };
  }, [patientId, userId, action]);

  const filtered = Boolean(patientId || userId || action);

  return (
    <>
      <PageHead
        title="Auditoria"
        subtitle="Quem abriu, criou, alterou ou exportou cada prontuário. Os registros não podem ser alterados nem apagados."
        actions={chain && (chain.intact
          ? <Status tone="ok">Cadeia de integridade verificada</Status>
          : <Status tone="bad">Cadeia de integridade com divergência</Status>)}
      />
      <ErrorAlert error={error} />
      <div className="toolbar">
        <div style={{ width: 240 }}>
          <Select aria-label="Filtrar por paciente" value={patientId} onChange={(e) => setPatientId(e.target.value)}
            options={[['', 'Todos os pacientes'], ...patients.map((p) => [p.id, p.fullName] as [string, string])]} />
        </div>
        <div style={{ width: 220 }}>
          <Select aria-label="Filtrar por ação" value={action} onChange={(e) => setAction(e.target.value)} options={ACTION_GROUPS} />
        </div>
        <div style={{ width: 220 }}>
          <Select aria-label="Filtrar por usuário" value={userId} onChange={(e) => setUserId(e.target.value)}
            options={[['', 'Todos os usuários'], ...users.map((u) => [u.id, u.name] as [string, string])]} />
        </div>
        {filtered && (
          <button type="button" className="btn-link" onClick={() => { setUserId(''); setPatientId(''); setAction(''); }}>Limpar filtros</button>
        )}
      </div>
      {events.length === 0 ? (
        <div className="list-plain">
          <EmptyState title={filtered ? 'Nenhum evento com esses filtros' : 'Nenhum evento registrado'} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Eventos de auditoria">
            <thead><tr><th>Data e hora</th><th>Usuário</th><th>Ação</th><th>Paciente</th><th>IP</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatDateTime(e.createdAt)}</td>
                  <td>
                    {e.userId && e.userId !== userId
                      ? <button type="button" className="btn-link" style={{ color: 'inherit', fontWeight: 400 }}
                          title={`Ver só as ações de ${e.userName}`} onClick={() => setUserId(e.userId)}>{e.userName}</button>
                      : (e.userName ?? '—')}
                  </td>
                  <td>{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td>{e.patientId ? <Link to={`/pacientes/${e.patientId}`}>{e.patientName}</Link> : <span className="muted">—</span>}</td>
                  <td className="subtle">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
