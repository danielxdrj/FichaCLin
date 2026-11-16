import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ageFrom, formatDate, maskCpf } from '../lib/format';
import { useSession } from '../lib/session';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorAlert, PageHead, Select, Status, useToast } from '../components/ui';
import { ExportAllButton, type ExportScope } from '../components/ExportAll';

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
  const toast = useToast();

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
        actions={<>
          {/* Exporta conforme o filtro de situação atual; dentro de cada paciente continua a exportação individual. */}
          {can('export') && (
            <ExportAllButton scope={status as ExportScope}
              label={status === 'active' ? 'Exportar ativos' : status === 'inactive' ? 'Exportar inativos' : 'Exportar todos'}
              onDone={(n) => toast.show(`${n} prontuário(s) exportado(s).`)} />
          )}
          {can('patients:write') && !readOnly && (
            <Link className="btn btn-primary" to="/pacientes/novo"><Icon name="plus" size={16} /> Novo paciente</Link>
          )}
        </>}
      />
      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input className="input" aria-label="Buscar paciente" placeholder="Buscar por nome, CPF ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div style={{ width: 150 }}>
          <Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)} options={[['active', 'Ativos'], ['inactive', 'Inativos'], ['all', 'Todos']]} />
        </div>
      </div>
      <ErrorAlert error={error} />
      {rows && rows.length === 0 ? (
        <div className="list-plain"><EmptyState title="Nenhum paciente encontrado">{q ? 'Revise o termo da busca ou o filtro de situação.' : undefined}</EmptyState></div>
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Pacientes">
            <thead>
              {/* Situação só aparece em "Todos": nos outros filtros todas as linhas teriam o mesmo valor. */}
              <tr><th>Paciente</th><th>Telefone</th><th>CPF</th><th>Última visita</th>{status === 'all' && <th>Situação</th>}</tr>
            </thead>
            <tbody>
              {rows?.map((p) => {
                const age = ageFrom(p.birthDate);
                return (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/pacientes/${p.id}`)}>
                    <td>
                      <Link to={`/pacientes/${p.id}`} className="primary" style={{ color: 'inherit' }} onClick={(e) => e.stopPropagation()}>
                        {p.socialName || p.fullName}
                      </Link>
                      <div className="subtle">
                        {age} anos{age < 18 && ' · menor de idade'}{p.socialName && ` · ${p.fullName}`}
                      </div>
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.phone}</td>
                    <td className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{maskCpf(p.cpf)}</td>
                    <td className={p.lastVisit ? undefined : 'muted'}>{formatDate(p.lastVisit)}</td>
                    {status === 'all' && <td>{p.active ? <Status tone="ok">Ativo</Status> : <Status tone="off">Inativo</Status>}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {toast.node}
    </>
  );
}
