/**
 * Pomodoro independente do planner: funciona sozinho ou ligado a um assunto.
 * O estado (fase, fim previsto, pausa) fica no localStorage para sobreviver a recarregamentos.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { todayBR } from './format';

export type Phase = 'idle' | 'focus' | 'break';
export interface PomodoroState {
  phase: Phase;
  focusMin: number;
  breakMin: number;
  /** Fim da fase atual (ms) quando rodando. */
  endAt: number | null;
  /** Segundos restantes quando pausado. */
  pausedLeft: number | null;
  subject: { id: string; name: string; area?: string | null } | null;
  /** Pomodoros concluídos hoje. */
  done: { date: string; n: number };
  /** Total de minutos de foco concluídos (neste aparelho). */
  focusMinutesTotal: number;
}

const KEY = 'rp-pomodoro';
const initial: PomodoroState = { phase: 'idle', focusMin: 25, breakMin: 5, endAt: null, pausedLeft: null, subject: null, done: { date: '', n: 0 }, focusMinutesTotal: 0 };

function load(): PomodoroState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...initial, ...JSON.parse(raw) };
  } catch { /* sem armazenamento */ }
  return initial;
}

function chime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [0, 0.22].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = i ? 880 : 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.65);
    });
  } catch { /* sem áudio */ }
}

interface Api extends PomodoroState {
  /** Segundos restantes da fase (ou a duração total se parado). */
  left: number;
  total: number;
  running: boolean;
  start: (opts?: { subject?: PomodoroState['subject'] }) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  skip: () => void;
  setPreset: (focusMin: number, breakMin: number) => void;
  setSubject: (s: PomodoroState['subject']) => void;
  /** Visualização focada aberta por cima da tela (sem trocar de página). */
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}

const Ctx = createContext<Api | null>(null);

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<PomodoroState>(load);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const stRef = useRef(st);
  stRef.current = st;

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }, [st]);
  useEffect(() => {
    if (!st.endAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [st.endAt]);

  // Fim de fase: foco → pausa (automática) → parado, pronto para o próximo.
  useEffect(() => {
    if (!st.endAt || now < st.endAt) return;
    chime();
    setSt((s) => {
      if (s.phase === 'focus') {
        const today = todayBR();
        const n = s.done.date === today ? s.done.n + 1 : 1;
        return { ...s, phase: 'break', endAt: Date.now() + s.breakMin * 60_000, pausedLeft: null, done: { date: today, n }, focusMinutesTotal: (s.focusMinutesTotal ?? 0) + s.focusMin };
      }
      return { ...s, phase: 'idle', endAt: null, pausedLeft: null };
    });
  }, [now, st.endAt]);

  const start = useCallback((opts?: { subject?: PomodoroState['subject'] }) => {
    setSt((s) => ({ ...s, phase: 'focus', endAt: Date.now() + s.focusMin * 60_000, pausedLeft: null, subject: opts && 'subject' in opts ? opts.subject ?? null : s.subject }));
    setNow(Date.now());
  }, []);
  const pause = useCallback(() => setSt((s) => (s.endAt ? { ...s, pausedLeft: Math.max(0, Math.round((s.endAt - Date.now()) / 1000)), endAt: null } : s)), []);
  const resume = useCallback(() => { setSt((s) => (s.pausedLeft != null ? { ...s, endAt: Date.now() + s.pausedLeft * 1000, pausedLeft: null } : s)); setNow(Date.now()); }, []);
  const reset = useCallback(() => setSt((s) => ({ ...s, phase: 'idle', endAt: null, pausedLeft: null })), []);
  const skip = useCallback(() => setSt((s) => (s.phase === 'focus'
    ? { ...s, phase: 'break', endAt: Date.now() + s.breakMin * 60_000, pausedLeft: null,
        focusMinutesTotal: (s.focusMinutesTotal ?? 0) + Math.max(0, Math.round((s.focusMin * 60 - (s.endAt ? (s.endAt - Date.now()) / 1000 : s.pausedLeft ?? s.focusMin * 60)) / 60)) }
    : { ...s, phase: 'idle', endAt: null, pausedLeft: null })), []);
  const setPreset = useCallback((focusMin: number, breakMin: number) => setSt((s) => ({ ...s, focusMin, breakMin, ...(s.phase === 'idle' ? {} : { phase: 'idle', endAt: null, pausedLeft: null }) })), []);
  const setSubject = useCallback((subject: PomodoroState['subject']) => setSt((s) => ({ ...s, subject })), []);

  const value = useMemo<Api>(() => {
    const total = (st.phase === 'break' ? st.breakMin : st.focusMin) * 60;
    const left = st.endAt ? Math.max(0, Math.ceil((st.endAt - now) / 1000)) : st.pausedLeft ?? total;
    const done = st.done.date === todayBR() ? st.done : { date: todayBR(), n: 0 };
    return { ...st, done, total, left, running: !!st.endAt, start, pause, resume, reset, skip, setPreset, setSubject, expanded, setExpanded };
  }, [st, now, start, pause, resume, reset, skip, setPreset, setSubject, expanded]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePomodoro() {
  const c = useContext(Ctx);
  if (!c) throw new Error('PomodoroProvider ausente');
  return c;
}

export const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
