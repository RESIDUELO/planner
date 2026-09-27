/**
 * Aviso pequeno no rodapé ("Arritmias concluído  Desfazer"): confirma uma ação
 * sem abrir janela. Um por vez; some sozinho. Chamado de qualquer lugar.
 */
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';

export interface Toast {
  id: number;
  text: string;
  tone?: 'neutral' | 'negative';
  action?: { label: string; onClick: () => void };
}

let seq = 0;
let current: Toast | null = null;
const subs = new Set<(t: Toast | null) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function emit(t: Toast | null) {
  current = t;
  subs.forEach((f) => f(t));
}

export function toast(text: string, opts: { action?: Toast['action']; tone?: Toast['tone']; ms?: number } = {}) {
  clearTimeout(timer);
  const t: Toast = { id: ++seq, text, tone: opts.tone, action: opts.action };
  emit(t);
  // Com "Desfazer", fica um pouco mais para dar tempo de tocar
  timer = setTimeout(() => current?.id === t.id && emit(null), opts.ms ?? (opts.action ? 6000 : 3500));
  return t.id;
}

export function dismissToast() {
  clearTimeout(timer);
  emit(null);
}

export function Toaster() {
  const [t, setT] = useState<Toast | null>(current);
  useEffect(() => {
    subs.add(setT);
    return () => { subs.delete(setT); };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
      {t && (
        <div key={t.id} role="status" data-testid="toast"
          className="pointer-events-auto flex max-w-md items-center gap-4 rounded-full bg-ink py-2.5 pr-2.5 pl-5 text-[14px] text-canvas shadow-[0_6px_24px_rgba(0,0,0,0.12)] animate-toast">
          <span className={clsx('min-w-0 flex-1', t.tone === 'negative' && 'text-[#ffb4ae] dark:text-negative')}>{t.text}</span>
          {t.action ? (
            <button onClick={() => { dismissToast(); t.action!.onClick(); }}
              className="shrink-0 rounded-full px-3 py-1 text-[13px] font-medium tracking-[0.02em] underline-offset-4 transition hover:bg-canvas/10 active:bg-canvas/15">
              {t.action.label}
            </button>
          ) : (
            <button onClick={dismissToast} aria-label="Fechar aviso" className="shrink-0 rounded-full px-2 py-1 text-canvas/60 transition hover:text-canvas">×</button>
          )}
        </div>
      )}
    </div>
  );
}
