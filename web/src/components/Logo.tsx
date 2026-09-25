/** Marca: símbolo discreto + nome. */
export function LogoMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-ink" />
      <path d="M10 10.5h7.5a4.5 4.5 0 0 1 0 9H13.5V24" fill="none" className="stroke-canvas" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 19.5L22 24" className="stroke-accent" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Residência Planner</span>
    </span>
  );
}
