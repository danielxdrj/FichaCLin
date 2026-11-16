import { useState, type FormEvent, type ReactNode } from 'react';
import { post } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorAlert, Field, Input } from '../components/ui';
import { SignupForm } from './Signup';

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-brand">
        <div className="row" style={{ fontWeight: 650 }}>
          <div className="brand-mark">F</div> Fichaclin
        </div>
        <h1>Fichas clínicas do consultório.</h1>
        <p className="subtle" style={{ color: 'var(--sidebar-text)' }}>
          Prontuário odontológico com trilha de auditoria e guarda mínima de 20 anos.
        </p>
      </div>
      <div className="auth-panel">
        <div className="auth-card stack">{children}</div>
      </div>
    </div>
  );
}

/** 01 — Login. Bloqueio após tentativas inválidas é feito pela API (REQ-25). */
export function LoginPage() {
  const { refresh } = useSession();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { email, password });
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'signup') {
    return (
      <AuthFrame>
        <SignupForm onBack={() => setMode('login')} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <div>
        <h1>Entrar</h1>
        <p className="muted">Acesse com seu e-mail profissional.</p>
      </div>
      <form className="stack" onSubmit={submit}>
        <Field label="E-mail">
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Senha">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorAlert error={error} />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <div className="card card-body row" style={{ justifyContent: 'space-between' }}>
        <span>Ainda não tem conta?</span>
        <button className="btn btn-sm" onClick={() => setMode('signup')}>Criar conta · 7 dias grátis</button>
      </div>
      <p className="subtle">
        Uso restrito a profissionais e colaboradores de consultórios contratantes, maiores de 18 anos.
      </p>
    </AuthFrame>
  );
}
