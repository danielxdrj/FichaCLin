import { post } from '../lib/api';
import { useSession } from '../lib/session';
import { TwoFactorSetup } from '../components/TwoFactorSetup';
import { AuthFrame } from './Login';

/**
 * Passo do 2FA no login. Só aparece quando o usuário ativou o 2FA (e o dispositivo não está
 * lembrado) ou quando um consultório dele exige 2FA — aí, se ainda não cadastrou, cadastra aqui.
 */
export function MfaPage() {
  const { me, refresh } = useSession();
  const needsSetup = !me?.mfa.enabled;

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
            ? 'Seu consultório exige verificação em duas etapas. Cadastre o Fichaclin no seu app autenticador.'
            : 'Digite o código de 6 dígitos do seu app autenticador.'}
        </p>
      </div>
      <TwoFactorSetup setupNeeded={needsSetup} onDone={refresh} />
      <button type="button" className="btn btn-ghost" onClick={cancel}>Voltar ao login</button>
    </AuthFrame>
  );
}
