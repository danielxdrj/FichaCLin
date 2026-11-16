import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ageFrom, formatDate, initials, maskCpf } from '../lib/format';
import { useSession } from '../lib/session';
import { Icon } from '../components/Icon';
import { ErrorAlert, PageHead, Select } from '../components/ui';

interface Row {
  id: string; fullName: string; socialName: string | null; birthDate: string; phone: string; cpf: string | null;
  active: boolean; hasGuardian: boolean; lastVisit: string | null;
}

/** 02 — Lista / busca de pacientes. */
export function PatientsPage() {
  const { can, me } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const readOnly = me?.current?.billingStatus === 'suspended';

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ patients: Row[] }>(`/patients?status=${status}&q=${encodeURIComponent(q)}`)
        .then((r) => setRows(r.patients))
        .catch(setError);
    }, 200);
    return () => clearTimeout(t);
  }, [q, status]);

  return (
    <>
      <PageHead
        title="Pacientes"
        subtitle={rows ? `${rows.length} ${status === 'inactive' ? 'inativos' : 'cadastrados'}` : ' '}
        actions={can('patients:write') && !readOnly && (
          <Link className="btn btn-primary" to="/pacientes/novo"><Icon name="plus" size={16} /> Novo paciente</Link>
        )}
      />
      <div className="card">
        <div className="card-head">
          <div className="row" style={{ flex: 1, maxWidth: 520 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-subtle)' }}><Icon name="search" size={18} /></span>
              <input className="input" style={{ paddingLeft: 36 }} placeholder="Buscar por nome, CPF ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div style={{ width: 160 }}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[['active', 'Ativos'], ['inactive', 'Inativos'], ['all', 'Todos']]} />
          </div>
        </div>
        <ErrorAlert error={error} />
        {rows && rows.length === 0 ? (
          <div className="empty">Nenhum paciente encontrado.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Paciente</th><th>Idade</th><th>Telefone</th><th>CPF</th><th>Última visita</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows?.map((p) => {
                const age = ageFrom(p.birthDate);
                return (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/pacientes/${p.id}`)}>
                    <td>
                      <div className="row">
                        <div className="avatar">{initials(p.socialName || p.fullName)}</div>
                        <div>
                          <strong>{p.socialName || p.fullName}</strong>
                          {p.socialName && <div className="subtle">{p.fullName}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{age} anos {age < 18 && <span className="tag warning">Menor</span>}</td>
                    <td>{p.phone}</td>
                    <td className="muted">{maskCpf(p.cpf)}</td>
                    <td>{formatDate(p.lastVisit)}</td>
                    <td>{p.active ? <span className="tag success">Ativo</span> : <span className="tag">Inativo</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
