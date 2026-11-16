import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, patch, post } from '../lib/api';
import { initials, ROLE_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { Card, ErrorAlert, Field, Input, PageHead, Select } from '../components/ui';

const PERM_LABEL: Record<string, string> = {
  'patients:read': 'Ver cadastro de pacientes',
  'patients:write': 'Editar cadastro de pacientes',
  'clinical:read': 'Ver dados clínicos',
  'clinical:write': 'Registrar atendimento',
  'anamnesis:template': 'Editar modelo de anamnese',
  export: 'Exportar prontuário',
  'users:manage': 'Gerenciar usuários',
  'clinic:manage': 'Configurar consultório',
  'audit:read': 'Ver auditoria',
  'support:manage': 'Autorizar suporte',
};
const OWNER_ONLY = ['users:manage', 'clinic:manage', 'audit:read', 'support:manage'];

interface UserRow {
  membershipId: string; userId: string; name: string; email: string; cro: string | null; role: string;
  permissions: string[] | null; effectivePermissions: string[]; active: boolean; mfaEnabled: boolean;
}

/** 08 — Usuários e papéis (REQ-22). Recepção sem dados clínicos por padrão; mudanças auditadas. */
export function UsersPage() {
  const { me } = useSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [catalog, setCatalog] = useState<{ permissions: string[]; roleDefaults: Record<string, string[]> } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'reception', cro: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const readOnly = me?.current?.billingStatus === 'suspended';

  const load = useCallback(async () => {
    try {
      const r = await api('/users');
      setUsers(r.users);
      setCatalog(r.catalog);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function change(u: UserRow, body: object) {
    setError(null);
    try {
      await patch(`/memberships/${u.membershipId}`, body);
      await load();
    } catch (err) {
      setError(err);
    }
  }

  function togglePerm(u: UserRow, perm: string, on: boolean) {
    const next = on ? [...u.effectivePermissions, perm] : u.effectivePermissions.filter((p) => p !== perm);
    change(u, { permissions: next });
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await post('/users', { ...form, cro: form.cro || null });
      setForm({ name: '', email: '', role: 'reception', cro: '', password: '' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  const perms = catalog?.permissions.filter((p) => !OWNER_ONLY.includes(p)) ?? [];

  return (
    <>
      <PageHead title="Usuários e papéis" subtitle="Papéis mínimos: dono, dentista e recepção. Toda alteração fica registrada na auditoria." />
      <ErrorAlert error={error} />
      <div className="stack">
        <Card title="Equipe" bodyClass="">
          <table className="table">
            <thead><tr><th>Usuário</th><th>Papel</th><th>2FA</th><th>Situação</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.membershipId}>
                  <td>
                    <div className="row">
                      <div className="avatar">{initials(u.name)}</div>
                      <div><strong>{u.name}</strong><div className="subtle">{u.email}{u.cro ? ` · ${u.cro}` : ''}</div></div>
                    </div>
                  </td>
                  <td style={{ width: 180 }}>
                    <Select value={u.role} disabled={readOnly || u.userId === me?.user.id} onChange={(e) => change(u, { role: e.target.value, permissions: null })}
                      options={Object.entries(ROLE_LABEL)} />
                  </td>
                  <td>{u.mfaEnabled ? <span className="tag success">Ativo</span> : <span className="tag">—</span>}</td>
                  <td>
                    <button className={`btn btn-sm ${u.active ? '' : 'btn-primary'}`} disabled={readOnly || u.userId === me?.user.id}
                      onClick={() => change(u, { active: !u.active })}>{u.active ? 'Desativar' : 'Reativar'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Permissões por usuário" bodyClass="">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Permissão</th>{users.filter((u) => u.role !== 'owner').map((u) => <th key={u.membershipId}>{u.name.split(' ').slice(0, 2).join(' ')}<br /><span className="subtle">{ROLE_LABEL[u.role]}</span></th>)}</tr>
              </thead>
              <tbody>
                {perms.map((p) => (
                  <tr key={p}>
                    <td>{PERM_LABEL[p] ?? p}</td>
                    {users.filter((u) => u.role !== 'owner').map((u) => {
                      const isDefault = catalog!.roleDefaults[u.role].includes(p);
                      const on = u.effectivePermissions.includes(p);
                      return (
                        <td key={u.membershipId}>
                          <input type="checkbox" style={{ accentColor: 'var(--brand-primary)', width: 16, height: 16 }} checked={on} disabled={readOnly}
                            onChange={(e) => togglePerm(u, p, e.target.checked)} title={isDefault ? 'Padrão do papel' : 'Concessão extra'} />
                          {on && !isDefault && <span className="tag warning" style={{ marginLeft: 6 }}>extra</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="subtle" style={{ padding: '10px 16px' }}>Donos têm todas as permissões. Gerenciar usuários, configurar consultório, auditoria e suporte são exclusivos do dono.</p>
        </Card>

        {!readOnly && (
          <Card title="Adicionar usuário">
            <form className="form-grid" onSubmit={create}>
              <Field className="col-4" label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
              <Field className="col-4" label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
              <Field className="col-4" label="Papel"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={Object.entries(ROLE_LABEL)} /></Field>
              <Field className="col-4" label={form.role === 'dentist' ? 'CRO *' : 'CRO'}><Input value={form.cro} onChange={(e) => setForm({ ...form, cro: e.target.value })} required={form.role === 'dentist'} /></Field>
              <Field className="col-4" label="Senha inicial" hint="Mín. 10 caracteres, letras e números"><Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
              <div className="col-4" style={{ display: 'flex', alignItems: 'flex-end' }}><button className="btn btn-primary">Adicionar</button></div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
