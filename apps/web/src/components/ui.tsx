import {
  cloneElement, isValidElement, useEffect, useId, useRef, useState,
  type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';

/**
 * Campo com rótulo ligado ao controle (htmlFor/id), dica e erro anunciados por leitores de tela
 * (aria-describedby) e estado inválido (aria-invalid).
 */
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  const autoId = useId();
  const noteId = `${autoId}-nota`;
  const hasNote = Boolean(error || hint);
  let control = children;
  let controlId: string | undefined;
  if (isValidElement(children)) {
    const props = children.props as { id?: string };
    controlId = props.id ?? autoId;
    control = cloneElement(children as ReactElement<Record<string, unknown>>, {
      id: controlId,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': hasNote ? noteId : undefined,
    });
  }
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={controlId}>{label}</label>
      {control}
      {error ? <span className="error" id={noteId} role="alert">{error}</span> : hint ? <span className="hint" id={noteId}>{hint}</span> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select({ options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: (string | [string, string])[] }) {
  return (
    <select className="select" {...props}>
      {options.map((o) => {
        const [value, label] = Array.isArray(o) ? o : [o, o];
        return <option key={value} value={value}>{label}</option>;
      })}
    </select>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textarea" {...props} />;
}

/**
 * Bloco de conteúdo com título. Desenhado como seção plana (título + linha fina), sem moldura:
 * a página não vira uma pilha de cartões. Para uma caixa com borda de fato, use a classe .panel.
 */
export function Card({ title, actions, children, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; bodyClass?: string }) {
  const body = bodyClass === undefined || bodyClass === 'card-body' ? 'block-body' : bodyClass;
  return (
    <section className="block">
      {title !== undefined && (
        <div className="block-head">
          <h2>{title}</h2>
          {actions}
        </div>
      )}
      <div className={body}>{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="toggle" aria-label={label} style={disabled ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="alert danger">{error instanceof Error ? error.message : String(error)}</div>;
}

export function PageHead({ crumb, title, subtitle, actions }: { crumb?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <>
      {crumb && <div className="breadcrumb">{crumb}</div>}
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Componentes do design system (rodada de refinamento)
// ---------------------------------------------------------------------------

/** Seção plana com título — use no lugar de Card quando não há necessidade de moldura. */
export function Section({ title, description, actions, children }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      {(title || actions) && (
        <div className="section-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="row wrap">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Filtro curto com poucas opções. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

/** Status com texto + forma (ok = círculo cheio, warn = losango, bad = quadrado, off = círculo vazado). */
export function Status({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info' | 'off'; children: ReactNode }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}

/** Diálogo modal acessível: foco no primeiro campo/botão, Esc fecha, clique fora fecha. */
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose muda a cada renderização do pai; guardar numa ref evita refocar o 1º campo a cada tecla.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Só o diálogo mais recente responde ao Esc (há confirmações abertas sobre outros diálogos).
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (e.key === 'Escape' && dialogs[dialogs.length - 1] === ref.current) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <div className="modal-head"><h2 id="modal-title">{title}</h2></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmação de ação destrutiva/sensível. */
export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; message: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} footer={<>
      <button type="button" className="btn" data-close onClick={onCancel}>Cancelar</button>
      <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
    </>}>
      <p className="muted">{message}</p>
    </Modal>
  );
}

/** Aviso curto e temporário após uma ação (feedback). */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? <div className="toast" role="status" aria-live="polite">{msg}</div> : null;
  return { show: setMsg, node };
}
