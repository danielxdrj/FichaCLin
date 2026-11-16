import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { Card, ErrorAlert, Input, Select } from '../components/ui';

interface Question { id: string; text: string; type: 'yesno' | 'text'; alert: boolean; section: string }

function slug(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'pergunta';
}

/** 10 — Editor de modelo de anamnese. Salvar publica uma nova versão (REQ-21). */
export function TemplateEditorPage() {
  const { me } = useSession();
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const readOnly = me?.current?.billingStatus === 'suspended';

  const load = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([api('/anamnesis/template'), api('/anamnesis/templates')]);
      setTitle(t.template?.title ?? 'Anamnese');
      setQuestions(t.template?.questions ?? []);
      setVersion(t.template?.version ?? null);
      setHistory(h.templates);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = (i: number, patch: Partial<Question>) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: number) => {
    const next = [...questions];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setQuestions(next);
  };

  function add() {
    const base = 'nova_pergunta';
    let id = base;
    for (let n = 2; questions.some((q) => q.id === id); n++) id = `${base}_${n}`;
    setQuestions([...questions, { id, text: '', type: 'yesno', alert: false, section: questions.at(-1)?.section ?? 'Geral' }]);
  }

  async function publish() {
    setError(null);
    setMsg(null);
    // Perguntas novas ganham ID a partir do texto; as existentes mantêm o ID (respostas antigas continuam ligadas).
    const used = new Set<string>();
    const qs = questions.map((q) => {
      let id = q.id.startsWith('nova_pergunta') ? slug(q.text) : q.id;
      while (used.has(id)) id = `${id}_2`;
      used.add(id);
      return { ...q, id };
    });
    try {
      const r = await post('/anamnesis/template', { title, questions: qs });
      setMsg(`Versão ${r.version} publicada. Anamneses já registradas continuam com a versão em que foram respondidas.`);
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h2>Modelo de anamnese</h2>
          <p>{version ? `Versão vigente: v${version}. Publicar cria uma nova versão; as anamneses já registradas não mudam.` : 'Nenhum modelo publicado'}</p>
        </div>
        {!readOnly && <button className="btn btn-primary" onClick={publish}>Publicar nova versão</button>}
      </div>
      {msg && <div className="alert success" style={{ marginBottom: 16 }}>{msg}</div>}
      <ErrorAlert error={error} />
      <div className="grid-2">
        <Card title={<Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título do modelo" />}>
          <div className="stack" style={{ gap: 8 }}>
            {questions.map((q, i) => (
              <div key={i} className="card card-body" style={{ padding: 12 }}>
                <div className="row wrap">
                  <span className="subtle" style={{ width: 22 }}>{i + 1}.</span>
                  <div style={{ flex: 1, minWidth: 240 }}><Input value={q.text} placeholder="Texto da pergunta" onChange={(e) => update(i, { text: e.target.value })} /></div>
                  <div style={{ width: 130 }}><Select value={q.type} onChange={(e) => update(i, { type: e.target.value as 'yesno' })} options={[['yesno', 'Sim / Não'], ['text', 'Texto livre']]} /></div>
                </div>
                <div className="row wrap" style={{ marginTop: 8, paddingLeft: 34 }}>
                  <div style={{ width: 200 }}><Input value={q.section} placeholder="Seção" onChange={(e) => update(i, { section: e.target.value })} /></div>
                  <label className="row subtle"><input type="checkbox" checked={q.alert} onChange={(e) => update(i, { alert: e.target.checked })} /> "Sim" gera alerta clínico</label>
                  <span className="spacer" />
                  <button className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">↑</button>
                  <button className="btn btn-sm btn-ghost" disabled={i === questions.length - 1} onClick={() => move(i, 1)} aria-label="Descer">↓</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>Remover</button>
                </div>
              </div>
            ))}
            {!readOnly && <button className="btn" onClick={add}>+ Adicionar pergunta</button>}
          </div>
        </Card>
        <div className="stack">
          <Card title="Versões" bodyClass="">
            <table className="table">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td><strong>v{h.version}</strong></td>
                    <td>{h.questionCount} perguntas</td>
                    <td className="subtle">{h.createdBy ?? '—'} · {formatDateTime(h.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}
