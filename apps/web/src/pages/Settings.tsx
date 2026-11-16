import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { api, post, put } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { Card, ErrorAlert, Field, Input, PageHead, Select, Toggle } from '../components/ui';
import { TwoFactorSetup } from '../components/TwoFactorSetup';

const TABS: [string, string][] = [
  ['consultorio', 'Consultório'], ['seguranca', 'Segurança'], ['aparencia', 'Aparência'], ['suporte', 'Suporte'], ['plano', 'Plano'],
];

export function SettingsPage() {
  const { tab = 'consultorio' } = useParams();
  return (
    <>
      <PageHead title="Configurações" />
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <NavLink key={k} to={`/configuracoes/${k}`} className={() => `tab ${tab === k ? 'active' : ''}`}>{label}</NavLink>
        ))}
      </nav>
      {tab === 'consultorio' && <ClinicTab />}
      {tab === 'seguranca' && <SecurityTab />}
      {tab === 'aparencia' && <AppearanceTab />}
      {tab === 'suporte' && <SupportTab />}
      {tab === 'plano' && <PlanTab />}
    </>
  );
}

/** 07 — Dados do controlador (REQ-31) e aceite do DPA (REQ-02). */
function ClinicTab() {
  const { can, me } = useSession();
  const editable = can('clinic:manage') && me?.current?.billingStatus !== 'suspended';
  const [c, setC] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dpaText, setDpaText] = useState<string | null>(null);

  const load = useCallback(() => { api('/clinic').then(setC).catch(setError); }, []);
  useEffect(load, [load]);

  if (!c) return <ErrorAlert error={error} />;
  const set = (k: string, v: unknown) => setC({ ...c, [k]: v });
  const setAddr = (k: string, v: string) => setC({ ...c, address: { ...c.address, [k]: v } });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await put('/clinic', c);
      setMsg('Dados salvos.');
    } catch (err) {
      setError(err);
    }
  }

  async function acceptDpa() {
    try {
      await post('/clinic/dpa/accept', { documentId: c.dpa.id });
      load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="grid-2" onSubmit={save}>
      <div className="stack">
        <Card title="Dados do consultório (controlador dos dados dos pacientes)">
          <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="form-grid">
              <Field className="col-6" label="Nome fantasia *"><Input value={c.name ?? ''} onChange={(e) => set('name', e.target.value)} required /></Field>
              <Field className="col-6" label="Razão social"><Input value={c.legalName ?? ''} onChange={(e) => set('legalName', e.target.value)} /></Field>
              <Field className="col-4" label="CNPJ"><Input value={c.cnpj ?? ''} onChange={(e) => set('cnpj', e.target.value)} /></Field>
              <Field className="col-4" label="Telefone"><Input value={c.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
              <Field className="col-4" label="E-mail"><Input value={c.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
              <Field className="col-8" label="Responsável técnico"><Input value={c.techLeadName ?? ''} onChange={(e) => set('techLeadName', e.target.value)} /></Field>
              <Field className="col-4" label="CRO do responsável"><Input value={c.techLeadCro ?? ''} onChange={(e) => set('techLeadCro', e.target.value)} /></Field>
              <Field className="col-3" label="CEP"><Input value={c.address?.cep ?? ''} onChange={(e) => setAddr('cep', e.target.value)} /></Field>
              <Field className="col-6" label="Endereço"><Input value={c.address?.street ?? ''} onChange={(e) => setAddr('street', e.target.value)} /></Field>
              <Field className="col-3" label="Número"><Input value={c.address?.number ?? ''} onChange={(e) => setAddr('number', e.target.value)} /></Field>
              <Field className="col-8" label="Cidade"><Input value={c.address?.city ?? ''} onChange={(e) => setAddr('city', e.target.value)} /></Field>
              <Field className="col-4" label="UF"><Input value={c.address?.state ?? ''} maxLength={2} onChange={(e) => setAddr('state', e.target.value.toUpperCase())} /></Field>
              <Field className="col-12" label="Base legal para lembretes de consulta"
                hint="Decisão do consultório (controlador). O Fichaclin apenas registra a escolha.">
                <Select value={c.reminderLegalBasis ?? ''} onChange={(e) => set('reminderLegalBasis', e.target.value || null)}
                  options={[['', 'Não definido'], ['tutela_saude', 'Tutela da saúde (parte do atendimento)'], ['consentimento', 'Consentimento do paciente']]} />
              </Field>
            </div>
          </fieldset>
          {editable && (
            <div className="row" style={{ marginTop: 16 }}>
              {msg && <span className="tag success">{msg}</span>}
              <span className="spacer" />
              <button className="btn btn-primary">Salvar alterações</button>
            </div>
          )}
        </Card>
        <ErrorAlert error={error} />
      </div>
      <div className="stack">
        <Card title="Acordo de Tratamento de Dados (DPA)">
          {!c.dpa ? <p className="muted">Nenhum DPA publicado.</p> : (
            <div className="stack">
              <div className="row">
                <span className="tag">v{c.dpa.version}</span>
                {c.dpa.acceptedAt
                  ? <span className="tag success">Aceito por {c.dpa.acceptedBy} em {formatDate(c.dpa.acceptedAt)}</span>
                  : <span className="tag warning">Pendente</span>}
              </div>
              <p className="subtle">Define o Fichaclin como operador e o consultório como controlador dos dados dos pacientes.</p>
              <button type="button" className="btn btn-sm" onClick={async () => setDpaText(dpaText ? null : (await api('/legal/dpa')).body)}>
                {dpaText ? 'Ocultar texto' : 'Ler o DPA'}
              </button>
              {dpaText && <div className="card card-body" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{dpaText.replace(/\*\*/g, '')}</div>}
              {!c.dpa.acceptedAt && can('clinic:manage') && (
                <button type="button" className="btn btn-primary" onClick={acceptDpa}>Aceitar DPA em nome do consultório</button>
              )}
            </div>
          )}
        </Card>
      </div>
    </form>
  );
}

/**
 * Segurança: 2FA opcional por usuário (cadastro por QR code) e opção do dono de exigir 2FA
 * de toda a equipe. Divergência documentada em relação ao PDF (REQ-24).
 */
function SecurityTab() {
  const { me, can, refresh } = useSession();
  const [enabling, setEnabling] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [requireMfa, setRequireMfa] = useState<boolean | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (can('clinic:manage')) api('/clinic').then((c) => setRequireMfa(c.requireMfa)).catch(setError);
  }, [can]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  const enabled = Boolean(me?.mfa.enabled);

  return (
    <div className="grid-2">
      <div className="stack">
        <Card title={<>Verificação em duas etapas (2FA) {enabled ? <span className="tag success">Ativada</span> : <span className="tag warning">Desativada</span>}</>}>
          {!enabled && !enabling && (
            <div className="stack">
              <p className="muted">
                Além da senha, o login passa a pedir um código do seu celular. Recomendado para quem acessa prontuários.
              </p>
              <div><button className="btn btn-primary" onClick={() => setEnabling(true)}>Ativar 2FA</button></div>
            </div>
          )}
          {!enabled && enabling && (
            <TwoFactorSetup setupNeeded onDone={() => { setEnabling(false); setMsg('2FA ativado.'); refresh(); }} />
          )}
          {enabled && (
            <div className="stack">
              <p className="muted">
                O código é pedido no login, exceto nos dispositivos em que você marcou "não solicitar novamente"
                ({me?.mfa.trustedDevices ?? 0} lembrado{me?.mfa.trustedDevices === 1 ? '' : 's'}).
              </p>
              <div>
                <button className="btn" disabled={!me?.mfa.trustedDevices}
                  onClick={() => run(() => post('/auth/trusted-devices/revoke'), 'Dispositivos esquecidos. O código será pedido no próximo login.')}>
                  Esquecer todos os dispositivos
                </button>
              </div>
              <div className="row wrap" style={{ alignItems: 'flex-end' }}>
                <Field label="Para desativar, informe um código atual">
                  <Input inputMode="numeric" maxLength={6} value={disableCode} onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))} />
                </Field>
                <button className="btn btn-danger" disabled={disableCode.length !== 6}
                  onClick={() => run(async () => { await post('/auth/2fa/disable', { code: disableCode }); setDisableCode(''); }, '2FA desativado.')}>
                  Desativar 2FA
                </button>
              </div>
            </div>
          )}
          {msg && <div className="alert success" style={{ marginTop: 12 }}>{msg}</div>}
          <div style={{ marginTop: 12 }}><ErrorAlert error={error} /></div>
        </Card>
      </div>
      <div className="stack">
        {can('clinic:manage') && requireMfa !== null && (
          <Card title="Política do consultório">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <strong>Exigir 2FA de todos os usuários</strong>
                <p className="subtle">Quem ainda não ativou será obrigado a cadastrar o autenticador no próximo login.</p>
              </div>
              <Toggle label="Exigir 2FA" checked={requireMfa}
                onChange={(v) => run(async () => { await put('/clinic/security', { requireMfa: v }); setRequireMfa(v); },
                  v ? 'O consultório agora exige 2FA.' : '2FA deixou de ser obrigatório no consultório.')} />
            </div>
          </Card>
        )}
        <div className="alert warning">
          Registros clínicos assinados sem 2FA ficam marcados como "assinatura simples". Com 2FA, como "simples + 2FA".
        </div>
      </div>
    </div>
  );
}

/** 11 — Aparência (claro/escuro). Preferência local do navegador. */
function AppearanceTab() {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const choose = (p: ThemePref) => { setPref(p); setThemePref(p); };
  return (
    <Card title="Tema">
      <div className="row wrap">
        {([['light', 'Claro'], ['dark', 'Escuro'], ['system', 'Igual ao sistema']] as [ThemePref, string][]).map(([k, label]) => (
          <button key={k} className={`btn ${pref === k ? 'btn-primary' : ''}`} onClick={() => choose(k)}>{label}</button>
        ))}
      </div>
      <p className="subtle" style={{ marginTop: 12 }}>A preferência fica salva só neste navegador.</p>
    </Card>
  );
}

/** 12 — Suporte: canal do encarregado (REQ-10) e autorização de acesso (REQ-30). */
function SupportTab() {
  const { can } = useSession();
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState({ reason: '', hours: 4 });
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => { api('/support').then(setData).catch(setError); }, []);
  useEffect(load, [load]);

  async function grant(e: FormEvent) {
    e.preventDefault();
    try {
      await post('/support/grants', form);
      setForm({ reason: '', hours: 4 });
      load();
    } catch (err) {
      setError(err);
    }
  }

  if (!data) return <ErrorAlert error={error} />;
  return (
    <div className="grid-2">
      <div className="stack">
        {can('support:manage') && (
          <Card title="Autorizar acesso do suporte">
            <form className="stack" onSubmit={grant}>
              <p className="subtle">
                A equipe do Fichaclin só acessa o ambiente do consultório com autorização sua, por prazo limitado.
                Toda autorização fica registrada na auditoria.
              </p>
              <Field label="Motivo"><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ex.: erro ao exportar prontuário" required /></Field>
              <Field label="Validade">
                <Select value={String(form.hours)} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })}
                  options={[['1', '1 hora'], ['4', '4 horas'], ['24', '24 horas'], ['72', '72 horas']]} />
              </Field>
              <ErrorAlert error={error} />
              <div className="row"><span className="spacer" /><button className="btn btn-primary" disabled={form.reason.trim().length < 5}>Autorizar</button></div>
            </form>
          </Card>
        )}
        {can('support:manage') && (
          <Card title="Autorizações" bodyClass="">
            {data.grants.length === 0 ? <div className="empty">Nenhuma autorização.</div> : (
              <table className="table">
                <thead><tr><th>Motivo</th><th>Por</th><th>Validade</th><th /></tr></thead>
                <tbody>
                  {data.grants.map((g: any) => (
                    <tr key={g.id}>
                      <td>{g.reason}</td>
                      <td>{g.grantedBy}</td>
                      <td>{g.active ? <span className="tag success">até {formatDateTime(g.expiresAt)}</span> : <span className="tag">{g.revokedAt ? 'Revogada' : 'Expirada'}</span>}</td>
                      <td>{g.active && <button className="btn btn-sm" onClick={async () => { await post(`/support/grants/${g.id}/revoke`); load(); }}>Revogar</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </div>
      <div className="stack">
        <Card title="Encarregado de dados (DPO)">
          <dl className="kv">
            <dt>Nome</dt><dd>{data.dpo.name}</dd>
            <dt>E-mail</dt><dd><a href={`mailto:${data.dpo.email}`}>{data.dpo.email}</a></dd>
          </dl>
          <p className="subtle" style={{ marginTop: 12 }}>
            Pacientes que queiram exercer direitos da LGPD devem procurar o consultório, que é o controlador dos dados.
          </p>
        </Card>
      </div>
    </div>
  );
}

/** 13 — Plano. Inadimplência suspende a escrita, mas permite exportar (REQ-32). */
function PlanTab() {
  const [c, setC] = useState<any>(null);
  useEffect(() => { api('/clinic').then(setC); }, []);
  if (!c) return null;
  const status: Record<string, [string, string]> = {
    trial: ['info', 'Período de teste'], active: ['success', 'Ativo'], suspended: ['danger', 'Suspenso por inadimplência'],
  };
  const [tone, label] = status[c.billingStatus];
  const days = c.trialEndsAt ? Math.max(0, Math.ceil((new Date(c.trialEndsAt).getTime() - Date.now()) / 86400000)) : null;
  return (
    <div className="grid-2">
      <Card title="Assinatura">
        <div className="stack">
          <div className="row"><span className={`tag ${tone}`}>{label}</span><span className="tag">Plano {c.plan}</span></div>
          {c.billingStatus === 'trial' && days !== null && <p>Faltam <strong>{days} dias</strong> de teste gratuito.</p>}
          {c.billingStatus === 'suspended' && (
            <div className="alert danger">
              O consultório está em modo somente leitura. Nenhum prontuário foi apagado. Você pode exportar cada prontuário
              (PDF e dados estruturados) a partir da ficha do paciente.
            </div>
          )}
          <p className="subtle">Pagamento e troca de plano: em breve. Por enquanto, fale com o suporte.</p>
        </div>
      </Card>
      <Card title="Seus dados">
        <p className="subtle" style={{ marginBottom: 12 }}>
          Os dados são do consultório. A exportação completa do prontuário está sempre disponível, inclusive com o
          consultório suspenso.
        </p>
        <Link className="btn" to="/pacientes">Ir para pacientes e exportar</Link>
      </Card>
    </div>
  );
}
