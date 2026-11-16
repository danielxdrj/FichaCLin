import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { api, post, put } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { Card, ErrorAlert, Field, Input, Loading, PageHead, Section, Select, Status, Toggle } from '../components/ui';
import { TwoFactorSetup } from '../components/TwoFactorSetup';
import { ExportAllButton } from '../components/ExportAll';
import { UsersPage } from './Users';
import { TemplateEditorPage } from './TemplateEditor';

/**
 * Configurações = administração do sistema. Módulos operacionais (Pacientes, Agenda, Suporte, Auditoria)
 * ficam no menu principal; aqui só o que é configuração. Abas aparecem conforme a permissão,
 * e cada rota da API valida a permissão de novo (o front não é barreira de segurança).
 */
const TABS: { key: string; label: string; perm?: string }[] = [
  { key: 'consultorio', label: 'Consultório' },
  { key: 'usuarios', label: 'Usuários e papéis', perm: 'users:manage' },
  { key: 'anamnese', label: 'Modelo de anamnese', perm: 'anamnesis:template' },
  { key: 'seguranca', label: 'Segurança' },
  { key: 'aparencia', label: 'Aparência' },
  { key: 'plano', label: 'Plano' },
];

export function SettingsPage() {
  const { tab = 'consultorio' } = useParams();
  const { can } = useSession();
  const tabs = TABS.filter((t) => !t.perm || can(t.perm));
  const current = tabs.find((t) => t.key === tab) ? tab : 'consultorio';
  return (
    <>
      <PageHead title="Configurações" subtitle="Administração do consultório e da sua conta." />
      <nav className="tabs" aria-label="Seções de configurações">
        {tabs.map((t) => (
          <NavLink key={t.key} to={`/configuracoes/${t.key}`} className={() => `tab ${current === t.key ? 'active' : ''}`}
            aria-current={current === t.key ? 'page' : undefined}>{t.label}</NavLink>
        ))}
      </nav>
      {current === 'consultorio' && <ClinicTab />}
      {current === 'usuarios' && <UsersPage />}
      {current === 'anamnese' && <TemplateEditorPage />}
      {current === 'seguranca' && <SecurityTab />}
      {current === 'aparencia' && <AppearanceTab />}
      {current === 'plano' && <PlanTab />}
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
              {msg && <Status tone="ok">{msg}</Status>}
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
              <div className="row wrap">
                {c.dpa.acceptedAt
                  ? <Status tone="ok">Aceito por {c.dpa.acceptedBy} em {formatDate(c.dpa.acceptedAt)}</Status>
                  : <Status tone="warn">Pendente de aceite</Status>}
                <span className="subtle">Versão {c.dpa.version}</span>
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
        <Card title={<>Verificação em duas etapas (2FA) {enabled ? <Status tone="ok">Ativada</Status> : <Status tone="warn">Desativada</Status>}</>}>
          {!enabled && !enabling && (
            <div className="stack">
              <p className="muted">
                Além da senha, o login passa a pedir um código do seu celular. Recomendado para quem acessa prontuários.
              </p>
              <div><button className="btn btn-primary" onClick={() => setEnabling(true)}>Ativar 2FA</button></div>
            </div>
          )}
          {!enabled && enabling && (
            <TwoFactorSetup setupNeeded onCancel={() => setEnabling(false)}
              onDone={() => { setEnabling(false); setMsg('2FA ativado.'); refresh(); }} />
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
                <p className="subtle">
                  Vale a partir do próximo login de cada pessoa; ninguém é desconectado agora. Quem ainda não ativou
                  cadastra o autenticador ao entrar.
                </p>
                {!enabled && !requireMfa && (
                  <p className="subtle" style={{ color: 'var(--warning)' }}>Ative o 2FA na sua conta antes de exigir da equipe.</p>
                )}
              </div>
              <Toggle label="Exigir 2FA" checked={requireMfa} disabled={!enabled && !requireMfa}
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

/** 13 — Plano. Inadimplência suspende a escrita, mas permite exportar (REQ-32). */
function PlanTab() {
  const { can } = useSession();
  const [c, setC] = useState<any>(null);
  const [exported, setExported] = useState<number | null>(null);
  useEffect(() => { api('/clinic').then(setC); }, []);
  if (!c) return <Loading />;
  const label: Record<string, [ 'ok' | 'info' | 'bad', string]> = {
    trial: ['info', 'Período de teste'], active: ['ok', 'Ativo'], suspended: ['bad', 'Suspenso por inadimplência'],
  };
  const [tone, text] = label[c.billingStatus];
  const days = c.trialEndsAt ? Math.max(0, Math.ceil((new Date(c.trialEndsAt).getTime() - Date.now()) / 86400000)) : null;
  return (
    <div className="stack" style={{ gap: 28 }}>
      <Section title="Assinatura">
        <div className="panel panel-pad">
          <dl className="kv">
            <dt>Situação</dt><dd><Status tone={tone}>{text}</Status></dd>
            <dt>Plano</dt><dd style={{ textTransform: 'capitalize' }}>{c.plan}</dd>
            {c.billingStatus === 'trial' && days !== null && (<><dt>Teste gratuito</dt><dd>{days === 0 ? 'Termina hoje' : `Faltam ${days} dias`}</dd></>)}
          </dl>
          {c.billingStatus === 'suspended' && (
            <p className="muted" style={{ marginTop: 12 }}>
              O consultório está em modo somente leitura. Nenhum prontuário foi apagado e a exportação continua disponível.
            </p>
          )}
        </div>
      </Section>

      <Section title={c.billingStatus === 'active' ? 'Seus dados' : 'Ao fim do período'}
        description="Os dados são do consultório. Você decide se continua no Fichaclin ou leva todos os prontuários com você.">
        <div className="form-grid">
          <div className="col-6 panel panel-pad stack" style={{ gap: 10 }}>
            <h3>Continuar com o Fichaclin</h3>
            <p className="muted">Mantenha o acesso completo, com os prontuários guardados e protegidos pelo Fichaclin.</p>
            <p className="subtle">O pagamento online ainda não está disponível. Para contratar ou regularizar, fale com o suporte.</p>
            <div><Link className="btn btn-primary" to="/suporte">Contratar pelo suporte</Link></div>
          </div>
          <div className="col-6 panel panel-pad stack" style={{ gap: 10 }}>
            <h3>Exportar todos os dados</h3>
            <p className="muted">
              Baixe um arquivo com os prontuários de todos os pacientes, ativos e inativos, em planilha, dados estruturados e
              versão para impressão.
            </p>
            <p className="subtle">O prontuário deve ser guardado por no mínimo 20 anos (Lei 13.787/2018), mesmo se você sair do sistema.</p>
            {can('export')
              ? <div><ExportAllButton scope="all" label="Exportar todos os pacientes" onDone={setExported} /></div>
              : <p className="subtle">Peça ao(à) proprietário(a) ou a um(a) dentista para exportar.</p>}
            {exported !== null && <Status tone="ok">{exported} prontuário(s) exportado(s)</Status>}
          </div>
        </div>
      </Section>
    </div>
  );
}
