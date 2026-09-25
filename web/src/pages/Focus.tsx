import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import { clock, usePomodoro } from '../lib/pomodoro';
import { Button, Eyebrow, Tint } from '../components/ui';
import { SubjectModal } from '../components/SubjectModal';

const PRESETS = [
  { id: '25', label: '25/5', focus: 25, rest: 5 },
  { id: '50', label: '50/10', focus: 50, rest: 10 },
];

/** Foco: um timer grande, calmo. Independente do planner, mas pode seguir um assunto. */
export function FocusPage() {
  const p = usePomodoro();
  const [custom, setCustom] = useState(!PRESETS.some((x) => x.focus === p.focusMin && x.rest === p.breakMin));
  const [open, setOpen] = useState<string | null>(null);
  const today = useQuery({ queryKey: ['today'], queryFn: () => api.get('/api/planner/today') });
  const options: any[] = [...(today.data?.newSubjects ?? []), ...(today.data?.reviews ?? [])]
    .filter((s, i, a) => a.findIndex((x) => x.subjectId === s.subjectId) === i);

  const progress = p.phase === 'idle' ? 0 : 1 - p.left / p.total;
  const R = 46, C = 2 * Math.PI * R;
  const presetId = custom ? 'custom' : PRESETS.find((x) => x.focus === p.focusMin && x.rest === p.breakMin)?.id ?? 'custom';

  return (
    <div className="mx-auto max-w-md text-center">
      <Eyebrow className="animate-in">{p.phase === 'break' ? 'Pausa' : p.phase === 'focus' ? 'Foco' : 'Pomodoro'}</Eyebrow>
      <div className="mt-3 min-h-[2.5rem] animate-in">
        {p.subject ? (
          <button onClick={() => setOpen(p.subject!.id)} className="transition-opacity hover:opacity-70">
            <Tint area={p.subject.area} className="font-display text-[26px]">{p.subject.name}</Tint>
          </button>
        ) : <p className="font-display text-[26px] text-ink-2">Tempo de foco</p>}
      </div>

      <div className="relative mx-auto mt-8 aspect-square w-full max-w-[320px] animate-in">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth="0.6" className="stroke-line" />
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth="1.6" strokeLinecap="round"
            className={p.phase === 'break' ? 'stroke-[#5fcf92]' : 'stroke-ink'}
            strokeDasharray={`${C * progress} ${C}`} style={{ transition: 'stroke-dasharray 300ms linear' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular font-display text-[76px] leading-none sm:text-[88px]" role="timer" aria-live="off">{clock(p.left)}</span>
          <span className="mt-3 text-[13px] text-ink-2">{p.done.n > 0 ? `${p.done.n} ${p.done.n === 1 ? 'pomodoro' : 'pomodoros'} hoje` : `${p.focusMin} min de foco · ${p.breakMin} de pausa`}</span>
        </div>
      </div>

      <div className="mt-10 flex items-center justify-center gap-4 animate-in">
        {p.phase === 'idle' && <Button size="lg" onClick={() => p.start()}>Iniciar</Button>}
        {p.phase !== 'idle' && (p.running
          ? <Button size="lg" onClick={p.pause}>Pausar</Button>
          : <Button size="lg" onClick={p.resume}>Continuar</Button>)}
        {p.phase !== 'idle' && <Button variant="secondary" size="lg" onClick={p.skip}>{p.phase === 'focus' ? 'Pular para pausa' : 'Encerrar pausa'}</Button>}
      </div>
      {p.phase !== 'idle' && <button onClick={p.reset} className="mt-4 text-[13px] text-ink-3 hover:text-ink">Reiniciar</button>}

      <div className="mx-auto mt-14 max-w-xs animate-in">
        <div role="tablist" className="flex justify-center gap-6">
          {[...PRESETS, { id: 'custom', label: 'Personalizado', focus: 0, rest: 0 }].map((x) => (
            <button key={x.id} role="tab" aria-selected={presetId === x.id}
              onClick={() => { if (x.id === 'custom') setCustom(true); else { setCustom(false); p.setPreset(x.focus, x.rest); } }}
              className={clsx('border-b py-1 text-[15px] transition-colors', presetId === x.id ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
              {x.label}
            </button>
          ))}
        </div>
        {presetId === 'custom' && (
          <div className="mt-5 flex items-end justify-center gap-4 animate-in">
            <label className="text-left text-[12px] text-ink-2">Foco (min)
              <input type="number" min={1} max={180} className="field mt-1 w-24 text-center" value={p.focusMin}
                onChange={(e) => p.setPreset(Math.max(1, Math.min(180, Number(e.target.value) || 1)), p.breakMin)} />
            </label>
            <label className="text-left text-[12px] text-ink-2">Pausa (min)
              <input type="number" min={1} max={60} className="field mt-1 w-24 text-center" value={p.breakMin}
                onChange={(e) => p.setPreset(p.focusMin, Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
            </label>
          </div>
        )}
      </div>

      {options.length > 0 && (
        <div className="mx-auto mt-12 max-w-xs text-left animate-in">
          <label className="block text-[12px] text-ink-2">Estudando
            <select className="field mt-1" value={p.subject?.id ?? ''} onChange={(e) => {
              const s = options.find((o) => o.subjectId === e.target.value);
              p.setSubject(s ? { id: s.subjectId, name: s.name, area: s.area } : null);
            }}>
              <option value="">Nenhum assunto</option>
              {options.map((o) => <option key={o.subjectId} value={o.subjectId}>{o.name}</option>)}
            </select>
          </label>
        </div>
      )}
      <p className="mt-10 text-[13px] text-ink-3">Opcional. O planner funciona com ou sem Pomodoro.</p>
      {open && <SubjectModal subjectId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
