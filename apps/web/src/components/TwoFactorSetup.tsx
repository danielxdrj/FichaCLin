import { useEffect, useRef, useState, type FormEvent } from 'react';
import { post } from '../lib/api';
import { ErrorAlert, Field, Input } from './ui';

/**
 * Cadastro do autenticador por QR code + confirmação com o primeiro código.
 * Usado no login (quando exigido) e em Configurações · Segurança.
 */
export function TwoFactorSetup({ onDone, setupNeeded }: { onDone: () => void; setupNeeded: boolean }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Uma única chamada de setup (o StrictMode executa efeitos duas vezes em desenvolvimento).
  const requested = useRef(false);
  useEffect(() => {
    if (setupNeeded && !requested.current) {
      requested.current = true;
      post('/auth/2fa/setup').then(setSetup).catch(setError);
    }
  }, [setupNeeded]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await post('/auth/2fa/verify', { code, rememberDevice: remember });
      onDone();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="stack">
      {setupNeeded && setup && (
        <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
          <p className="muted" style={{ textAlign: 'center' }}>
            Abra o app autenticador (Google Authenticator, Microsoft Authenticator, Authy…) e leia o QR code.
          </p>
          <img src={setup.qr} alt="QR code para cadastrar o Fichaclin no app autenticador" width={200} height={200}
            style={{ borderRadius: 8, background: '#fff', padding: 6 }} />
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowKey(!showKey)}>
            {showKey ? 'Ocultar chave' : 'Não consegue ler? Digite a chave'}
          </button>
          {showKey && <span className="mono">{setup.secret}</span>}
        </div>
      )}
      <form className="stack" onSubmit={submit}>
        <Field label={setupNeeded ? 'Código de 6 dígitos exibido no app' : 'Código do autenticador'}>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
        </Field>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Não solicitar o código neste dispositivo novamente</span>
        </label>
        <ErrorAlert error={error} />
        <button className="btn btn-primary" disabled={code.length !== 6}>{setupNeeded ? 'Ativar 2FA' : 'Confirmar'}</button>
      </form>
    </div>
  );
}
