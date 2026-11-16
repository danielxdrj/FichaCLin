import { useState } from 'react';
import { ApiError } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmDialog, ErrorAlert } from './ui';

export type ExportScope = 'all' | 'active' | 'inactive';
const SCOPE_LABEL: Record<ExportScope, string> = { all: 'todos os pacientes', active: 'os pacientes ativos', inactive: 'os pacientes inativos' };

/** Baixa o ZIP gerado pela API (o navegador recebe o arquivo; nada fica guardado no front). */
async function downloadZip(scope: ExportScope) {
  const res = await fetch(`/api/patients/export-all?status=${scope}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? 'Não foi possível gerar a exportação');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'fichaclin-exportacao.zip';
  const count = Number(res.headers.get('x-fichaclin-count') ?? 0);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return count;
}

/**
 * Exportação em lote (REQ-06 / REQ-35): ZIP com índice (CSV), prontuário em JSON e versão imprimível (HTML)
 * de cada paciente. Pede confirmação porque o arquivo contém dados sensíveis de saúde.
 */
export function ExportAllButton({ scope, label, primary, onDone }: { scope: ExportScope; label?: string; primary?: boolean; onDone?: (count: number) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      onDone?.(await downloadZip(scope));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={`btn ${primary ? 'btn-primary' : ''}`} disabled={busy} onClick={() => setConfirming(true)}>
        <Icon name="download" size={16} /> {busy ? 'Gerando arquivo…' : label ?? 'Exportar'}
      </button>
      {error ? <div style={{ marginTop: 8 }}><ErrorAlert error={error} /></div> : null}
      {confirming && (
        <ConfirmDialog
          title="Exportar prontuários"
          confirmLabel="Gerar e baixar"
          onCancel={() => setConfirming(false)}
          onConfirm={run}
          message={
            `Será gerado um arquivo .zip com ${SCOPE_LABEL[scope]}: índice em planilha, prontuário completo em dados ` +
            'estruturados (JSON) e versão para impressão/PDF de cada paciente. O arquivo contém dados sensíveis de saúde: ' +
            'guarde em local seguro. A exportação fica registrada na auditoria.'
          }
        />
      )}
    </>
  );
}
