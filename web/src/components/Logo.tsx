/** Marca: monograma em serifa + nome, como a capa de um caderno. */
export function LogoMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full border border-ink font-display leading-none text-ink ${className}`} aria-hidden>
      <span className="text-[1.05em] translate-y-[0.03em]">R</span>
    </span>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="font-display text-[24px] leading-none">Residência</span>
      <span className="text-[11px] tracking-[0.2em] text-ink-2 uppercase">planner</span>
    </span>
  );
}
