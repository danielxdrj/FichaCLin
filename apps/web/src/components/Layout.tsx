import { NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { post } from '../lib/api';
import { initials, ROLE_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { Icon } from './Icon';

export function Layout() {
  const { me, can, refresh } = useSession();
  const navigate = useNavigate();
  const patientMatch = useMatch('/pacientes/:id/*');
  const patientId = patientMatch?.params.id && patientMatch.params.id !== 'novo' ? patientMatch.params.id : null;
  if (!me?.current) return null;
  const clinic = me.clinics.find((c) => c.id === me.current!.clinicId);
  const suspended = me.current.billingStatus === 'suspended';

  async function logout() {
    await post('/auth/logout');
    await refresh();
    navigate('/');
  }

  async function switchClinic() {
    // Volta ao seletor de consultório (tela 09).
    await post('/auth/leave-clinic');
    await refresh();
    navigate('/');
  }

  const item = (to: string, icon: string, label: string, opts: { sub?: boolean; end?: boolean } = {}) => (
    <NavLink to={to} end={opts.end} className={({ isActive }) => `nav-item ${opts.sub ? 'nav-sub' : ''} ${isActive ? 'active' : ''}`}>
      <Icon name={icon} /> {label}
    </NavLink>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">F</div> Fichaclin
        </div>
        {can('patients:read') && item('/pacientes', 'users', 'Pacientes', { end: true })}
        {patientId && can('clinical:read') && (
          <>
            {item(`/pacientes/${patientId}/anamnese`, 'clipboard', 'Anamnese', { sub: true })}
            {item(`/pacientes/${patientId}/odontograma`, 'tooth', 'Odontograma', { sub: true })}
            {item(`/pacientes/${patientId}/historico`, 'clock', 'Histórico', { sub: true })}
          </>
        )}
        <div className="nav-sep" />
        {item('/configuracoes', 'settings', 'Configurações')}
        {can('users:manage') && item('/usuarios', 'shield', 'Usuários e papéis')}
        {can('anamnesis:template') && item('/modelo-anamnese', 'list', 'Modelo de anamnese')}
        {can('audit:read') && item('/auditoria', 'eye', 'Auditoria')}
        <div className="grow" />
        <div className="user">
          <div className="avatar">{initials(me.user.name)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>{me.user.name}</strong>
            <small>{ROLE_LABEL[me.current.role]}{me.user.cro ? ` · ${me.user.cro}` : ''}</small>
          </div>
          <button className="nav-item" style={{ width: 'auto', padding: 6 }} onClick={logout} title="Sair" aria-label="Sair">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="row">
            <strong>{clinic?.name}</strong>
            {suspended && <span className="tag danger">Suspenso</span>}
            {me.current.billingStatus === 'trial' && <span className="tag info">Período de teste</span>}
          </div>
          {me.clinics.length > 1 && (
            <button className="btn btn-sm" onClick={switchClinic}>
              <Icon name="swap" size={16} /> Trocar consultório
            </button>
          )}
        </header>
        {suspended && (
          <div className="alert danger" style={{ borderRadius: 0 }}>
            <Icon name="lock" /> Consultório suspenso por inadimplência. O acesso está em modo somente leitura; a exportação
            dos prontuários continua disponível em Configurações · Plano.
          </div>
        )}
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
