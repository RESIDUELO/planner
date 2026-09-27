/**
 * Interações de aplicativo, as mesmas em todo lugar:
 *  - toque/clique: abre
 *  - toque longo (celular) ou botão direito / tecla de menu (computador): ações
 *  - deslizar para a direita: ação positiva (concluir)
 *  - deslizar para a esquerda: revela a ação destrutiva (excluir)
 * Tudo continua acessível pelos controles visíveis; os gestos são atalhos.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Check, Trash2 } from 'lucide-react';
import { addDays, weekday } from '../../../shared/dates';
import { shortDate, todayBR } from '../lib/format';

const LONG_PRESS_MS = 450;
const SWIPE_COMMIT = 72;
const REVEAL = 96;

/** Toque (sem mouse): o arrastar nativo do navegador não é usado; mover é pelo menu. */
export const finePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

export type Anchor = { x: number; y: number } | null;

export interface RowGestures {
  /** Ações (toque longo, botão direito, tecla de menu). */
  onMenu?: (anchor: Anchor) => void;
  /** Deslizar para a direita. */
  right?: { label: string; run: () => void };
  /** Deslizar para a esquerda: revela o botão; tocar nele executa. */
  left?: { label: string; run: () => void };
}

/**
 * Linha com gestos. `children` é o conteúdo normal da linha; `as` e `rest`
 * vão para o elemento externo (li), inclusive o arrastar do computador.
 */
export function SwipeRow({ gestures, children, className, rowClassName, rest, testId }: {
  gestures: RowGestures; children: ReactNode; className?: string; rowClassName?: string; rest?: Record<string, any>; testId?: string;
}) {
  const [dx, setDx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [settling, setSettling] = useState(false);
  const g = useRef<{ id: number; x: number; y: number; lock: 'h' | 'v' | null; timer?: ReturnType<typeof setTimeout>; fired: boolean; base: number } | null>(null);
  const suppressClick = useRef(false);
  const ref = useRef<HTMLLIElement>(null);

  // Toque fora fecha a ação revelada
  useEffect(() => {
    if (!revealed) return;
    const h = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) { setRevealed(false); animateTo(0); } };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [revealed]);

  const animateTo = (x: number) => { setSettling(true); setDx(x); };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const base = revealed ? -REVEAL : 0;
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lock: null, fired: false, base };
    setSettling(false);
    if (gestures.onMenu) {
      g.current.timer = setTimeout(() => {
        if (!g.current || g.current.lock) return;
        g.current.fired = true;
        suppressClick.current = true;
        try { navigator.vibrate?.(8); } catch { /* sem vibração */ }
        gestures.onMenu!({ x: g.current.x, y: g.current.y });
      }, LONG_PRESS_MS);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId || s.fired) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.lock) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { s.lock = 'v'; clearTimeout(s.timer); return; }
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3 && (gestures.left || gestures.right)) {
        s.lock = 'h'; clearTimeout(s.timer);
        try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* ponteiro já solto */ }
      } else return;
    }
    if (s.lock !== 'h') return;
    let x = s.base + mx;
    if (!gestures.right) x = Math.min(0, x);
    if (!gestures.left) x = Math.max(0, x);
    // Resistência além do ponto da ação
    const lim = 140;
    if (Math.abs(x) > lim) x = Math.sign(x) * (lim + (Math.abs(x) - lim) * 0.25);
    setDx(x);
  };
  const end = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    clearTimeout(s.timer);
    g.current = null;
    if (s.lock !== 'h') return;
    suppressClick.current = true;
    if (dx > SWIPE_COMMIT && gestures.right) { gestures.right.run(); setRevealed(false); animateTo(0); return; }
    if (dx < -SWIPE_COMMIT && gestures.left) { setRevealed(true); animateTo(-REVEAL); return; }
    setRevealed(false); animateTo(0);
  };

  return (
    <li ref={ref} {...rest} data-testid={testId} data-swipe-row
      className={clsx('relative overflow-hidden', className)}
      onContextMenu={gestures.onMenu ? (e) => {
        // Botão direito (computador) ou toque longo (o celular também dispara este evento)
        e.preventDefault();
        if (g.current?.fired || suppressClick.current) return;
        gestures.onMenu!({ x: e.clientX, y: e.clientY });
      } : undefined}
      onKeyDown={gestures.onMenu ? (e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          gestures.onMenu!({ x: r.left + 24, y: r.bottom });
        }
      } : undefined}>
      {gestures.right && dx > 0 && (
        <div aria-hidden className={clsx('absolute inset-y-0 left-0 flex items-center gap-2 pl-4 text-[13px] font-medium text-canvas', 'bg-positive')} style={{ width: Math.max(dx, 0) + 2 }}>
          <Check className={clsx('h-4 w-4 shrink-0 transition-transform', dx > SWIPE_COMMIT && 'scale-110')} strokeWidth={2} />
          {dx > 90 && <span className="whitespace-nowrap">{gestures.right.label}</span>}
        </div>
      )}
      {gestures.left && dx < 0 && (
        <div className="absolute inset-y-0 right-0 flex items-stretch justify-end bg-negative" style={{ width: Math.max(-dx, REVEAL) }}>
          <button type="button" onClick={() => { setRevealed(false); animateTo(0); gestures.left!.run(); }}
            className="flex items-center gap-1.5 px-5 text-[13px] font-medium text-white" tabIndex={revealed ? 0 : -1}>
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />{gestures.left.label}
          </button>
        </div>
      )}
      <div
        className={clsx('relative bg-canvas', rowClassName, (gestures.left || gestures.right) && 'touch-pan-y')}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: settling ? 'transform 220ms var(--ease-apple)' : undefined }}
        onTransitionEnd={() => setSettling(false)}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}
        onClickCapture={(e) => {
          if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; }
          else if (revealed) { e.preventDefault(); e.stopPropagation(); setRevealed(false); animateTo(0); }
        }}>
        {children}
      </div>
    </li>
  );
}

export interface ActionItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  hidden?: boolean;
  hint?: string;
}

/**
 * Menu de ações: no celular, uma folha que sobe do rodapé (com "Cancelar");
 * no computador, um menu pequeno junto do ponteiro. Esc fecha; setas navegam.
 */
export function ActionMenu({ title, subtitle, items, anchor, onClose, children }: {
  title: string; subtitle?: string; items: ActionItem[]; anchor: Anchor; onClose: () => void; children?: ReactNode;
}) {
  const sheet = !finePointer() || !anchor;
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (sheet || !anchor || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ left: Math.min(anchor.x, innerWidth - r.width - 12), top: anchor.y + r.height + 12 > innerHeight ? Math.max(12, anchor.y - r.height) : anchor.y });
  }, [anchor, sheet, children]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const i = list.indexOf(document.activeElement as HTMLElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', h);
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }));
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const list = items.filter((i) => !i.hidden);
  const body = (
    <>
      {children ?? list.map((i) => (
        <button key={i.label} role="menuitem" onClick={() => { onClose(); i.onClick(); }}
          className={clsx('flex w-full items-baseline justify-between gap-6 text-left transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none active:bg-fill-strong',
            sheet ? 'px-6 py-3.5 text-[17px]' : 'px-4 py-2 text-[14px]', i.destructive ? 'text-negative' : 'text-ink')}>
          {i.label}{i.hint && <span className="text-[12px] text-ink-3">{i.hint}</span>}
        </button>
      ))}
    </>
  );
  if (sheet) return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim animate-fade sm:items-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} role="menu" aria-label={title} className="w-full overflow-hidden rounded-t-[22px] border border-line bg-canvas pb-[env(safe-area-inset-bottom)] animate-sheet sm:max-w-sm sm:rounded-[20px]">
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-fill-strong sm:hidden" />
        <div className="border-b border-line px-6 pt-4 pb-3">
          <div className="truncate font-display text-[22px] leading-tight">{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-[12px] text-ink-3">{subtitle}</div>}
        </div>
        <div className="py-1">{body}</div>
        <button onClick={onClose} className="w-full border-t border-line py-3.5 text-[16px] text-ink-2 transition-colors active:bg-fill">Cancelar</button>
      </div>
    </div>,
    document.body,
  );
  return createPortal(
    <div className="fixed inset-0 z-50" onPointerDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={box} role="menu" aria-label={title} style={pos ?? { left: anchor!.x, top: anchor!.y, visibility: 'hidden' }}
        className="fixed min-w-56 max-w-72 overflow-hidden rounded-[14px] border border-line bg-canvas py-1 shadow-[0_8px_30px_rgba(0,0,0,0.08)] animate-fade">
        <div className="truncate border-b border-line px-4 pt-1.5 pb-2 text-[12px] text-ink-3">{title}</div>
        {body}
      </div>
    </div>,
    document.body,
  );
}

/** "Mover para outro dia": próximos dias à mão e uma data qualquer. */
export function DayChoices({ current, onPick, sheet }: { current?: string | null; onPick: (d: string) => void; sheet: boolean }) {
  const today = todayBR();
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, i)).filter((d) => d !== current);
  const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const label = (d: string) => (d === today ? 'Hoje' : d === addDays(today, 1) ? 'Amanhã' : WD[weekday(d)]);
  const [other, setOther] = useState('');
  return (
    <div>
      {days.slice(0, 7).map((d) => (
        <button key={d} role="menuitem" onClick={() => onPick(d)}
          className={clsx('flex w-full items-baseline justify-between gap-6 text-left text-ink transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none active:bg-fill-strong',
            sheet ? 'px-6 py-3 text-[17px]' : 'px-4 py-2 text-[14px]')}>
          <span className="first-letter:uppercase">{label(d)}</span><span className="text-[12px] text-ink-3">{shortDate(d, false)}</span>
        </button>
      ))}
      <form className={clsx('flex items-center gap-2 border-t border-line', sheet ? 'px-6 py-3' : 'px-4 py-2')}
        onSubmit={(e) => { e.preventDefault(); if (other >= today) onPick(other); }}>
        <input type="date" className="field py-1.5 text-[14px]" aria-label="Outra data" min={today} value={other} onChange={(e) => setOther(e.target.value)} />
        <button type="submit" disabled={!other || other < today} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[13px] transition hover:border-ink disabled:opacity-40">Mover</button>
      </form>
    </div>
  );
}

/**
 * Trocar de página (semana/dia) deslizando: dedo, arrastar com o mouse numa
 * área vazia, rolagem horizontal do trackpad e as setas ← →. O conteúdo
 * acompanha o dedo e a página nova entra pelo lado certo.
 * Não pega gestos que começam numa linha com ações próprias, num campo ou
 * em algo arrastável.
 */
export function usePageSwipe(onPage: (dir: 1 | -1) => void) {
  // Liga quando o elemento aparece (a tela pode estar carregando no começo)
  const [el, ref] = useState<HTMLElement | null>(null);
  const [dx, setDx] = useState(0);
  const [enter, setEnter] = useState<{ dir: 1 | -1; n: number } | null>(null);
  const cb = useRef(onPage);
  cb.current = onPage;
  const go = (dir: 1 | -1) => { setDx(0); setEnter((e) => ({ dir, n: (e?.n ?? 0) + 1 })); cb.current(dir); };

  useEffect(() => {
    if (!el) return;
    let s: { id: number; x: number; y: number; t: number; lock: 'h' | 'v' | null; mouse: boolean } | null = null;
    let swiped = false;
    const skip = (t: EventTarget | null) => !!(t as Element)?.closest?.('[data-swipe-row],input,textarea,select,[draggable="true"],[role="dialog"],[role="menu"],[data-no-page-swipe]');
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (skip(e.target)) return;
      s = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), lock: null, mouse: e.pointerType === 'mouse' };
    };
    const move = (e: PointerEvent) => {
      if (!s || s.id !== e.pointerId) return;
      const mx = e.clientX - s.x, my = e.clientY - s.y;
      if (!s.lock) {
        if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) { s = null; return; }
        if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.4) {
          s.lock = 'h';
          try { el.setPointerCapture?.(e.pointerId); } catch { /* ponteiro já solto */ }
          if (s.mouse) document.getSelection()?.removeAllRanges();
        } else return;
      }
      setDx(mx);
    };
    const up = (e: PointerEvent) => {
      if (!s || s.id !== e.pointerId) return;
      const st = s;
      s = null;
      if (st.lock !== 'h') return;
      const mx = e.clientX - st.x;
      const fast = Math.abs(mx) / Math.max(1, performance.now() - st.t) > 0.5;
      swiped = true;
      setTimeout(() => { swiped = false; }, 0); // só o clique que o próprio gesto gera
      if (Math.abs(mx) > 70 || (fast && Math.abs(mx) > 30)) go(mx < 0 ? 1 : -1);
      else setDx(0);
    };
    // Depois de deslizar, o clique que vem junto não abre nada
    const click = (e: MouseEvent) => { if (swiped) { e.preventDefault(); e.stopPropagation(); } };
    // Trackpad: rolagem horizontal, uma página por gesto
    let acc = 0, lockUntil = 0;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || skip(e.target)) return;
      e.preventDefault(); // evita o "voltar página" do navegador
      const now = performance.now();
      if (now < lockUntil) return;
      acc += e.deltaX;
      if (Math.abs(acc) > 60) { go(acc > 0 ? 1 : -1); acc = 0; lockUntil = now + 600; }
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true);
      el.removeEventListener('wheel', wheel);
    };
  }, [el]);

  // ← → no teclado (fora de campos e de janelas abertas)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable="true"]') || document.querySelector('[role="dialog"],[role="menu"]')) return;
      e.preventDefault();
      go(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  /** Estilo do conteúdo que acompanha o gesto; `key` troca a cada página para a entrada animada. */
  const content = {
    style: dx ? { transform: `translateX(${dx * 0.55}px)`, opacity: Math.max(0.35, 1 - Math.abs(dx) / 500) } : undefined,
    className: clsx('touch-pan-y', !dx && enter && (enter.dir > 0 ? 'rp-page-next' : 'rp-page-prev')),
    key: enter?.n ?? 0,
  };
  return { ref, content, dragging: dx !== 0 };
}
