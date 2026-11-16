import { useEffect, useRef, useState, type FormEvent } from 'react';
import { post } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorAlert, Field, Input } from '../components/ui';
import { AuthFrame } from './Login';

/** REQ-24: 2FA obrigatório para dono e dentista. Na primeira entrada, cadastra o autenticador. */
export function MfaPage() {
  const { me, refresh } = useSession();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const needsSetup = !me?.mfa.enabled;

  // Uma única chamada de setup (o StrictMode executa efeitos duas vezes em desenvolvimento,
  // e cada chamada gera um segredo novo).
  const requested = useRef(false);
  useEffect(() => {
    if (needsSetup && !requested.current) {
      requested.current = true;
      post('/auth/2fa/setup').then(setSetup).catch(setError);
    }
  }, [needsSetup]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await post('/auth/2fa/verify', { code });
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function cancel() {
    await post('/auth/logout');
    await refresh();
  }

  return (
    <AuthFrame>
      <div>
        <h1>Verificação em duas etapas</h1>
        <p className="muted">
          {needsSetup
            ? 'Seu papel exige 2FA. Cadastre o Fichaclin no seu aplicativo autenticador.'
            : 'Digite o código de 6 dígitos do seu aplicativo autenticador.'}
        </p>
      </div>
      {needsSetup && setup && (
        <div className="card card-body stack" style={{ gap: 8 }}>
          <span className="subtle">Chave para cadastro manual no autenticador</span>
          <span className="mono">{setup.secret}</span>
          <a className="subtle" href={setup.uri}>Abrir no aplicativo autenticador</a>
        </div>
      )}
      <form className="stack" onSubmit={submit}>
        <Field label="Código">
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
        </Field>
        <ErrorAlert error={error} />
        <button className="btn btn-primary" disabled={code.length !== 6}>Confirmar</button>
        <button type="button" className="btn btn-ghost" onClick={cancel}>Voltar</button>
      </form>
    </AuthFrame>
  );
}
