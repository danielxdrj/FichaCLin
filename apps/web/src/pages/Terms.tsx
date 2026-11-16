import { useEffect, useState } from 'react';
import { api, post } from '../lib/api';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';
import { ErrorAlert } from '../components/ui';

interface Doc { id: string; kind: string; version: number; title: string; body: string; publishedAt: string }

/** REQ-03: aceite dos Termos e da Política na 1ª entrada e a cada nova versão. */
export function TermsPage() {
  const { refresh } = useSession();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ documents: Doc[] }>('/legal/pending').then((r) => setDocs(r.documents)).catch(setError);
  }, []);

  const all = docs.length > 0 && docs.every((d) => checked[d.id]);

  async function accept() {
    try {
      await post('/legal/accept', { documentIds: docs.map((d) => d.id) });
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="picker">
      <div className="card" style={{ maxWidth: 720 }}>
        <div className="card-head"><h2>Antes de continuar</h2></div>
        <div className="card-body stack">
          <p className="muted">
            Leia e aceite a versão vigente dos documentos abaixo. Registramos data, hora, IP e versão do aceite.
          </p>
          {docs.map((d) => (
            <div key={d.id} className="stack" style={{ gap: 8 }}>
              <div className="row">
                <h3>{d.title}</h3>
                <span className="subtle">Versão {d.version} · {formatDate(d.publishedAt)}</span>
              </div>
              <div className="card card-body" style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {d.body.replace(/\*\*/g, '')}
              </div>
              <label className="check">
                <input type="checkbox" checked={!!checked[d.id]} onChange={(e) => setChecked({ ...checked, [d.id]: e.target.checked })} />
                <span>Li e aceito {d.kind === 'terms' ? 'os Termos de Uso' : 'a Política de Privacidade'} (versão {d.version}).</span>
              </label>
            </div>
          ))}
          <ErrorAlert error={error} />
          <div className="row">
            <span className="spacer" />
            <button className="btn btn-primary" disabled={!all} onClick={accept}>Aceitar e continuar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
