import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search, Timer } from 'lucide-react';
import { clsx } from 'clsx';
import { api, errorMessage } from '../lib/api';
import { daysBetween, pct, relativeDays, shortDate, todayBR } from '../lib/format';
import { areaShort, tintFor } from '../lib/areas';
import { usePomodoro } from '../lib/pomodoro';
import { Advanced, Button, CheckButton, CheckCircle, Eyebrow, Field, Hint, Menu, Note, Segmented, Sheet, Spinner, Tint, Title, Toggle } from '../components/ui';
import { SubjectModal, useInvalidateStudy } from '../components/SubjectModal';
import { addDays, weekday } from '../../../shared/dates';

export function PlannerPage() {
  const q = useQuery({ queryKey: ['planner'], queryFn: () => api.get('/api/planner') });
  const [setup, setSetup] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (!q.data?.plan || setup) return <PlannerSetup onDone={() => setSetup(false)} canCancel={!!q.data?.plan} />;
  return <PlannerView data={q.data} onReconfigure={() => setSetup(true)} />;
}

// ============================================================================
// Montar o planner — o mínimo: provas e como você estuda
// ============================================================================

function PlannerSetup({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }) {
  const qc = useQueryClient();
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api.get<any[]>('/api/exams') });
  const settings = useQuery({ queryKey: ['study-settings'], queryFn: () => api.get('/api/me/study-settings') });
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [methods, setMethods] = useState<any[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (exams.data && !sel.length) {
      const s = exams.data.filter((e) => e.selected);
      setSel(s.map((e) => e.edition_id));
      setPrimary(s.find((e) => e.is_primary)?.edition_id ?? s[0]?.edition_id ?? null);
    }
  }, [exams.data]);
  useEffect(() => {
    if (settings.data && !profile) {
      setProfile({ ...settings.data.profile, start_date: settings.data.profile.configured ? settings.data.profile.start_date : todayBR() });
      setMethods(settings.data.methods.map((m: any) => ({ ...m, enabled: m.configured ? m.enabled : ['video', 'flashcards'].includes(m.code), minutes: m.estimated_minutes })));
    }
  }, [settings.data]);

  const generate = useMutation({
    mutationFn: async () => {
      for (const e of chosen) {
        if (dates[e.edition_id] && dates[e.edition_id] !== e.exam_date) await api.put(`/api/me/editions/${e.edition_id}`, { examDate: dates[e.edition_id] });
      }
      await api.put('/api/me/study-settings', {
        profile: { ...profile, daily_hours: Number(profile.daily_hours), study_days_per_week: Number(profile.study_days_per_week), questions_per_day: Number(profile.questions_per_day), preferred_start_time: profile.preferred_start_time?.slice(0, 5) || null, preferred_end_time: profile.preferred_end_time?.slice(0, 5) || null },
        methods: methods.map((m) => ({ id: m.id, enabled: m.enabled, minutes: Number(m.minutes) })),
      });
      return api.post('/api/planner/generate', { editionIds: sel, primaryEditionId: primary, startDate: profile.start_date });
    },
    onSuccess: () => { qc.invalidateQueries(); onDone(); },
    onError: (e) => setError(errorMessage(e)),
  });

  if (exams.isLoading || settings.isLoading || !profile) return <Spinner />;
  const available = (exams.data ?? []).filter((e) => e.days_left == null || e.days_left > 0);
  const chosen = available.filter((e) => sel.includes(e.edition_id));
  const dateOf = (e: any) => dates[e.edition_id] ?? e.exam_date ?? '';
  const missingDate = chosen.some((e) => !dateOf(e) || dateOf(e) <= todayBR());
  const enabledMethods = methods.filter((m) => m.enabled);
  const canNext = sel.length > 0 && !!primary && !missingDate;

  const toggleExam = (id: string) => {
    const on = sel.includes(id);
    const next = on ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    if (!next.includes(primary ?? '')) setPrimary(next[0] ?? null);
    if (!primary && !on) setPrimary(id);
  };

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-10 flex items-center justify-between animate-fade">
        <Eyebrow>Passo {step + 1} de 2</Eyebrow>
        {canCancel && <Button variant="plain" size="sm" onClick={onDone}>Cancelar</Button>}
      </div>
      <h1 key={step} className="font-display text-[44px] leading-[1.05] animate-in sm:text-[56px]">{step === 0 ? 'Qual prova você vai fazer?' : 'Como você estuda?'}</h1>

      <div key={`s${step}`} className="mt-10 animate-in">
        {step === 0 && (available.length === 0 ? (
          <p className="text-[17px] text-ink-2">Ainda não há provas disponíveis.</p>
        ) : (
          <>
            <div className="border-t border-line">
              {available.map((e) => {
                const on = sel.includes(e.edition_id);
                return (
                  <div key={e.edition_id} className="border-b border-line py-5">
                    <label className="flex cursor-pointer items-center gap-4">
                      <input type="checkbox" className="sr-only" checked={on} aria-label={`Selecionar ${e.institution}`} onChange={() => toggleExam(e.edition_id)} />
                      <CheckCircle on={on} />
                      <span className="flex-1">
                        <span className="block font-display text-[26px] leading-tight">{e.institution}</span>
                        <span className="block text-[13px] text-ink-2">{e.exam_name} · {e.history.message}</span>
                      </span>
                    </label>
                    {on && (
                      <div className="mt-4 ml-10 flex flex-wrap items-end gap-x-6 gap-y-3 animate-in">
                        <Field label="Data da prova" className="w-44">
                          <input type="date" className="field" aria-label={`Data da prova — ${e.institution}`} min={todayBR()}
                            value={dateOf(e)} onChange={(ev) => setDates({ ...dates, [e.edition_id]: ev.target.value })} />
                        </Field>
                        {chosen.length > 1 && (
                          <label className="flex items-center gap-2 pb-2.5 text-[15px] text-ink-2">
                            <input type="radio" name="primary" className="accent-[var(--ink)]" checked={primary === e.edition_id} onChange={() => setPrimary(e.edition_id)} /> Principal
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {chosen.length > 1 && <p className="mt-4 text-[13px] text-ink-3">Com mais de uma prova, a principal e a mais próxima pesam mais no plano.</p>}
          </>
        ))}

        {step === 1 && (
          <>
            <p className="-mt-4 mb-6 text-[15px] text-ink-2">Marque o que você costuma fazer. Um assunto fica concluído quando você fizer tudo o que marcou.</p>
            <div className="flex flex-wrap gap-2.5">
              {methods.map((m, i) => (
                <label key={m.id} className={clsx('cursor-pointer rounded-full border px-4 py-2 text-[16px] transition select-none',
                  m.enabled ? 'border-ink bg-ink text-canvas' : 'border-line text-ink hover:border-ink')}>
                  <input type="checkbox" className="sr-only" checked={m.enabled} aria-label={m.name}
                    onChange={(e) => setMethods(methods.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
                  {m.name}
                </label>
              ))}
            </div>
            {chosen.some((e) => e.history.sufficiency === 'insufficient' || e.history.sufficiency === 'none') && (
              <Note className="mt-8">Algumas provas têm poucos dados históricos: {chosen.filter((e) => !['good', 'limited'].includes(e.history.sufficiency)).map((e) => `${e.institution} (${e.history.message})`).join('; ')}</Note>
            )}

            <Advanced className="mt-12 border-t border-line pt-5">
              <div className="space-y-8">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Horas por dia">
                    <input type="number" min={0.5} max={16} step={0.5} className="field" value={profile.daily_hours} onChange={(e) => setProfile({ ...profile, daily_hours: e.target.value })} />
                  </Field>
                  <Field label="Questões por dia">
                    <input type="number" min={0} max={500} className="field" value={profile.questions_per_day} onChange={(e) => setProfile({ ...profile, questions_per_day: e.target.value })} />
                  </Field>
                  <Field label="Dias de estudo por semana">
                    <input type="number" min={1} max={7} className="field" value={profile.study_days_per_week} onChange={(e) => setProfile({ ...profile, study_days_per_week: e.target.value })} />
                  </Field>
                  <Field label="Começar em">
                    <input type="date" className="field" value={profile.start_date} onChange={(e) => setProfile({ ...profile, start_date: e.target.value })} />
                  </Field>
                </div>
                <div className="border-y border-line">
                  <div className="flex items-center justify-between py-3"><span className="text-[15px]">Estudo aos sábados</span><Toggle label="Estudo aos sábados" checked={profile.study_saturday} onChange={(v) => setProfile({ ...profile, study_saturday: v })} /></div>
                  <div className="flex items-center justify-between border-t border-line py-3"><span className="text-[15px]">Estudo aos domingos</span><Toggle label="Estudo aos domingos" checked={profile.study_sunday} onChange={(v) => setProfile({ ...profile, study_sunday: v })} /></div>
                </div>
                {enabledMethods.length > 0 && (
                  <div>
                    <p className="mb-2 text-[13px] text-ink-2">Tempo estimado por atividade (usado só para distribuir os assuntos nos dias)</p>
                    <div className="space-y-2">
                      {enabledMethods.map((m) => (
                        <label key={m.id} className="flex items-center justify-between gap-4 text-[15px]">
                          {m.name}
                          <span className="flex items-center gap-2 text-ink-2">
                            <input type="number" min={5} max={600} className="field w-20 text-right" aria-label={`Minutos — ${m.name}`} value={m.minutes}
                              onChange={(e) => setMethods(methods.map((x) => (x.id === m.id ? { ...x, minutes: e.target.value } : x)))} /> min
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Advanced>
            {error && <Note tone="negative" className="mt-6">{error}</Note>}
          </>
        )}
      </div>

      <div className="mt-14 flex items-center justify-between">
        {step > 0 ? <Button variant="plain" onClick={() => setStep(0)}>Voltar</Button> : <span />}
        {step === 0
          ? <Button size="lg" disabled={!canNext} onClick={() => setStep(1)}>Continuar</Button>
          : <Button size="lg" disabled={!enabledMethods.length || !(Number(profile.daily_hours) > 0)} loading={generate.isPending} onClick={() => { setError(null); generate.mutate(); }}>Criar meu planner</Button>}
      </div>
    </div>
  );
}

// ============================================================================
// Planner — semana editorial, sem horários
// ============================================================================

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));

function PlannerView({ data, onReconfigure }: { data: any; onReconfigure: () => void }) {
  const [tab, setTab] = useState<'week' | 'subjects' | 'multi'>('week');
  const [open, setOpen] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const qc = useQueryClient();
  const replan = useMutation({ mutationFn: () => api.post('/api/planner/replan'), onSuccess: () => qc.invalidateQueries() });
  const exam = data.exams.find((e: any) => e.is_primary) ?? data.exams[0];

  return (
    <div className="mx-auto max-w-2xl">
      <Title eyebrow={exam?.exam_date ? `${exam.institution} · ${shortDate(exam.exam_date)}` : data.plan.name.replace(/^Planner /, '')}
        trailing={<Menu items={[
          { label: 'Recalcular a partir de hoje', onClick: () => replan.mutate() },
          { label: 'Reconfigurar planner', onClick: onReconfigure },
          { label: 'Sobre este plano', onClick: () => setAbout(true) },
        ]} />}>
        Planner
      </Title>

      <Segmented className="-mt-4 mb-12" value={tab} onChange={setTab} options={[
        { value: 'week', label: 'Semana' },
        { value: 'subjects', label: 'Assuntos' },
        ...(data.exams.length > 1 ? [{ value: 'multi' as const, label: 'Combinado' }] : []),
      ]} />

      {tab === 'week' && <WeekView onOpen={setOpen} onReplan={() => replan.mutate()} replanning={replan.isPending} />}
      {tab === 'subjects' && <SubjectList data={data} onOpen={setOpen} />}
      {tab === 'multi' && <MultiTable data={data} onOpen={setOpen} />}

      {about && <AboutPlan data={data} onClose={() => setAbout(false)} />}
      {open && <SubjectModal subjectId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Marca/desmarca as atividades daquele dia (ou o assunto inteiro). */
export function useCheck() {
  const invalidate = useInvalidateStudy();
  return useMutation({
    mutationFn: async ({ subjectId, methodIds, done }: { subjectId: string; methodIds?: string[]; done: boolean }) => {
      if (!methodIds?.length) return api.post(`/api/planner/subjects/${subjectId}/complete`, { done });
      for (const m of methodIds) await api.post(`/api/planner/subjects/${subjectId}/methods/${m}`, { done });
    },
    onSettled: invalidate,
  });
}

function WeekView({ onOpen, onReplan, replanning }: { onOpen: (id: string) => void; onReplan: () => void; replanning: boolean }) {
  const today = todayBR();
  const [from, setFrom] = useState(mondayOf(today));
  const to = addDays(from, 6);
  const week = useQuery({ queryKey: ['week', from], queryFn: () => api.get(`/api/reviews/calendar?from=${from}&to=${to}`) });
  const t = useQuery({ queryKey: ['today'], queryFn: () => api.get('/api/planner/today') });
  const check = useCheck();
  const isThisWeek = from === mondayOf(today);
  const late = isThisWeek ? (t.data?.newSubjects ?? []).filter((s: any) => s.overdue) : [];
  const [a, b] = [from, to].map((d) => d.split('-').map(Number));
  const range = a[1] === b[1] ? `${a[2]} – ${b[2]} ${MONTHS[b[1] - 1]}` : `${a[2]} ${MONTHS[a[1] - 1]} – ${b[2]} ${MONTHS[b[1] - 1]}`;

  return (
    <div>
      <div className="mb-10 flex items-center justify-between">
        <p className="font-display text-[26px]">{range}</p>
        <div className="flex items-center gap-1 text-ink-2">
          {!isThisWeek && <button onClick={() => setFrom(mondayOf(today))} className="mr-2 text-[13px] underline underline-offset-4 hover:text-ink">Esta semana</button>}
          <button onClick={() => setFrom(addDays(from, -7))} aria-label="Semana anterior" className="rounded-full p-1.5 hover:bg-fill hover:text-ink"><ChevronLeft className="h-5 w-5" strokeWidth={1.5} /></button>
          <button onClick={() => setFrom(addDays(from, 7))} aria-label="Próxima semana" className="rounded-full p-1.5 hover:bg-fill hover:text-ink"><ChevronRight className="h-5 w-5" strokeWidth={1.5} /></button>
        </div>
      </div>

      {late.length > 0 && (
        <section className="mb-14 animate-in" aria-label="Atrasados">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[26px] italic">Atrasados</span>
            <span className="h-px flex-1 bg-line" />
            <Button variant="plain" size="sm" loading={replanning} onClick={onReplan}>Reorganizar</Button>
          </div>
          <ul className="mt-2">
            {late.map((s: any) => (
              <TaskRow key={s.subjectId} item={{ subjectId: s.subjectId, name: s.name, area: s.area, done: false }} onOpen={onOpen}
                onCheck={(done) => check.mutate({ subjectId: s.subjectId, methodIds: s.methods.map((m: any) => m.methodId), done })} />
            ))}
          </ul>
        </section>
      )}

      {week.isLoading ? <Spinner /> : (
        <div>
          {(week.data?.days ?? []).map((d: any) => (
            <DayBlock key={d.date} day={d} today={today} onOpen={onOpen} questions={d.date === today ? t.data?.questions : null}
              onCheck={(item, done) => check.mutate({ subjectId: item.subjectId, methodIds: item.methodIds, done })} />
          ))}
        </div>
      )}
      <p className="mt-16 text-[13px] text-ink-3">Toque no círculo para concluir · toque no nome para ver o assunto.</p>
    </div>
  );
}

function DayBlock({ day, today, onOpen, onCheck, questions }: { day: any; today: string; onOpen: (id: string) => void; onCheck: (item: any, done: boolean) => void; questions?: any }) {
  const isToday = day.date === today;
  const past = day.date < today;
  // A "revisão" registrada ao concluir o assunto no mesmo dia não aparece duplicada
  const studiedHere = new Set((day.newSubjects as any[]).map((n) => n.subjectId));
  const reviews = (day.reviews as any[]).filter((r, i, arr) => arr.findIndex((x) => x.subjectId === r.subjectId) === i && !(r.status === 'done' && studiedHere.has(r.subjectId)));
  const empty = !day.newSubjects.length && !reviews.length && !day.exams.length;
  if (past && empty) return (
    <section data-testid={`day-${day.date}`} className="mb-5 flex items-baseline gap-3 text-ink-3 animate-in">
      <span className="w-9 text-[11px] font-medium tracking-[0.16em] uppercase">{WD[weekday(day.date)]}</span>
      <span className="tabular font-display text-[22px] leading-none">{Number(day.date.slice(8))}</span>
      <span className="h-px flex-1 bg-line" />
    </section>
  );
  return (
    <section data-testid={`day-${day.date}`} aria-label={isToday ? 'Hoje' : undefined} className="mb-12 animate-in">
      <div className="flex items-baseline gap-3">
        <span className={clsx('w-9 text-[11px] font-medium tracking-[0.16em] uppercase', isToday ? 'text-today' : 'text-ink-2')}>{WD[weekday(day.date)]}</span>
        <span className={clsx('tabular font-display text-[40px] leading-none', isToday ? 'text-today' : past ? 'text-ink-3' : 'text-ink')}>{Number(day.date.slice(8))}</span>
        <span className={clsx('h-px flex-1 translate-y-[-0.35em]', isToday ? 'bg-today' : 'bg-ink/80')} />
        {isToday && <span className="text-[11px] tracking-[0.16em] text-today uppercase">hoje</span>}
      </div>
      <ul className="mt-2 pl-12">
        {day.exams.map((e: string) => (
          <li key={e} className="py-3"><span className="tint tint-rose text-[15px] font-medium">Prova · {e}</span></li>
        ))}
        {day.newSubjects.map((n: any) => (
          <TaskRow key={n.subjectId} item={{ ...n, done: n.done ?? n.studied }} detail={n.methodIds.length < n.totalActivities ? n.methods.join(' · ') : undefined}
            pomodoro={isToday} onOpen={onOpen} onCheck={(done) => onCheck(n, done)} />
        ))}
        {reviews.map((r: any) => (
          <li key={`r${r.subjectId}`} className="flex items-center gap-4 border-b border-line/70 py-3 last:border-0">
            <button onClick={() => onOpen(r.subjectId)} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70">
              <span className={clsx('text-[16px]', r.status === 'done' ? 'text-ink-3 line-through decoration-1' : r.status === 'projected' ? 'text-ink-2' : 'text-ink')}>↻ {r.name}</span>
              <span className={clsx('ml-2 text-[12px]', r.status === 'overdue' ? 'text-today' : 'text-ink-3')}>
                {r.status === 'overdue' ? `revisão atrasada` : r.status === 'done' ? 'revisado' : r.status === 'projected' ? 'revisão prevista' : 'revisão'}
              </span>
            </button>
            {(r.status === 'scheduled' || r.status === 'overdue') && day.date <= today && (
              <button onClick={() => onOpen(r.subjectId)} className="text-[13px] text-ink-2 underline underline-offset-4 hover:text-ink">Revisar</button>
            )}
          </li>
        ))}
        {empty && <li className="py-3 text-[14px] text-ink-3">Livre</li>}
      </ul>
      {questions?.perDay > 0 && questions.suggestions.length > 0 && (
        <p className="mt-3 pl-12 text-[13px] text-ink-2">
          Questões sugeridas:{' '}
          {questions.suggestions.map((s: any, i: number) => (
            <span key={s.subjectId}>{i > 0 && ', '}<button className="underline decoration-line underline-offset-4 hover:decoration-ink" onClick={() => onOpen(s.subjectId)}>{s.name}</button> ({s.questions})</span>
          ))}
        </p>
      )}
    </section>
  );
}

export function TaskRow({ item, onOpen, onCheck, detail, pomodoro }: { item: { subjectId: string; name: string; area?: string; specialty?: string | null; done: boolean }; onOpen: (id: string) => void; onCheck: (done: boolean) => void; detail?: string; pomodoro?: boolean }) {
  const p = usePomodoro();
  const nav = useNavigate();
  return (
    <li className="group flex items-center gap-4 border-b border-line/70 py-3 last:border-0" data-testid="task">
      <button onClick={() => onOpen(item.subjectId)} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70">
        <Tint area={item.area} className={clsx('text-[10.5px] font-medium tracking-[0.14em] uppercase', item.done && 'opacity-50')}>{item.specialty || areaShort(item.area)}</Tint>
        <span className={clsx('mt-1 block text-[17px] leading-snug', item.done && 'text-ink-3 line-through decoration-1')}>{item.name}</span>
        {detail && !item.done && <span className="block text-[12px] text-ink-3">{detail}</span>}
      </button>
      {!item.done && (
        <button onClick={() => { p.start({ subject: { id: item.subjectId, name: item.name, area: item.area } }); nav('/foco'); }}
          aria-label={`Iniciar Pomodoro — ${item.name}`} title="Iniciar Pomodoro"
          className={clsx('flex items-center gap-1.5 rounded-full text-[12px] text-ink-3 transition hover:text-ink', !pomodoro && 'opacity-0 group-hover:opacity-100 focus:opacity-100')}>
          <Timer className="h-4 w-4" strokeWidth={1.5} />{pomodoro && <span className="hidden sm:inline">Iniciar Pomodoro</span>}
        </button>
      )}
      <CheckButton on={item.done} onChange={onCheck} label={`Concluir ${item.name}`} />
    </li>
  );
}

const STATUS_LABEL: Record<string, string> = { pending: 'Não iniciado', in_progress: 'Em andamento', studied: 'Concluído' };

function SubjectList({ data, onOpen }: { data: any; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [area, setArea] = useState('all');
  const [sort, setSort] = useState<'rank' | 'dynamic'>('rank');
  const [limit, setLimit] = useState(40);
  const areas = useMemo(() => [...new Set<string>(data.subjects.map((s: any) => s.area))].sort(), [data]);
  const today = todayBR();
  const list = useMemo(() => {
    const l = data.subjects.filter((s: any) =>
      (status === 'all' || (status === 'unscheduled' ? !s.scheduled : s.status === status)) &&
      (area === 'all' || s.area === area) &&
      (!search || s.name.toLowerCase().includes(search.toLowerCase())));
    return sort === 'dynamic' ? [...l].sort((a: any, b: any) => b.dynamic.score - a.dynamic.score) : l;
  }, [data, search, status, area, sort]);
  const studied = data.subjects.filter((s: any) => s.status === 'studied').length;
  const filtered = status !== 'all' || area !== 'all' || sort !== 'rank';

  return (
    <>
      <p className="mb-8 text-[15px] text-ink-2">{studied} de {data.subjects.length} concluídos · ordenados pelo que mais cai</p>
      <div className="mb-6 flex items-center gap-3">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input className="field pl-9" placeholder="Buscar" aria-label="Buscar assunto" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Menu label="Filtrar" trigger={<span className={clsx('text-[15px]', filtered ? 'text-ink underline underline-offset-4' : 'text-ink-2 hover:text-ink')}>Filtrar</span>} items={[
          { label: `${sort === 'rank' ? '✓ ' : ''}Ordem do plano`, onClick: () => setSort('rank') },
          { label: `${sort === 'dynamic' ? '✓ ' : ''}Prioridade de hoje`, onClick: () => setSort('dynamic') },
          { label: `${status === 'all' ? '✓ ' : ''}Todos`, onClick: () => setStatus('all') },
          { label: `${status === 'pending' ? '✓ ' : ''}Não iniciados`, onClick: () => setStatus('pending') },
          { label: `${status === 'in_progress' ? '✓ ' : ''}Em andamento`, onClick: () => setStatus('in_progress') },
          { label: `${status === 'studied' ? '✓ ' : ''}Concluídos`, onClick: () => setStatus('studied') },
          { label: `${status === 'unscheduled' ? '✓ ' : ''}Fora do tempo disponível`, onClick: () => setStatus('unscheduled') },
          ...areas.map((a) => ({ label: `${area === a ? '✓ ' : ''}${a}`, onClick: () => setArea(area === a ? 'all' : a) })),
        ]} />
      </div>
      <ol className="divide-y divide-line border-y border-line">
        {list.slice(0, limit).map((s: any) => (
          <li key={s.subjectId}>
            <button onClick={() => onOpen(s.subjectId)} data-testid="subject-card" className="flex w-full items-center gap-4 py-4 text-left transition-opacity hover:opacity-70">
              <span className="tabular w-7 shrink-0 text-[14px] text-ink-3">{s.rank}</span>
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate text-[17px]', !s.scheduled && 'text-ink-2', s.status === 'studied' && 'text-ink-3 line-through decoration-1')}>{s.name}</span>
                <span className="block truncate text-[13px] text-ink-2">
                  <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle dot-${tintFor(s.area)}`} />{areaShort(s.area)} · {pct(s.percentage)} da prova · {s.card?.nextReview
                    ? (s.card.nextReview < today ? <span className="text-negative">revisão atrasada</span> : `revisão ${relativeDays(daysBetween(s.card.nextReview, today))}`)
                    : !s.scheduled ? 'fora do tempo disponível' : STATUS_LABEL[s.status].toLowerCase()}
                </span>
              </span>
              <ProgressDot value={s.progress} />
            </button>
          </li>
        ))}
      </ol>
      {list.length > limit && <Button variant="plain" className="mt-6" onClick={() => setLimit(limit + 60)}>Mostrar mais ({list.length - limit})</Button>}
    </>
  );
}

/** Anel de progresso mínimo. */
function ProgressDot({ value }: { value: number }) {
  const r = 9, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 -rotate-90" aria-label={`${Math.round(value * 100)}%`}>
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" className="stroke-fill-strong" />
      {value > 0 && <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-ink"
        strokeDasharray={`${c * value} ${c}`} style={{ transition: 'stroke-dasharray 600ms var(--ease-apple)' }} />}
    </svg>
  );
}

function MultiTable({ data, onOpen }: { data: any; onOpen: (id: string) => void }) {
  const exams = data.plan.summary.exams as any[];
  const weights = data.plan.summary.weights as any[];
  const LV: Record<string, string> = { muito_alta: 'Muito alta', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
  return (
    <>
      <p className="mb-8 flex items-center gap-1.5 text-[15px] text-ink-2">
        Peso de cada prova: {weights.map((w) => `${w.label.split(' — ')[0]} ${pct(w.weight, 0)}`).join(' · ')}
        <Hint text="Peso = (2 se principal, 1 se não) × (0,5 + proximidade), normalizado. Proximidade = 1 / (1 + dias até a prova / 60)." />
      </p>
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[520px] text-left text-[15px]">
          <thead>
            <tr className="border-b border-line text-[13px] text-ink-2">
              <th className="py-3 pr-3 font-normal">Assunto</th>
              {exams.map((e) => <th key={e.editionId} className="px-2 py-3 text-right font-normal">{e.label.split(' — ')[0]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.subjects.slice(0, 60).map((s: any) => (
              <tr key={s.subjectId} onClick={() => onOpen(s.subjectId)} className="cursor-pointer transition-opacity hover:opacity-70">
                <td className="py-3 pr-3"><span className="mr-3 tabular text-[13px] text-ink-3">{s.rank}</span>{s.name}</td>
                {exams.map((e) => {
                  const pe = s.perExam.find((p: any) => p.editionId === e.editionId);
                  return <td key={e.editionId} className="tabular px-2 py-3 text-right text-ink-2" title={pe?.level ? LV[pe.level] : 'Não aparece'}>{pe?.percentage ? pct(pe.percentage) : '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-[13px] text-ink-3">Fração das questões de cada prova. A ordem combina as provas pelo peso acima.</p>
    </>
  );
}

function AboutPlan({ data, onClose }: { data: any; onClose: () => void }) {
  const s = data.plan.summary;
  return (
    <Sheet open onClose={onClose} title="Sobre este plano">
      <dl className="space-y-6 text-[15px]">
        <div><dt className="text-ink-2">Período</dt><dd className="mt-1">{shortDate(data.plan.start_date)} → {shortDate(data.plan.end_date)} · {s.studyDays} dias de estudo</dd></div>
        <div><dt className="text-ink-2">Base da análise</dt><dd className="mt-1 space-y-1">{s.exams.map((e: any) => <div key={e.editionId}>{e.label.split(' — ')[0]}: {e.message}{e.years?.length ? ` (${e.years.join(', ')})` : ''}</div>)}</dd></div>
        <div><dt className="text-ink-2">Cobertura</dt><dd className="mt-1">O tempo disponível cobre {pct(s.historicalCoverageScheduled)} das questões históricas.</dd></div>
        <div><dt className="text-ink-2">Reta final</dt><dd className="mt-1">Últimos {s.finalPhaseDays} dias reservados só para revisões.</dd></div>
        {s.warnings?.length > 0 && <div><dt className="text-ink-2">Avisos</dt><dd className="mt-1 space-y-2">{s.warnings.map((w: string) => <p key={w}>{w}</p>)}</dd></div>}
        <div><dt className="text-ink-2">Algoritmos</dt><dd className="mt-1 text-ink-3">{data.plan.algorithm_version} · {data.plan.scheduler_version}</dd></div>
      </dl>
    </Sheet>
  );
}

