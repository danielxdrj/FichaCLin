import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { post } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { Icon } from './Icon';

const COLLAPSE_KEY = 'fichaclin-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Estrutura da aplicação.
 * - Módulos operacionais no topo do menu (Pacientes, Agenda, Suporte, Auditoria).
 * - Administração (Configurações) e Sair ficam no rodapé, junto do usuário.
 * - Telas largas: menu fixo, que pode ser recolhido para só ícones (preferência salva no navegador).
 * - Telas estreitas (< 768px): menu vira gaveta sobre o conteúdo, aberta pelo botão da barra superior.
 * A visibilidade dos itens segue as permissões, mas a proteção real está na API.
 */
export function Layout() {
  const { me, can, refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Fecha a gaveta ao navegar e com Esc.
  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  if (!me?.current) return null;
  const clinic = me.clinics.find((c) => c.id === me.current!.clinicId);
  const suspended = me.current.billingStatus === 'suspended';

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* preferência só nesta sessão */
    }
  }

  async function logout() {
    await post('/auth/logout');
    await refresh();
    navigate('/');
  }

  async function switchClinic() {
    await post('/auth/leave-clinic');
    await refresh();
    navigate('/');
  }

  const item = (to: string, icon: string, label: string) => (
    <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={collapsed ? label : undefined} aria-label={label}>
      <Icon name={icon} /> <span className="nav-label">{label}</span>
    </NavLink>
  );

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''} ${drawerOpen ? 'drawer-open' : ''}`}>
      {drawerOpen && <button className="drawer-backdrop" aria-label="Fechar menu" onClick={() => setDrawerOpen(false)} />}
      <aside className="sidebar" aria-label="Menu principal">
        <div className="sidebar-head">
          <div className="brand"><div className="brand-mark">F</div><span className="brand-name">Fichaclin</span></div>
          <button className="icon-btn collapse-btn" onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            <Icon name={collapsed ? 'expand' : 'collapse'} size={16} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {can('patients:read') && item('/pacientes', 'users', 'Pacientes')}
          {can('patients:read') && item('/agenda', 'calendar', 'Agenda')}
          {item('/suporte', 'lifebuoy', 'Suporte')}
          {can('audit:read') && item('/auditoria', 'eye', 'Auditoria')}
        </nav>

        <div className="sidebar-footer">
          <div className="user" title={collapsed ? `${me.user.name} · ${ROLE_LABEL[me.current.role]}` : undefined}>
            <div className="user-text" style={{ minWidth: 0 }}>
              <strong>{me.user.name}</strong>
              <small>{ROLE_LABEL[me.current.role]}{me.user.cro ? ` · ${me.user.cro}` : ''}</small>
            </div>
          </div>
          {item('/configuracoes', 'settings', 'Configurações')}
          <button className="nav-item" onClick={logout} title={collapsed ? 'Sair' : undefined} aria-label="Sair">
            <Icon name="logout" /> <span className="nav-label">Sair</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="row" style={{ minWidth: 0 }}>
            <button className="icon-btn menu-btn" onClick={() => setDrawerOpen(true)} aria-label="Abrir menu" aria-expanded={drawerOpen}>
              <Icon name="menu" />
            </button>
            <span className="topbar-clinic">{clinic?.name}</span>
            {suspended && <span className="status bad">Suspenso</span>}
            {me.current.billingStatus === 'trial' && <span className="topbar-plan">Período de teste</span>}
          </div>
          {me.clinics.length > 1 && (
            <button className="btn btn-sm btn-ghost" onClick={switchClinic}>
              <Icon name="swap" size={16} /> <span className="nav-label">Trocar consultório</span>
            </button>
          )}
        </header>
        {!me.mfa.enabled && (
          <div className="notice-bar" role="note">
            <Icon name="shield" size={16} />
            <span><strong>Segurança da conta</strong> · Verificação em duas etapas não configurada.</span>
            <NavLink to="/configuracoes/seguranca">Ativar</NavLink>
          </div>
        )}
        {suspended && (
          <div className="notice-bar danger" role="alert">
            <Icon name="lock" size={16} />
            <span><strong>Consultório suspenso por inadimplência</strong> · Acesso somente leitura. A exportação dos
              prontuários e o suporte continuam disponíveis.</span>
          </div>
        )}
        <main className="content" id="conteudo">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
