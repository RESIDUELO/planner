/** Marca: monograma P&S em serifa + nome, como a capa de um caderno. */
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full border border-ink font-display leading-none text-ink ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden>
      <span className="translate-y-[0.04em] tracking-[-0.02em]">P<span className="italic">&amp;</span>S</span>
    </span>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className="inline-flex items-baseline gap-1.5">
        <span className="font-display text-[24px] leading-none">Planner</span>
        <span className="text-[11px] tracking-[0.2em] text-ink-2 uppercase">Pablo e Samêla</span>
      </span>
    </span>
  );
}
