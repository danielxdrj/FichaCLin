import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ACTION_LABEL, formatDateTime } from '../lib/format';
import { EmptyState, ErrorAlert, PageHead, Select, Status } from '../components/ui';

/** Tela nova "Auditoria" (REQ-33): quem acessou cada prontuário. */
export function AuditPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [patients, setPatients] = useState<{ id: string; fullName: string }[]>([]);
  const [patientId, setPatientId] = useState('');
  const [chain, setChain] = useState<{ intact: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api('/patients?status=all').then((r) => setPatients(r.patients)).catch(setError);
    api('/audit/verify').then(setChain).catch(setError);
  }, []);

  useEffect(() => {
    api(`/audit?limit=200${patientId ? `&patientId=${patientId}` : ''}`).then((r) => setEvents(r.events)).catch(setError);
  }, [patientId]);

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
        <div style={{ width: 280 }}>
          <Select aria-label="Filtrar por paciente" value={patientId} onChange={(e) => setPatientId(e.target.value)}
            options={[['', 'Todos os pacientes'], ...patients.map((p) => [p.id, p.fullName] as [string, string])]} />
        </div>
      </div>
      {events.length === 0 ? <div className="list-plain"><EmptyState title="Nenhum evento registrado" /></div> : (
        <div className="table-wrap">
          <table className="table" aria-label="Eventos de auditoria">
            <thead><tr><th>Data e hora</th><th>Usuário</th><th>Ação</th><th>Paciente</th><th>IP</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatDateTime(e.createdAt)}</td>
                  <td>{e.userName ?? '—'}</td>
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
