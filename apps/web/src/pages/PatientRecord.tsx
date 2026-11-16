import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { api, post } from '../lib/api';
import { ageFrom, formatDate, formatDateTime, initials } from '../lib/format';
import { useSession } from '../lib/session';
import { Icon } from '../components/Icon';
import { Card, ErrorAlert, PageHead, Toggle } from '../components/ui';
import { CONSENT_LABELS } from './PatientForm';
import { AnamnesisTab } from './record/AnamnesisTab';
import { OdontogramTab } from './record/OdontogramTab';
import { HistoryTab } from './record/HistoryTab';

export interface Patient {
  id: string; fullName: string; socialName: string | null; birthDate: string; cpf: string | null; sex: string | null;
  profession: string | null; maritalStatus: string | null; phone: string; email: string | null; notes: string | null;
  address: Record<string, string>; active: boolean; isMinor: boolean;
  guardian: { name: string; cpf: string; relationship: string; phone: string } | null;
  consents: { purpose: 'marketing' | 'image' | 'research'; granted: boolean; textVersion: string; grantedByName: string; grantedByRelation: string; createdAt: string }[];
}

export function PatientRecordPage() {
  const { id, tab = 'resumo' } = useParams();
  const { can, me } = useSession();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState<unknown>(null);
  const readOnly = me?.current?.billingStatus === 'suspended';

  const load = useCallback(() => {
    api<Patient>(`/patients/${id}`).then(setPatient).catch(setError);
  }, [id]);
  useEffect(load, [load]);

  if (error) return <ErrorAlert error={error} />;
  if (!patient) return <div className="empty">Carregando…</div>;

  const name = patient.socialName || patient.fullName;
  const tabs: [string, string][] = [['resumo', 'Resumo']];
  if (can('clinical:read')) tabs.push(['anamnese', 'Anamnese'], ['odontograma', 'Odontograma'], ['historico', 'Histórico / evolução']);

  async function toggleActive() {
    const verb = patient!.active ? 'inactivate' : 'reactivate';
    if (patient!.active && !confirm('Inativar o paciente? O prontuário é mantido (guarda mínima de 20 anos) e pode ser reativado.')) return;
    try {
      await post(`/patients/${id}/${verb}`);
      load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <PageHead
        crumb={<><Link to="/pacientes">Pacientes</Link> / {name}</>}
        title={
          <span className="row">
            <span className="avatar" style={{ width: 40, height: 40, fontSize: 14 }}>{initials(name)}</span>
            {name}
            {!patient.active && <span className="tag">Inativo</span>}
            {patient.isMinor && <span className="tag warning">Menor · responsável: {patient.guardian?.name}</span>}
          </span>
        }
        subtitle={`${ageFrom(patient.birthDate)} anos · nasc. ${formatDate(patient.birthDate)} · ${patient.phone}`}
        actions={<>
          {can('export') && (
            <Link className="btn" to={`/pacientes/${id}/exportar`}><Icon name="download" size={16} /> Exportar prontuário</Link>
          )}
          {can('patients:write') && !readOnly && <Link className="btn" to={`/pacientes/${id}/editar`}>Editar</Link>}
        </>}
      />
      <nav className="tabs">
        {tabs.map(([key, label]) => (
          <NavLink key={key} to={`/pacientes/${id}/${key === 'resumo' ? '' : key}`} end className={() => `tab ${tab === key ? 'active' : ''}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      {tab === 'resumo' && <Summary patient={patient} reload={load} onToggleActive={toggleActive} readOnly={readOnly} />}
      {tab === 'anamnese' && <AnamnesisTab patient={patient} readOnly={readOnly} />}
      {tab === 'odontograma' && <OdontogramTab patient={patient} readOnly={readOnly} />}
      {tab === 'historico' && <HistoryTab patient={patient} readOnly={readOnly} />}
    </>
  );
}

function Summary({ patient, reload, onToggleActive, readOnly }: { patient: Patient; reload: () => void; onToggleActive: () => void; readOnly: boolean }) {
  const { can } = useSession();
  const [error, setError] = useState<unknown>(null);
  const a = patient.address ?? {};

  async function setConsent(purpose: string, granted: boolean) {
    try {
      await post(`/patients/${patient.id}/consents`, { purpose, granted });
      reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="grid-2">
      <div className="stack">
        <Card title="Dados pessoais">
          <dl className="kv">
            <dt>Nome completo</dt><dd>{patient.fullName}</dd>
            <dt>Nome social</dt><dd>{patient.socialName || '—'}</dd>
            <dt>CPF</dt><dd>{patient.cpf || '—'}</dd>
            <dt>Sexo</dt><dd>{patient.sex || '—'}</dd>
            <dt>Profissão</dt><dd>{patient.profession || '—'}</dd>
            <dt>Estado civil</dt><dd>{patient.maritalStatus || '—'}</dd>
            <dt>E-mail</dt><dd>{patient.email || '—'}</dd>
            <dt>Endereço</dt><dd>{[a.street, a.number, a.district, a.city, a.state].filter(Boolean).join(', ') || '—'}</dd>
          </dl>
        </Card>
        {patient.guardian && (
          <Card title="Responsável legal">
            <dl className="kv">
              <dt>Nome</dt><dd>{patient.guardian.name}</dd>
              <dt>Parentesco</dt><dd>{patient.guardian.relationship}</dd>
              <dt>CPF</dt><dd>{patient.guardian.cpf}</dd>
              <dt>Contato</dt><dd>{patient.guardian.phone}</dd>
            </dl>
          </Card>
        )}
        {patient.notes && <Card title="Observações"><p style={{ whiteSpace: 'pre-wrap' }}>{patient.notes}</p></Card>}
      </div>
      <div className="stack">
        <Card title="Consentimentos">
          <div className="stack" style={{ gap: 4 }}>
            {(Object.keys(CONSENT_LABELS) as (keyof typeof CONSENT_LABELS)[]).map((k) => {
              const c = patient.consents.find((x) => x.purpose === k);
              return (
                <div key={k} className="row" style={{ alignItems: 'flex-start', padding: '8px 0' }}>
                  <div style={{ flex: 1 }}>
                    <div>{CONSENT_LABELS[k]}</div>
                    {c && <div className="subtle">{c.granted ? 'Autorizado' : 'Não autorizado'} por {c.grantedByName} ({c.grantedByRelation}) · {formatDateTime(c.createdAt)} · {c.textVersion}</div>}
                  </div>
                  {can('patients:write') && !readOnly && (
                    <Toggle label={k} checked={Boolean(c?.granted)} onChange={(v) => setConsent(k, v)} />
                  )}
                </div>
              );
            })}
          </div>
          <ErrorAlert error={error} />
        </Card>
        {can('patients:write') && !readOnly && (
          <Card title="Situação do cadastro">
            <p className="subtle" style={{ marginBottom: 12 }}>
              Pacientes não são excluídos: o prontuário deve ser guardado por no mínimo 20 anos (Lei 13.787/2018).
            </p>
            <button className={`btn ${patient.active ? 'btn-danger' : ''}`} onClick={onToggleActive}>
              {patient.active ? 'Inativar paciente' : 'Reativar paciente'}
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
