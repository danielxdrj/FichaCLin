import { useEffect, useState, type FormEvent } from 'react';
import { api, post } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorAlert, Field, Input } from '../components/ui';

/** Cadastro do cliente: conta do dono + consultório com 7 dias grátis. */
export function SignupForm({ onBack }: { onBack: () => void }) {
  const { refresh } = useSession();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', clinicName: '', cro: '' });
  const [accept, setAccept] = useState(false);
  const [doc, setDoc] = useState<{ title: string; body: string } | null>(null);
  const [docs, setDocs] = useState<Record<string, { title: string; body: string; version: number }>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api('/legal/terms'), api('/legal/privacy')])
      .then(([terms, privacy]) => setDocs({ terms, privacy }))
      .catch(() => {});
  }, []);

  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError(new Error('As senhas não conferem.'));
    setBusy(true);
    try {
      await post('/auth/signup', {
        name: form.name, email: form.email, password: form.password, clinicName: form.clinicName,
        cro: form.cro || null, acceptTerms: accept,
      });
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <h1>Criar conta</h1>
        <p className="muted">7 dias grátis, sem cartão. Você será o dono do consultório.</p>
      </div>
      <form className="stack" onSubmit={submit}>
        <Field label="Seu nome completo"><Input value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" required /></Field>
        <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="username" required /></Field>
        <Field label="Nome do consultório"><Input value={form.clinicName} onChange={(e) => set('clinicName', e.target.value)} required /></Field>
        <Field label="CRO" hint="Opcional agora; necessário para assinar registros clínicos com seu número de CRO.">
          <Input value={form.cro} onChange={(e) => set('cro', e.target.value)} placeholder="CRO-UF 00000" />
        </Field>
        <Field label="Senha" hint="Mínimo 10 caracteres, com letras e números.">
          <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" required />
        </Field>
        <Field label="Repita a senha">
          <Input type="password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} autoComplete="new-password" required />
        </Field>
        <label className="check">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            Tenho 18 anos ou mais e aceito os{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setDoc(docs.terms ?? null); }}>Termos de Uso</a> e a{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setDoc(docs.privacy ?? null); }}>Política de Privacidade</a>.
          </span>
        </label>
        {doc && (
          <div className="card card-body" style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 }}>
            <strong>{doc.title}</strong>{'\n\n'}{doc.body.replace(/\*\*/g, '')}
          </div>
        )}
        <ErrorAlert error={error} />
        <button className="btn btn-primary" disabled={busy || !accept}>{busy ? 'Criando…' : 'Criar conta e começar'}</button>
        <button type="button" className="btn btn-ghost" onClick={onBack}>Já tenho conta</button>
      </form>
    </>
  );
}
