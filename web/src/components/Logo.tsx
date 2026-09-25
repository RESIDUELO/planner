export function Logo({ className = '', light = false }: { className?: string; light?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 64 64" className="h-8 w-8 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="14" fill={light ? '#ffffff' : '#0b5c7a'} />
        <path d="M18 20h20a8 8 0 0 1 0 16H26v10" fill="none" stroke={light ? '#0b5c7a' : '#fff'} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M36 36l8 10" stroke="#34d399" strokeWidth="6" strokeLinecap="round" />
      </svg>
      <div className="leading-tight">
        <div className={`text-[15px] font-semibold tracking-tight ${light ? 'text-white' : 'text-slate-900'}`}>Residência Planner</div>
      </div>
    </div>
  );
}
