/**
 * Componentes da interface. Princípio: menos UI.
 * Hierarquia por tipografia e espaço; caixas só quando ajudam.
 */
import { clsx } from 'clsx';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Info, MoreHorizontal, X } from 'lucide-react';

// ---------------------------------------------------------------- Botões
type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive';

export function Button({
  variant = 'primary', size = 'md', loading, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const pill = variant === 'primary' || variant === 'secondary';
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 font-normal whitespace-nowrap transition-all duration-200 ease-apple select-none disabled:cursor-default disabled:opacity-40',
        pill && 'rounded-full',
        pill && size === 'sm' && 'px-3.5 py-1 text-[14px]',
        pill && size === 'md' && 'px-5 py-2 text-[15px]',
        pill && size === 'lg' && 'px-7 py-3 text-[17px]',
        !pill && (size === 'sm' ? 'text-[14px]' : 'text-[15px]'),
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]',
        variant === 'secondary' && 'bg-fill text-ink hover:bg-fill-strong active:scale-[0.98]',
        variant === 'plain' && 'text-accent hover:underline underline-offset-4',
        variant === 'destructive' && 'text-negative hover:underline underline-offset-4',
        className,
      )}
    >
      {loading ? <Dots /> : children}
    </button>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1" aria-label="Carregando">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1 w-1 rounded-full bg-current opacity-60" style={{ animation: `rp-fade-only 600ms ${i * 150}ms infinite alternate` }} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- Títulos e seções
export function Title({ children, eyebrow, trailing, subtitle }: { children: ReactNode; eyebrow?: ReactNode; trailing?: ReactNode; subtitle?: ReactNode }) {
  return (
    <header className="mb-10 flex items-end justify-between gap-4 animate-in sm:mb-14">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[15px] text-ink-2">{eyebrow}</div>}
        <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[48px]">{children}</h1>
        {subtitle && <p className="mt-2 text-[17px] text-ink-2">{subtitle}</p>}
      </div>
      {trailing && <div className="shrink-0 pb-1">{trailing}</div>}
    </header>
  );
}

export function Section({ label, trailing, children, className }: { label?: ReactNode; trailing?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('animate-in', className)}>
      {(label || trailing) && (
        <div className="mb-3 flex items-baseline justify-between gap-4">
          {label && <h2 className="text-[15px] font-medium text-ink-2">{label}</h2>}
          {trailing}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- Listas
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('divide-y divide-line border-y border-line', className)}>{children}</div>;
}

export function Row({
  title, subtitle, trailing, onClick, chevron, className, children, testId,
}: { title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; onClick?: () => void; chevron?: boolean; className?: string; children?: ReactNode; testId?: string }) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] text-ink">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[14px] text-ink-2">{subtitle}</div>}
      </div>
      {trailing && <div className="shrink-0 text-right text-[15px] text-ink-2">{trailing}</div>}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />}
    </>
  );
  return (
    <div className={className} data-testid={testId}>
      {onClick ? (
        <button onClick={onClick} className="flex w-full items-center gap-4 py-4 text-left transition-opacity duration-150 hover:opacity-70">{inner}</button>
      ) : (
        <div className="flex w-full items-center gap-4 py-4">{inner}</div>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Dados
export function Progress({ value, className, label, tone = 'accent' }: { value: number; className?: string; label?: string; tone?: 'accent' | 'positive' | 'ink' }) {
  const v = Math.max(0, Math.min(1, value || 0));
  const [w, setW] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setW(v)); return () => cancelAnimationFrame(t); }, [v]);
  return (
    <div className={clsx('h-1 w-full overflow-hidden rounded-full bg-fill-strong', className)} role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={clsx('h-full rounded-full transition-[width] duration-700 ease-apple', tone === 'accent' && 'bg-accent', tone === 'positive' && 'bg-positive', tone === 'ink' && 'bg-ink')} style={{ width: `${w * 100}%` }} />
    </div>
  );
}

export function Stat({ value, label, className }: { value: ReactNode; label: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="tabular text-[28px] leading-tight font-semibold tracking-[-0.02em]">{value}</div>
      <div className="text-[14px] text-ink-2">{label}</div>
    </div>
  );
}

/** Mensagem discreta, sem caixa. */
export function Note({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'positive' | 'negative' | 'accent'; children: ReactNode; className?: string }) {
  return (
    <p role={tone === 'negative' ? 'alert' : undefined} className={clsx('text-[14px] animate-fade',
      tone === 'neutral' && 'text-ink-2', tone === 'positive' && 'text-positive', tone === 'negative' && 'text-negative', tone === 'accent' && 'text-accent', className)}>
      {children}
    </p>
  );
}

export function Spinner() {
  return <div className="flex justify-center py-32 text-ink-3 animate-fade"><Dots /></div>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="py-20 text-center animate-in">
      <h3 className="text-[22px] font-semibold tracking-tight">{title}</h3>
      {children && <div className="mx-auto mt-2 max-w-sm text-[15px] text-ink-2">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Folha (modal)
export function Sheet({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim animate-fade sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={clsx('relative flex max-h-[92vh] w-full flex-col rounded-t-[22px] bg-surface shadow-[0_10px_40px_rgba(0,0,0,0.12)] animate-sheet sm:rounded-[22px]', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-fill-strong sm:hidden" />
        <button onClick={onClose} aria-label="Fechar" className="absolute top-4 right-4 z-10 rounded-full bg-fill p-1.5 text-ink-2 transition hover:bg-fill-strong">
          <X className="h-4 w-4" />
        </button>
        <div className="overflow-y-auto px-6 pt-8 pb-8 sm:px-10 sm:pt-10">
          {title && <h2 className="mb-6 pr-8 text-[28px] leading-tight font-semibold tracking-[-0.025em]">{title}</h2>}
          {children}
        </div>
        {footer && <div className="flex justify-end gap-3 border-t border-line px-6 py-4 sm:px-10">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Menu "⋯"
export function Menu({ items, label = 'Mais opções', trigger }: { items: { label: string; onClick: () => void; destructive?: boolean; hidden?: boolean }[]; label?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex items-center rounded-full text-ink-2 transition hover:text-ink">
        {trigger ?? <span className="rounded-full bg-fill p-2 hover:bg-fill-strong"><MoreHorizontal className="h-4 w-4" /></span>}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 min-w-56 overflow-hidden rounded-[14px] border border-line bg-surface py-1 shadow-[0_8px_30px_rgba(0,0,0,0.08)] animate-fade">
          {items.filter((i) => !i.hidden).map((i) => (
            <button key={i.label} role="menuitem" onClick={() => { setOpen(false); i.onClick(); }}
              className={clsx('block w-full px-4 py-2.5 text-left text-[15px] transition hover:bg-fill', i.destructive ? 'text-negative' : 'text-ink')}>
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Revelação progressiva
export function Disclosure({ summary, children, defaultOpen = false, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 py-3 text-left text-[15px] text-ink transition hover:opacity-70">
        <span>{summary}</span>
        <ChevronDown className={clsx('h-4 w-4 text-ink-3 transition-transform duration-200 ease-apple', open && 'rotate-180')} />
      </button>
      {open && <div className="pb-4 animate-in">{children}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <div role="tablist" className={clsx('inline-flex rounded-[10px] bg-fill p-0.5', className)}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={clsx('rounded-[8px] px-4 py-1.5 text-[14px] transition-all duration-200 ease-apple',
            value === o.value ? 'bg-canvas font-medium text-ink shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-fill-strong' : 'text-ink-2 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={clsx('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ease-apple', checked ? 'bg-positive' : 'bg-fill-strong')}>
      <span className={clsx('absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-transform duration-200 ease-apple', checked && 'translate-x-5')} />
    </button>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-[13px] text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[13px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <Info className="h-3.5 w-3.5 cursor-help text-ink-3" aria-label={text} tabIndex={0} />
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 hidden w-64 -translate-x-1/2 rounded-[10px] bg-ink px-3 py-2 text-[13px] leading-relaxed font-normal tracking-normal text-canvas group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

/** Barras verticais de uma série só, com o valor no hover. */
export function Bars({ data, height = 80, max }: { data: { label: string; value: number; title?: string }[]; height?: number; max?: number }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} title={d.title ?? `${d.label}: ${d.value}`} className="group flex h-full flex-1 items-end">
          <div className={clsx('w-full rounded-t-[3px] transition-colors duration-150', d.value ? 'bg-accent/70 group-hover:bg-accent' : 'bg-fill-strong')}
            style={{ height: d.value ? Math.max(3, (d.value / m) * height) : 2 }} />
        </div>
      ))}
    </div>
  );
}
