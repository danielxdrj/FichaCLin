import { useState } from 'react';
import { post } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { ErrorAlert } from '../components/ui';

/** 09 — Seletor de consultório. Só aparecem consultórios com vínculo ativo (REQ-26). */
export function ClinicPickerPage() {
  const { me, refresh } = useSession();
  const [error, setError] = useState<unknown>(null);

  async function choose(clinicId: string) {
    try {
      await post('/auth/select-clinic', { clinicId });
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function logout() {
    await post('/auth/logout');
    await refresh();
  }

  return (
    <div className="picker">
      <div className="card">
        <div className="card-head">
          <div className="row"><div className="brand-mark">F</div><h2>Selecionar consultório</h2></div>
          <button className="btn btn-sm btn-ghost" onClick={logout}>Sair</button>
        </div>
        <div className="card-body stack">
          <p className="muted">Olá, {me?.user.name}. Escolha onde vai trabalhar agora.</p>
          {me?.clinics.length === 0 && <div className="alert warning">Você ainda não tem vínculo com nenhum consultório.</div>}
          {me?.clinics.map((c) => (
            <button key={c.id} className="clinic-option" onClick={() => choose(c.id)}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 500 }}>{c.name}</span>
                <div className="subtle">{ROLE_LABEL[c.role]}{c.city ? ` · ${c.city}` : ''}</div>
              </div>
              {c.billingStatus === 'suspended' && <span className="status bad">Suspenso</span>}
              {c.billingStatus === 'trial' && <span className="subtle">Período de teste</span>}
            </button>
          ))}
          <ErrorAlert error={error} />
          <p className="subtle">Os dados de cada consultório ficam isolados: nada de um aparece no outro.</p>
        </div>
      </div>
    </div>
  );
}
