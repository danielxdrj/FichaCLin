import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, patch, post } from '../lib/api';
import { initials, ROLE_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import {
  ConfirmDialog, EmptyState, ErrorAlert, Field, Input, Loading, Modal, Segmented, Select, Status, useToast,
} from '../components/ui';

/** Rótulos das permissões definidas no backend (domain/permissions.ts). Nenhuma permissão nova é criada aqui. */
const PERM_LABEL: Record<string, string> = {
  'patients:read': 'Ver cadastro de pacientes e agenda',
  'patients:write': 'Editar cadastro de pacientes e agenda',
  'clinical:read': 'Ver dados clínicos',
  'clinical:write': 'Registrar atendimento',
  'anamnesis:template': 'Editar modelo de anamnese',
  export: 'Exportar prontuário',
  'users:manage': 'Gerenciar usuários',
  'clinic:manage': 'Configurar consultório',
  'audit:read': 'Ver auditoria',
  'support:manage': 'Autorizar acesso do suporte',
};
/** Espelha OWNER_ONLY do backend; o servidor é quem aplica a regra. */
const OWNER_ONLY = ['users:manage', 'clinic:manage', 'audit:read', 'support:manage'];

interface UserRow {
  membershipId: string; userId: string; name: string; email: string; cro: string | null; role: string;
  permissions: string[] | null; effectivePermissions: string[]; active: boolean; mfaEnabled: boolean;
}
interface Catalog { permissions: string[]; roleDefaults: Record<string, string[]> }
type Filter = 'todos' | 'ativos' | 'inativos';

/**
 * Usuários e papéis (REQ-22).
 * Causa do problema anterior: a tela não tinha "usuário selecionado"; a matriz de permissões só era
 * recarregada ao trocar o papel. Agora o usuário selecionado fica no endereço (?usuario=) e o painel
 * de permissões é derivado sempre da lista vinda do servidor — a mesma fonte de dados da tabela.
 */
export function UsersPage() {
  const { me } = useSession();
  const [params, setParams] = useSearchParams();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [filter, setFilter] = useState<Filter>('todos');
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; danger?: boolean; run: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const readOnly = me?.current?.billingStatus === 'suspended';

  const load = useCallback(async () => {
    try {
      const r = await api<{ users: UserRow[]; catalog: Catalog }>('/users');
      setUsers(r.users);
      setCatalog(r.catalog);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => (users ?? []).filter((u) => (filter === 'todos' ? true : filter === 'ativos' ? u.active : !u.active)),
    [users, filter],
  );
  const selectedId = params.get('usuario');
  const selected = users?.find((u) => u.membershipId === selectedId) ?? visible[0] ?? null;

  function select(u: UserRow) {
    setParams((p) => { p.set('usuario', u.membershipId); return p; }, { replace: true });
  }

  /** Toda alteração vai ao servidor; a tela recarrega a lista e mantém a seleção. */
  async function change(u: UserRow, body: object, done: string) {
    setError(null);
    setBusy(true);
    try {
      await patch(`/memberships/${u.membershipId}`, body);
      await load();
      toast.show(done);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    todos: users?.length ?? 0,
    ativos: users?.filter((u) => u.active).length ?? 0,
    inativos: users?.filter((u) => !u.active).length ?? 0,
  };

  return (
    <>
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h2>Usuários e papéis</h2>
          <p>Selecione um usuário para ver o papel e as permissões efetivas. Toda alteração fica registrada na auditoria.</p>
        </div>
        {!readOnly && <button className="btn btn-primary" onClick={() => setAdding(true)}>Adicionar usuário</button>}
      </div>
      <ErrorAlert error={error} />
      {!users || !catalog ? <Loading /> : (
        <div className="master-detail">
          <div className="panel">
            <div className="panel-pad row wrap" style={{ justifyContent: 'space-between', paddingBottom: 12 }}>
              <Segmented<Filter> label="Filtrar usuários" value={filter} onChange={setFilter} options={[
                ['todos', `Todos (${counts.todos})`], ['ativos', `Ativos (${counts.ativos})`], ['inativos', `Inativos (${counts.inativos})`],
              ]} />
            </div>
            {visible.length === 0 ? (
              <EmptyState title="Nenhum usuário neste filtro" />
            ) : (
              <div className="table-wrap">
                <table className="table" aria-label="Usuários do consultório">
                  <thead><tr><th>Usuário</th><th>Papel</th><th>Situação</th><th>2FA</th></tr></thead>
                  <tbody>
                    {visible.map((u) => {
                      const isSel = selected?.membershipId === u.membershipId;
                      return (
                        <tr key={u.membershipId} className={`clickable ${isSel ? 'selected' : ''}`} tabIndex={0}
                          aria-selected={isSel} onClick={() => select(u)}
                          onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(u); } }}>
                          <td>
                            <div className="row">
                              <div className="avatar">{initials(u.name)}</div>
                              <div style={{ minWidth: 0 }}>
                                <strong>{u.name}</strong>{u.userId === me?.user.id && <span className="subtle"> (você)</span>}
                                <div className="subtle">{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td>{ROLE_LABEL[u.role]}{u.permissions && u.role !== 'owner' && <div className="subtle">personalizado</div>}</td>
                          <td>{u.active ? <Status tone="ok">Ativo</Status> : <Status tone="off">Inativo</Status>}</td>
                          <td>{u.mfaEnabled ? <Status tone="ok">Ativo</Status> : <Status tone="warn">Não configurado</Status>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="detail">
            {selected && (
              <UserDetail key={selected.membershipId} user={selected} catalog={catalog} isSelf={selected.userId === me?.user.id}
                readOnly={readOnly} busy={busy}
                onRole={(role) => {
                  const run = () => change(selected, { role, permissions: null }, `Papel alterado para ${ROLE_LABEL[role]}.`);
                  if (selected.permissions) {
                    setConfirm({ title: 'Trocar papel', label: 'Trocar papel', run,
                      message: `${selected.name} tem permissões personalizadas. Ao trocar o papel, as permissões voltam ao padrão de ${ROLE_LABEL[role]}.` });
                  } else run();
                }}
                onPerms={(perms) => change(selected, { permissions: perms }, 'Permissões atualizadas.')}
                onActive={(active) => setConfirm({
                  title: active ? 'Reativar usuário' : 'Desativar usuário', label: active ? 'Reativar' : 'Desativar', danger: !active,
                  message: active
                    ? `${selected.name} volta a acessar este consultório com o papel ${ROLE_LABEL[selected.role]}.`
                    : `${selected.name} deixa de acessar este consultório. O histórico e a auditoria são mantidos, e é possível reativar depois.`,
                  run: () => change(selected, { active }, active ? 'Usuário reativado.' : 'Usuário desativado.'),
                })}
              />
            )}
          </div>
        </div>
      )}

      {adding && <AddUserModal onClose={() => setAdding(false)} onDone={async (name) => { setAdding(false); await load(); toast.show(`${name} adicionado(a).`); }} />}
      {confirm && (
        <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.label} danger={confirm.danger}
          onCancel={() => setConfirm(null)} onConfirm={async () => { const c = confirm; setConfirm(null); await c.run(); }} />
      )}
      {toast.node}
    </>
  );
}

function UserDetail({ user, catalog, isSelf, readOnly, busy, onRole, onPerms, onActive }: {
  user: UserRow; catalog: Catalog; isSelf: boolean; readOnly: boolean; busy: boolean;
  onRole: (role: string) => void; onPerms: (perms: string[] | null) => void; onActive: (active: boolean) => void;
}) {
  const isOwner = user.role === 'owner';
  const defaults = catalog.roleDefaults[user.role] ?? [];
  const editable = !readOnly && !isOwner && !busy;
  const assignable = catalog.permissions.filter((p) => !OWNER_ONLY.includes(p));

  function toggle(perm: string, on: boolean) {
    const next = on ? [...user.effectivePermissions, perm] : user.effectivePermissions.filter((p) => p !== perm);
    onPerms(next);
  }

  return (
    <div className="panel">
      <div className="panel-pad stack" style={{ gap: 14 }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="avatar" style={{ width: 40, height: 40, fontSize: 14 }}>{initials(user.name)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ fontSize: 16 }}>{user.name}</h2>
            <div className="subtle">{user.email}{user.cro ? ` · ${user.cro}` : ''}</div>
            <div className="row wrap" style={{ marginTop: 8, gap: 16 }}>
              {user.active ? <Status tone="ok">Ativo</Status> : <Status tone="off">Inativo</Status>}
              {user.mfaEnabled ? <Status tone="ok">2FA ativo</Status> : <Status tone="warn">2FA não configurado</Status>}
            </div>
          </div>
        </div>

        <div className="form-grid">
          <Field className="col-8" label="Papel atribuído" hint={isSelf ? 'Você não pode alterar o seu próprio papel.' : undefined}>
            <Select value={user.role} disabled={readOnly || isSelf || busy} onChange={(e) => onRole(e.target.value)}
              options={Object.entries(ROLE_LABEL)} />
          </Field>
          <div className="col-4" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className={`btn ${user.active ? 'btn-danger' : ''}`} style={{ width: '100%' }}
              disabled={readOnly || isSelf || busy} onClick={() => onActive(!user.active)}>
              {user.active ? 'Desativar' : 'Reativar'}
            </button>
          </div>
        </div>
      </div>

      <div className="divider" />

      <div className="panel-pad">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <h3>Permissões efetivas</h3>
            <p className="subtle">
              {isOwner
                ? 'Proprietário(a) tem todas as permissões. Não é possível restringir.'
                : user.permissions
                  ? `Personalizadas a partir do padrão de ${ROLE_LABEL[user.role]}.`
                  : `Padrão do papel ${ROLE_LABEL[user.role]}.`}
            </p>
          </div>
          {user.permissions && !isOwner && (
            <button className="btn btn-sm" disabled={!editable} onClick={() => onPerms(null)}>Restaurar padrão</button>
          )}
        </div>
        <div className="perm-list" role="list" aria-label={`Permissões de ${user.name}`}>
          {assignable.map((p) => {
            const on = user.effectivePermissions.includes(p);
            const isDefault = defaults.includes(p);
            const source = isOwner ? 'Do papel' : on && isDefault ? 'Do papel' : on ? 'Concedida a mais' : isDefault ? 'Removida do padrão' : '';
            const cls = source === 'Concedida a mais' ? 'extra' : source === 'Removida do padrão' ? 'removed' : '';
            const id = `perm-${user.membershipId}-${p}`;
            return (
              <div className="perm-row" role="listitem" key={p}>
                <input id={id} type="checkbox" checked={on} disabled={!editable} onChange={(e) => toggle(p, e.target.checked)} />
                <label htmlFor={id}>{PERM_LABEL[p] ?? p}</label>
                <span className={`perm-source ${cls}`}>{source}</span>
              </div>
            );
          })}
          {OWNER_ONLY.map((p) => (
            <div className="perm-row" role="listitem" key={p}>
              <input type="checkbox" checked={isOwner} disabled aria-label={PERM_LABEL[p]} />
              <span className={isOwner ? '' : 'muted'}>{PERM_LABEL[p]}</span>
              <span className="perm-source">{isOwner ? 'Do papel' : 'Exclusiva do(a) proprietário(a)'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddUserModal({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'reception', cro: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post('/users', { ...form, cro: form.cro || null });
      onDone(form.name);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Adicionar usuário" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Nome completo"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
        <div className="form-grid">
          <Field className="col-6" label="Papel">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={Object.entries(ROLE_LABEL)} />
          </Field>
          <Field className="col-6" label={form.role === 'dentist' ? 'CRO *' : 'CRO'}>
            <Input value={form.cro} onChange={(e) => setForm({ ...form, cro: e.target.value })} required={form.role === 'dentist'} />
          </Field>
        </div>
        <Field label="Senha inicial" hint="Mín. 10 caracteres, com letras e números. Entregue por um canal seguro.">
          <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        <ErrorAlert error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Adicionando…' : 'Adicionar'}</button>
        </div>
      </form>
    </Modal>
  );
}
