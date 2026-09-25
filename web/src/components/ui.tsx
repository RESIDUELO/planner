import { clsx } from 'clsx';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Info, Loader2, X } from 'lucide-react';
import type { Tone } from '../lib/format';

export function Button({
  variant = 'primary', size = 'md', loading, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        variant === 'primary' && 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        variant === 'danger' && 'bg-late-500 text-white hover:bg-late-700',
        variant === 'success' && 'bg-ok-600 text-white hover:bg-ok-700',
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children, title, action, subtitle }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <section className={clsx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-brand-50 text-brand-700 ring-brand-200',
  brand: 'bg-brand-600 text-white ring-brand-600',
  ok: 'bg-ok-50 text-ok-700 ring-ok-500/30',
  warn: 'bg-warn-50 text-warn-700 ring-warn-500/30',
  late: 'bg-late-50 text-late-700 ring-late-500/30',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Progress({ value, tone = 'brand', className, label }: { value: number; tone?: 'brand' | 'ok' | 'warn'; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)} role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div
        className={clsx('h-full rounded-full transition-all', tone === 'brand' && 'bg-brand-500', tone === 'ok' && 'bg-ok-500', tone === 'warn' && 'bg-warn-500')}
        style={{ width: `${v * 100}%` }}
      />
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'late' | 'ok' | 'warn' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs font-medium text-slate-500">
        <span>{label}</span>
        {icon && <span className={clsx('text-slate-400', tone === 'late' && 'text-late-500', tone === 'ok' && 'text-ok-500', tone === 'warn' && 'text-warn-500')}>{icon}</span>}
      </div>
      <div className={clsx('tabular mt-1.5 text-2xl font-semibold text-slate-900', tone === 'late' && 'text-late-700')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" /> {label}
    </div>
  );
}

export function Alert({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'late' | 'ok'; children: ReactNode; title?: string }) {
  return (
    <div className={clsx('flex gap-3 rounded-lg border px-4 py-3 text-sm',
      tone === 'info' && 'border-brand-200 bg-brand-50 text-brand-800',
      tone === 'warn' && 'border-warn-500/30 bg-warn-50 text-warn-700',
      tone === 'late' && 'border-late-500/30 bg-late-50 text-late-700',
      tone === 'ok' && 'border-ok-500/30 bg-ok-50 text-ok-700')}>
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{title && <div className="font-semibold">{title}</div>}{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={clsx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <Info className="h-3.5 w-3.5 cursor-help text-slate-400" aria-label={text} tabIndex={0} />
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 hidden w-64 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs leading-relaxed font-normal text-white shadow-lg group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

/** Barras verticais simples (uma série) com rótulo de valor ao passar o mouse. */
export function MiniBars({ data, height = 56, max }: { data: { label: string; value: number; title?: string }[]; height?: number; max?: number }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1.5" style={{ height: height + 18 }}>
      {data.map((d) => (
        <div key={d.label} className="group flex flex-1 flex-col items-center gap-1" title={d.title ?? `${d.label}: ${d.value}`}>
          <div className="relative flex w-full items-end justify-center" style={{ height }}>
            <span className="tabular absolute -top-4 hidden text-[10px] font-medium text-slate-700 group-hover:block">{d.value}</span>
            <div
              className={clsx('w-full max-w-7 rounded-t-[4px]', d.value ? 'bg-brand-500 group-hover:bg-brand-600' : 'bg-slate-200')}
              style={{ height: d.value ? Math.max(3, (d.value / m) * height) : 2 }}
            />
          </div>
          <span className="tabular text-[10px] text-slate-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
