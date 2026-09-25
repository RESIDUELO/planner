import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { api, errorMessage } from '../lib/api';
import { dateBR, daysBetween, minutes, pct, relativeDays, shortDate, todayBR } from '../lib/format';
import { Button, Disclosure, Empty, Field, Hint, Menu, Note, Progress, Segmented, Sheet, Spinner, Title, Toggle } from '../components/ui';
import { SubjectModal } from '../components/SubjectModal';

export function PlannerPage() {
  const q = useQuery({ queryKey: ['planner'], queryFn: () => api.get('/api/planner') });
  const [setup, setSetup] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (!q.data?.plan || setup) return <PlannerSetup onDone={() => setSetup(false)} canCancel={!!q.data?.plan} />;
  return <PlannerView data={q.data} onReconfigure={() => setSetup(true)} />;
}

// ============================================================================
// Montar o planner — uma pergunta por vez
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
      setMethods(settings.data.methods.map((m: any) => ({ ...m, enabled: m.configured ? m.enabled : ['video', 'flashcards', 'questions'].includes(m.code), minutes: m.estimated_minutes })));
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
  const TOTAL = 4;
  const canNext = [sel.length > 0 && !!primary && !missingDate, Number(profile.daily_hours) > 0, enabledMethods.length > 0, true][step];
  const questions = ['Quais provas você vai fazer?', 'Quanto tempo você tem?', 'Como você estuda?', 'Tudo pronto.'];

  const toggleExam = (id: string) => {
    const on = sel.includes(id);
    const next = on ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    if (!next.includes(primary ?? '')) setPrimary(next[0] ?? null);
    if (!primary && !on) setPrimary(id);
  };

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-3 flex items-center justify-between text-[14px] text-ink-3 animate-fade">
        <span className="tabular">{step + 1} de {TOTAL}</span>
        {canCancel && <Button variant="plain" size="sm" onClick={onDone}>Cancelar</Button>}
      </div>
      <Progress value={(step + 1) / TOTAL} className="mb-12" />
      <h1 key={step} className="text-[34px] leading-tight font-semibold tracking-[-0.03em] animate-in sm:text-[40px]">{questions[step]}</h1>

      <div key={`s${step}`} className="mt-10 animate-in">
        {step === 0 && (available.length === 0 ? (
          <p className="text-[17px] text-ink-2">Ainda não há provas disponíveis.</p>
        ) : (
          <>
            <div className="divide-y divide-line border-y border-line">
              {available.map((e) => {
                const on = sel.includes(e.edition_id);
                return (
                  <div key={e.edition_id} className="py-4">
                    <label className="flex cursor-pointer items-center gap-4">
                      <input type="checkbox" className="sr-only" checked={on} aria-label={`Selecionar ${e.institution}`} onChange={() => toggleExam(e.edition_id)} />
                      <CheckCircle on={on} />
                      <span className="flex-1">
                        <span className="block text-[19px] font-medium">{e.institution}</span>
                        <span className="block text-[14px] text-ink-2">{e.exam_name} · {e.history.message}</span>
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
                            <input type="radio" name="primary" className="accent-[var(--accent)]" checked={primary === e.edition_id} onChange={() => setPrimary(e.edition_id)} /> Principal
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-[14px] text-ink-3">Com mais de uma prova, a principal e a mais próxima pesam mais no plano.</p>
          </>
        ))}

        {step === 1 && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Horas disponíveis por dia">
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
            <div className="divide-y divide-line border-y border-line">
              <div className="flex items-center justify-between py-3"><span className="text-[17px]">Estudo aos sábados</span><Toggle label="Estudo aos sábados" checked={profile.study_saturday} onChange={(v) => setProfile({ ...profile, study_saturday: v })} /></div>
              <div className="flex items-center justify-between py-3"><span className="text-[17px]">Estudo aos domingos</span><Toggle label="Estudo aos domingos" checked={profile.study_sunday} onChange={(v) => setProfile({ ...profile, study_sunday: v })} /></div>
            </div>
            <p className="text-[14px] text-ink-3">O planner nunca agenda mais do que as horas que você informar.</p>
          </div>
        )}

        {step === 2 && (
          <>
            <div className="divide-y divide-line border-y border-line">
              {methods.map((m, i) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-4 py-4">
                  <input type="checkbox" className="sr-only" checked={m.enabled} aria-label={m.name}
                    onChange={(e) => setMethods(methods.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
                  <CheckCircle on={m.enabled} />
                  <span className="text-[19px]">{m.name}</span>
                </label>
              ))}
            </div>
            <p className="mt-4 text-[14px] text-ink-3">Cada método marcado vira um item do checklist de cada assunto.</p>
          </>
        )}

        {step === 3 && (
          <dl className="space-y-6 text-[17px]">
            <div><dt className="text-[14px] text-ink-2">Provas</dt><dd className="mt-1">{chosen.map((e) => <div key={e.edition_id}>{e.institution} · {shortDate(dateOf(e))}{chosen.length > 1 && e.edition_id === primary ? ' (principal)' : ''}</div>)}</dd></div>
            <div><dt className="text-[14px] text-ink-2">Tempo</dt><dd className="mt-1">{profile.daily_hours} h por dia, {profile.study_days_per_week} dias por semana, {profile.questions_per_day} questões por dia</dd></div>
            <div><dt className="text-[14px] text-ink-2">Métodos</dt><dd className="mt-1">{enabledMethods.map((m) => m.name).join(', ')}</dd></div>
            {chosen.some((e) => e.history.sufficiency === 'insufficient' || e.history.sufficiency === 'none') && (
              <Note>Algumas provas têm poucos dados históricos: {chosen.filter((e) => !['good', 'limited'].includes(e.history.sufficiency)).map((e) => `${e.institution} (${e.history.message})`).join('; ')}</Note>
            )}
            {error && <Note tone="negative">{error}</Note>}
          </dl>
        )}
      </div>

      <div className="mt-14 flex items-center justify-between">
        {step > 0 ? <Button variant="plain" onClick={() => setStep(step - 1)}>Voltar</Button> : <span />}
        {step < TOTAL - 1
          ? <Button size="lg" disabled={!canNext} onClick={() => setStep(step + 1)}>Continuar</Button>
          : <Button size="lg" loading={generate.isPending} onClick={() => { setError(null); generate.mutate(); }}>Gerar planner</Button>}
      </div>
    </div>
  );
}

function CheckCircle({ on }: { on: boolean }) {
  return (
    <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-all duration-200 ease-apple',
      on ? 'border-accent bg-accent text-white' : 'border-ink-3/50')}>
      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

// ============================================================================
// Planner
// ============================================================================

function PlannerView({ data, onReconfigure }: { data: any; onReconfigure: () => void }) {
  const [tab, setTab] = useState<'today' | 'subjects' | 'multi'>('today');
  const [open, setOpen] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const qc = useQueryClient();
  const replan = useMutation({ mutationFn: () => api.post('/api/planner/replan'), onSuccess: () => qc.invalidateQueries() });
  const today = todayBR();

  return (
    <div className="mx-auto max-w-2xl">
      <Title eyebrow={tab === 'today' ? dateBR(today, { weekday: 'long', day: 'numeric', month: 'long' }) : data.plan.name.replace(/^Planner /, '')}
        trailing={<Menu items={[
          { label: 'Recalcular a partir de hoje', onClick: () => replan.mutate() },
          { label: 'Reconfigurar planner', onClick: onReconfigure },
          { label: 'Sobre este plano', onClick: () => setAbout(true) },
        ]} />}>
        {tab === 'today' ? 'Hoje' : tab === 'subjects' ? 'Assuntos' : 'Combinado'}
      </Title>

      <Segmented className="-mt-6 mb-12" value={tab} onChange={setTab} options={[
        { value: 'today', label: 'Hoje' },
        { value: 'subjects', label: 'Assuntos' },
        ...(data.exams.length > 1 ? [{ value: 'multi' as const, label: 'Combinado' }] : []),
      ]} />

      {data.overdueActivities > 0 && tab === 'today' && (
        <p className="-mt-6 mb-10 text-[15px] text-ink-2">
          {data.overdueActivities} atividade{data.overdueActivities > 1 ? 's' : ''} atrasada{data.overdueActivities > 1 ? 's' : ''}.{' '}
          <Button variant="plain" onClick={() => replan.mutate()} loading={replan.isPending}>Reorganizar até a prova</Button>
        </p>
      )}

      {tab === 'today' && <TodayView onOpen={setOpen} next={data.subjects.find((x: any) => x.status !== 'studied' && x.scheduled)} />}
      {tab === 'subjects' && <SubjectList data={data} onOpen={setOpen} />}
      {tab === 'multi' && <MultiTable data={data} onOpen={setOpen} />}

      {about && <AboutPlan data={data} onClose={() => setAbout(false)} />}
      {open && <SubjectModal subjectId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TodayView({ onOpen, next }: { onOpen: (id: string) => void; next?: any }) {
  const q = useQuery({ queryKey: ['today'], queryFn: () => api.get('/api/planner/today') });
  if (q.isLoading) return <Spinner />;
  const t = q.data;
  if (!t) return null;
  const study = t.newSubjects as any[];
  const main = study.filter((s) => !s.overflow);
  const extra = study.filter((s) => s.overflow);

  return (
    <div className="space-y-16">
      {!t.isStudyDay && <p className="text-[17px] text-ink-2">Hoje não é um dia de estudo no seu planejamento.</p>}
      {study.length === 0 && t.reviews.length === 0 ? (
        <Empty title="Tudo em dia." action={next && <Button variant="secondary" onClick={() => onOpen(next.subjectId)}>Adiantar {next.name}</Button>}>
          {next ? 'Você concluiu o que estava planejado para hoje.' : 'Aproveite para fazer questões dos assuntos já estudados.'}
        </Empty>
      ) : (
        <>
          {main.length > 0 && (
            <div className="divide-y divide-line border-y border-line">
              {main.map((s) => <StudyRow key={s.subjectId} s={s} onOpen={onOpen} />)}
            </div>
          )}
          {extra.length > 0 && (
            <Disclosure summary={<span className="text-ink-2">Se sobrar tempo · {extra.length} {extra.length === 1 ? 'assunto' : 'assuntos'}</span>}>
              <div className="divide-y divide-line border-y border-line">
                {extra.map((s) => <StudyRow key={s.subjectId} s={s} onOpen={onOpen} />)}
              </div>
            </Disclosure>
          )}
        </>
      )}

      {t.reviews.length > 0 && (
        <section>
          <div className="flex items-end justify-between gap-4 border-b border-line pb-5">
            <div>
              <div className="text-[21px] font-semibold tracking-[-0.02em]">Revisões</div>
              <div className="mt-0.5 text-[15px] text-ink-2">
                {t.reviews.length} {t.reviews.length === 1 ? 'tópico' : 'tópicos'}
                {t.overdueReviews > 0 && <span className="text-negative"> · {t.overdueReviews} atrasada{t.overdueReviews > 1 ? 's' : ''}</span>}
              </div>
            </div>
            <Link to="/revisoes" className="text-[15px] text-accent hover:underline">Ver revisões →</Link>
          </div>
        </section>
      )}

      {t.questions.perDay > 0 && (
        <section>
          <div className="text-[21px] font-semibold tracking-[-0.02em]">Questões do dia</div>
          <div className="mt-0.5 text-[15px] text-ink-2">{t.questions.perDay} questões · {minutes(t.questions.minutes)}</div>
          {t.questions.suggestions.length > 0 ? (
            <p className="mt-4 text-[15px] text-ink-2">
              Sugestão:{' '}
              {t.questions.suggestions.map((s: any, i: number) => (
                <span key={s.subjectId}>{i > 0 && ', '}<button className="text-accent hover:underline" onClick={() => onOpen(s.subjectId)}>{s.name}</button> ({s.questions})</span>
              ))}
            </p>
          ) : <p className="mt-4 text-[15px] text-ink-3">Estude o primeiro assunto para receber sugestões.</p>}
        </section>
      )}
      <p className="text-[14px] text-ink-3">{minutes(t.plannedMinutes)} planejados de {minutes(t.capacityMinutes)} disponíveis.</p>
    </div>
  );
}

function StudyRow({ s, onOpen }: { s: any; onOpen: (id: string) => void }) {
  return (
    <div className="flex items-center gap-4 py-6">
      <button onClick={() => onOpen(s.subjectId)} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70">
        <div className="text-[13px] text-ink-3">{s.area}</div>
        <div className="mt-0.5 text-[21px] font-semibold tracking-[-0.02em]">{s.name}</div>
        <div className="mt-1 text-[15px] text-ink-2">
          {minutes(s.minutes)} · {s.methods.map((m: any) => m.name).join(', ')}
          {s.overdue && <span className="text-negative"> · atrasado</span>}
        </div>
      </button>
      <Button variant="secondary" onClick={() => onOpen(s.subjectId)}>Começar</Button>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { pending: 'Não iniciado', in_progress: 'Em andamento', studied: 'Estudado' };

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
      <p className="-mt-4 mb-8 text-[15px] text-ink-2">{studied} de {data.subjects.length} estudados · ordenados pelo que mais cai</p>
      <div className="mb-6 flex items-center gap-3">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input className="field pl-9" placeholder="Buscar" aria-label="Buscar assunto" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Menu label="Filtrar" trigger={<span className={clsx('text-[15px]', filtered ? 'text-accent' : 'text-ink-2 hover:text-ink')}>Filtrar</span>} items={[
          { label: `${sort === 'rank' ? '✓ ' : ''}Ordem do plano`, onClick: () => setSort('rank') },
          { label: `${sort === 'dynamic' ? '✓ ' : ''}Prioridade de hoje`, onClick: () => setSort('dynamic') },
          { label: `${status === 'all' ? '✓ ' : ''}Todos`, onClick: () => setStatus('all') },
          { label: `${status === 'pending' ? '✓ ' : ''}Não iniciados`, onClick: () => setStatus('pending') },
          { label: `${status === 'in_progress' ? '✓ ' : ''}Em andamento`, onClick: () => setStatus('in_progress') },
          { label: `${status === 'studied' ? '✓ ' : ''}Estudados`, onClick: () => setStatus('studied') },
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
                <span className={clsx('block truncate text-[17px]', !s.scheduled && 'text-ink-2')}>{s.name}</span>
                <span className="block truncate text-[13px] text-ink-2">
                  {pct(s.percentage)} da prova · {s.card?.nextReview
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
      {value > 0 && <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" className={value >= 1 ? 'stroke-positive' : 'stroke-accent'}
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
      <p className="-mt-4 mb-8 flex items-center gap-1.5 text-[15px] text-ink-2">
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

