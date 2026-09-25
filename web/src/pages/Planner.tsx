import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlarmClock, BookOpen, CalendarClock, CheckCircle2, ChevronRight, Circle, ListChecks, RefreshCw, Settings2, Sparkles, Target } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { dateBR, LEVEL_TONE, minutes, num1, pct, relativeDays, todayBR, daysBetween } from '../lib/format';
import { Alert, Badge, Button, Card, Empty, Field, Hint, PageHeader, Progress, Spinner } from '../components/ui';
import { SubjectModal, useInvalidateStudy } from '../components/SubjectModal';
import { ReviewButtons } from '../components/ReviewButtons';

export function PlannerPage() {
  const q = useQuery({ queryKey: ['planner'], queryFn: () => api.get('/api/planner') });
  const [setup, setSetup] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (!q.data?.plan || setup) return <PlannerSetup onDone={() => setSetup(false)} canCancel={!!q.data?.plan} />;
  return <PlannerView data={q.data} onReconfigure={() => setSetup(true)} />;
}

// ============================================================================
// Configuração / geração
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
  const steps = ['Provas', 'Tempo', 'Como você estuda?', 'Revisar'];
  const enabledMethods = methods.filter((m) => m.enabled);

  const canNext = [
    sel.length > 0 && !!primary && !missingDate,
    Number(profile.daily_hours) > 0,
    enabledMethods.length > 0,
    true,
  ][step];

  return (
    <>
      <PageHeader title="Montar planner" subtitle="O planner ordena os assuntos pelo histórico real das provas selecionadas e distribui o estudo no seu tempo." />
      <ol className="mb-6 flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <li key={s}>
            <button onClick={() => i < step && setStep(i)} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-brand-50 text-brand-700' : 'bg-white text-slate-400 ring-1 ring-slate-200'}`}>
              <span className="tabular">{i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        {step === 0 && (
          available.length === 0 ? (
            <Empty title="Nenhuma prova disponível">A administração ainda não publicou provas com data futura.</Empty>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Selecione uma ou mais provas. A <b>prova principal</b> tem mais peso; com várias provas, o planner combina as frequências e dá mais influência à prova que acontece primeiro.</p>
              {available.map((e) => {
                const on = sel.includes(e.edition_id);
                return (
                  <div key={e.edition_id} className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${on ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200'}`}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={on} aria-label={`Selecionar ${e.institution} ${e.year}`}
                        onChange={() => {
                          const next = on ? sel.filter((x) => x !== e.edition_id) : [...sel, e.edition_id];
                          setSel(next);
                          if (!next.includes(primary ?? '')) setPrimary(next[0] ?? null);
                          if (!primary && !on) setPrimary(e.edition_id);
                        }} />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{e.institution} — {e.exam_name}</div>
                        <div className="text-xs text-slate-500">{e.history.message}</div>
                      </div>
                    </label>
                    {on && (
                      <>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                          Data da prova
                          <input type="date" className="input w-auto py-1" aria-label={`Data da prova — ${e.institution}`}
                            value={dates[e.edition_id] ?? e.exam_date ?? ''} min={todayBR()}
                            onChange={(ev) => setDates({ ...dates, [e.edition_id]: ev.target.value })} />
                        </label>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                          <input type="radio" name="primary" className="accent-brand-600" checked={primary === e.edition_id} onChange={() => setPrimary(e.edition_id)} /> Principal
                        </label>
                      </>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-slate-500">A data de cada prova fica salva só na sua conta (você também pode editá-la na página Provas).</p>
            </div>
          )
        )}

        {step === 1 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Data de início"><input type="date" className="input" value={profile.start_date} onChange={(e) => setProfile({ ...profile, start_date: e.target.value })} /></Field>
            <Field label="Horas disponíveis por dia" hint="O planner nunca agenda mais do que isso.">
              <input type="number" min={0.5} max={16} step={0.5} className="input" value={profile.daily_hours} onChange={(e) => setProfile({ ...profile, daily_hours: e.target.value })} />
            </Field>
            <Field label="Dias de estudo por semana"><input type="number" min={1} max={7} className="input" value={profile.study_days_per_week} onChange={(e) => setProfile({ ...profile, study_days_per_week: e.target.value })} /></Field>
            <Field label="Questões por dia" hint="Reservadas até 40% do tempo diário."><input type="number" min={0} max={500} className="input" value={profile.questions_per_day} onChange={(e) => setProfile({ ...profile, questions_per_day: e.target.value })} /></Field>
            <div className="flex flex-col justify-end gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={profile.study_saturday} onChange={(e) => setProfile({ ...profile, study_saturday: e.target.checked })} /> Estudo aos sábados</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={profile.study_sunday} onChange={(e) => setProfile({ ...profile, study_sunday: e.target.checked })} /> Estudo aos domingos</label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Início preferido"><input type="time" className="input" value={profile.preferred_start_time?.slice(0, 5) ?? ''} onChange={(e) => setProfile({ ...profile, preferred_start_time: e.target.value })} /></Field>
              <Field label="Fim preferido"><input type="time" className="input" value={profile.preferred_end_time?.slice(0, 5) ?? ''} onChange={(e) => setProfile({ ...profile, preferred_end_time: e.target.value })} /></Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-base font-semibold text-slate-900">Como você estuda?</h2>
            <p className="mb-4 mt-1 text-sm text-slate-600">Marque tudo o que você usa. Cada método marcado vira um item do checklist de cada assunto.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {methods.map((m, i) => (
                <label key={m.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-medium ${m.enabled ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={m.enabled}
                    onChange={(e) => setMethods(methods.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-4"><div className="text-xs text-slate-500">Provas</div>{chosen.map((e) => <div key={e.edition_id} className="font-medium">{e.institution} — {dateBR(dateOf(e))}{e.edition_id === primary && ' (principal)'}</div>)}</div>
              <div className="rounded-lg bg-slate-50 p-4"><div className="text-xs text-slate-500">Tempo</div><div className="font-medium">{profile.daily_hours} h/dia · {profile.study_days_per_week} dias/semana</div><div className="text-slate-600">{profile.questions_per_day} questões/dia · início {dateBR(profile.start_date)}</div></div>
              <div className="rounded-lg bg-slate-50 p-4"><div className="text-xs text-slate-500">Métodos</div><div className="font-medium">{enabledMethods.map((m) => m.name).join(', ')}</div></div>
            </div>
            {chosen.some((e) => e.history.sufficiency === 'insufficient' || e.history.sufficiency === 'none') && (
              <Alert tone="warn">Algumas provas têm {chosen.filter((e) => e.history.sufficiency !== 'good' && e.history.sufficiency !== 'limited').map((e) => `${e.institution} (${e.history.message})`).join('; ')}</Alert>
            )}
            {error && <Alert tone="late">{error}</Alert>}
          </div>
        )}

        <div className="mt-6 flex justify-between border-t border-slate-100 pt-4">
          <div>{canCancel && <Button variant="ghost" onClick={onDone}>Cancelar</Button>}</div>
          <div className="flex gap-2">
            {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>Voltar</Button>}
            {step < 3 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)}>Continuar</Button>
              : <Button loading={generate.isPending} onClick={() => { setError(null); generate.mutate(); }}><Sparkles className="h-4 w-4" /> Gerar planner</Button>}
          </div>
        </div>
      </Card>
    </>
  );
}

// ============================================================================
// Visualização
// ============================================================================

function PlannerView({ data, onReconfigure }: { data: any; onReconfigure: () => void }) {
  const [tab, setTab] = useState<'today' | 'subjects' | 'multi'>('today');
  const [open, setOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const replan = useMutation({ mutationFn: () => api.post('/api/planner/replan'), onSuccess: () => qc.invalidateQueries() });
  const summary = data.plan.summary;

  return (
    <>
      <PageHeader title="Planner" subtitle={<>{data.plan.name} · {dateBR(data.plan.start_date)} → {dateBR(data.plan.end_date)}</>}
        action={<>
          <Button variant="secondary" onClick={() => replan.mutate()} loading={replan.isPending} title="Reorganiza as atividades pendentes a partir de hoje, mantendo o progresso"><RefreshCw className="h-4 w-4" /> Recalcular</Button>
          <Button variant="secondary" onClick={onReconfigure}><Settings2 className="h-4 w-4" /> Reconfigurar</Button>
        </>} />

      {data.overdueActivities > 0 && (
        <div className="mb-4"><Alert tone="warn" title={`${data.overdueActivities} atividade(s) atrasada(s)`}>
          Você pode continuá-las hoje ou <button className="font-semibold underline" onClick={() => replan.mutate()}>recalcular o planner</button> para redistribuir o que falta até a prova.
        </Alert></div>
      )}

      <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200">
        {([['today', 'O que estudar hoje?', CalendarClock], ['subjects', `Assuntos (${data.subjects.length})`, ListChecks], ...(data.exams.length > 1 ? [['multi', 'Multiprova', Target]] : [])] as any[]).map(([k, l, I]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <I className="h-4 w-4" /> {l}
          </button>
        ))}
      </div>

      {tab === 'today' && <TodayView onOpen={setOpen} />}
      {tab === 'subjects' && <SubjectList data={data} onOpen={setOpen} />}
      {tab === 'multi' && <MultiTable data={data} onOpen={setOpen} />}

      <div className="mt-6 grid gap-3 text-xs text-slate-500 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="font-semibold text-slate-700">Base da análise</div>
          {summary.exams.map((e: any) => <div key={e.editionId}>{e.label}: {e.message}{e.years?.length ? ` (${e.years.join(', ')})` : ''}</div>)}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="font-semibold text-slate-700">Carga planejada</div>
          <div>{summary.studyDays} dias de estudo · {minutes(summary.capacityMinutes / Math.max(1, summary.studyDays))}/dia · reta final de {summary.finalPhaseDays} dias só com revisões</div>
          <div>Cobertura agendada: {pct(summary.historicalCoverageScheduled)} das questões históricas · {data.plan.algorithm_version} / {data.plan.scheduler_version}</div>
        </div>
      </div>
      {summary.warnings?.map((w: string) => <div key={w} className="mt-2"><Alert tone="warn">{w}</Alert></div>)}

      {open && <SubjectModal subjectId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function TodayView({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['today'], queryFn: () => api.get('/api/planner/today') });
  const invalidate = useInvalidateStudy();
  const [msg, setMsg] = useState<string | null>(null);
  const done = useMutation({
    mutationFn: ({ subjectId, methodId }: any) => api.post(`/api/planner/subjects/${subjectId}/methods/${methodId}`, { done: true }),
    onSuccess: (r: any) => { invalidate(); if (r.cardCreated) setMsg('Assunto estudado! Primeira revisão agendada.'); },
  });
  if (q.isLoading) return <Spinner />;
  const t = q.data;
  if (!t) return null;
  const nothing = !t.newSubjects.length && !t.reviews.length;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <CalendarClock className="h-5 w-5 text-brand-600" />
          <span className="font-medium">{dateBR(t.today, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <span className="text-slate-500">{t.isStudyDay ? `${minutes(t.plannedMinutes)} planejados de ${minutes(t.capacityMinutes)} disponíveis` : 'Hoje não é dia de estudo no seu planejamento'}</span>
          <Progress className="max-w-40 flex-1" value={t.plannedMinutes / t.capacityMinutes} />
        </div>
        {msg && <Alert tone="ok">{msg}</Alert>}
        {nothing && <Empty icon={<CheckCircle2 className="h-10 w-10 text-ok-500" />} title="Nada pendente para hoje">Aproveite para fazer questões dos assuntos já estudados.</Empty>}

        {t.newSubjects.map((s: any, i: number) => (
          <div key={s.subjectId} className={`rounded-xl border bg-white p-4 shadow-sm ${s.overflow ? 'border-dashed border-slate-300 opacity-75' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Prioridade {i + 1} · #{s.rank} no ranking</div>
                <button onClick={() => onOpen(s.subjectId)} className="mt-0.5 text-left text-lg font-semibold text-slate-900 hover:text-brand-700">{s.name}</button>
                <div className="text-xs text-slate-500">{s.area} · {pct(s.percentage)} das questões históricas</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {s.levelLabel && <Badge tone={LEVEL_TONE[s.level]}>{s.levelLabel} prioridade</Badge>}
                {s.overdue && <Badge tone="late"><AlarmClock className="h-3 w-3" /> Atrasado desde {dateBR(s.oldestDate)}</Badge>}
                {s.overflow && <Badge tone="neutral" title="Excede as horas de hoje: faça se sobrar tempo">Excedente</Badge>}
                <Badge>{minutes(s.minutes)}</Badge>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {s.methods.map((m: any) => (
                <button key={m.methodId} onClick={() => done.mutate({ subjectId: s.subjectId, methodId: m.methodId })}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:border-ok-500/50 hover:bg-ok-50" title="Marcar como concluído">
                  <Circle className="h-4 w-4 text-slate-300" /> {m.name} <span className="text-xs text-slate-400">{m.minutes} min</span>
                </button>
              ))}
              <Button size="sm" onClick={() => onOpen(s.subjectId)}><BookOpen className="h-3.5 w-3.5" /> Estudar</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <Card title={`Revisões de hoje (${t.reviews.length})`} subtitle={t.overdueReviews ? `${t.overdueReviews} atrasada(s)` : 'Revisão espaçada adaptada à data da prova'}>
          {t.reviews.length === 0 ? <p className="text-sm text-slate-500">Nenhuma revisão pendente.</p> : (
            <ul className="space-y-4">
              {t.reviews.map((r: any) => (
                <li key={r.subjectId} className={r.overflow ? 'opacity-75' : ''}>
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => onOpen(r.subjectId)} className="text-left text-sm font-medium text-slate-900 hover:text-brand-700">{r.name}</button>
                    <span className="text-xs text-slate-500">{minutes(r.minutes)}</span>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
                    {r.overdueDays > 0 ? <Badge tone="late">Atrasada {r.overdueDays} dia(s)</Badge> : <Badge tone="info">Hoje</Badge>}
                    <span className="text-slate-500">lembrança estimada {pct(r.retrievability, 0)}</span>
                  </div>
                  <ReviewButtons subjectId={r.subjectId} onDone={setMsg} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Questões do dia (${t.questions.perDay})`} subtitle={`${minutes(t.questions.minutes)} reservados`}>
          {t.questions.suggestions.length === 0 ? <p className="text-sm text-slate-500">Estude o primeiro assunto para receber sugestões de questões.</p> : (
            <ul className="space-y-2 text-sm">
              {t.questions.suggestions.map((s: any) => (
                <li key={s.subjectId} className="flex items-start justify-between gap-2">
                  <button onClick={() => onOpen(s.subjectId)} className="text-left hover:text-brand-700">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-slate-500">{s.reason}</div>
                  </button>
                  <Badge>{s.questions} q</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">Registre acertos no assunto para atualizar seu domínio estimado.</p>
        </Card>
      </div>
    </div>
  );
}

function SubjectList({ data, onOpen }: { data: any; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [area, setArea] = useState('all');
  const [sort, setSort] = useState<'rank' | 'dynamic'>('rank');
  const [limit, setLimit] = useState(60);
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

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <input className="input max-w-xs" placeholder="Buscar assunto…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">Todos os status</option><option value="pending">Pendentes</option><option value="in_progress">Em andamento</option><option value="studied">Estudados</option><option value="unscheduled">Fora do tempo</option>
        </select>
        <select className="input w-auto" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Área">
          <option value="all">Todas as áreas</option>{areas.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Ordenação">
          <option value="rank">Ordem do plano (frequência histórica)</option><option value="dynamic">Prioridade dinâmica</option>
        </select>
        <span className="ml-auto text-sm text-slate-500"><b className="text-slate-800">{studied}</b> / {data.subjects.length} assuntos estudados</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.slice(0, limit).map((s: any) => (
          <button key={s.subjectId} onClick={() => onOpen(s.subjectId)} data-testid="subject-card"
            className={`flex flex-col rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow ${s.status === 'studied' ? 'border-ok-500/40' : 'border-slate-200'} ${!s.scheduled ? 'opacity-70' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="tabular text-xs font-semibold text-slate-400">{String(s.rank).padStart(2, '0')}</div>
                <div className="font-semibold text-slate-900">{s.name}</div>
                <div className="truncate text-xs text-slate-500">{s.area}</div>
              </div>
              <Badge tone={LEVEL_TONE[s.level]}>{s.levelLabel.toUpperCase()}</Badge>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-slate-500">Frequência</dt><dd className="tabular font-semibold text-slate-800">{pct(s.percentage)}</dd></div>
              <div><dt className="text-slate-500">Média/ano</dt><dd className="tabular font-semibold text-slate-800">{num1(s.annualAverage)}</dd></div>
              <div><dt className="text-slate-500">Edições</dt><dd className="tabular font-semibold text-slate-800">{s.yearsPresent}/{s.yearsAnalyzed}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {s.checklist.map((c: any) => (
                <span key={c.methodId} className={`flex items-center gap-1 ${c.done ? 'text-ok-700' : 'text-slate-400'}`}>
                  {c.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />} {c.name}
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2"><Progress value={s.progress} tone={s.progress === 1 ? 'ok' : 'brand'} /><span className="tabular text-xs text-slate-500">{pct(s.progress, 0)}</span></div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
              <span>{s.performance.answered ? <>{s.performance.answered} questões · {s.performance.correct} acertos · <b className="text-slate-700">{pct(s.performance.accuracy, 0)}</b></> : 'Sem questões registradas'}</span>
              <span>
                {s.card?.nextReview ? <>Revisão {s.card.nextReview < today ? <b className="text-late-700">atrasada</b> : relativeDays(daysBetween(s.card.nextReview, today))}</>
                  : !s.scheduled ? 'Fora do tempo disponível' : s.nextScheduledDate ? `Agendado ${dateBR(s.nextScheduledDate)}` : ''}
              </span>
            </div>
          </button>
        ))}
      </div>
      {list.length > limit && (
        <div className="mt-4 text-center"><Button variant="secondary" onClick={() => setLimit(limit + 60)}>Mostrar mais ({list.length - limit} restantes)</Button></div>
      )}
    </>
  );
}

function MultiTable({ data, onOpen }: { data: any; onOpen: (id: string) => void }) {
  const exams = data.plan.summary.exams as any[];
  const weights = data.plan.summary.weights as any[];
  const LV: Record<string, string> = { muito_alta: 'Muito alta', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
  return (
    <Card title="Prioridade combinada" subtitle="Nível de cada assunto em cada prova e a prioridade resultante. Provas mais próximas e a principal pesam mais.">
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {weights.map((w) => (
          <Badge key={w.editionId} tone={w.excludedReason ? 'neutral' : 'info'}>
            {w.label}: peso {pct(w.weight, 0)}{w.excludedReason === 'no_data' ? ' (sem dados)' : w.excludedReason === 'past' ? ' (já realizada)' : ''}
          </Badge>
        ))}
        <Hint text="Peso = (2 se principal, 1 se não) × (0,5 + proximidade), normalizado. Proximidade = 1 / (1 + dias até a prova / 60)." />
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>#</th><th>Assunto</th>{exams.map((e) => <th key={e.editionId} className="text-center">{e.label.split(' — ')[0]}</th>)}<th>Prioridade</th></tr></thead>
          <tbody>
            {data.subjects.slice(0, 80).map((s: any) => (
              <tr key={s.subjectId} className="cursor-pointer" onClick={() => onOpen(s.subjectId)}>
                <td className="tabular text-slate-400">{s.rank}</td>
                <td className="font-medium text-slate-900">{s.name}</td>
                {exams.map((e) => {
                  const pe = s.perExam.find((p: any) => p.editionId === e.editionId);
                  return <td key={e.editionId} className="text-center">{pe?.level ? <span title={`${pct(pe.percentage)} · ${pe.questions} questões`} className="text-xs">{LV[pe.level]} <span className="text-slate-400">{pct(pe.percentage)}</span></span> : <span className="text-slate-300">—</span>}</td>;
                })}
                <td><Badge tone={LEVEL_TONE[s.level]}>{s.levelLabel}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.subjects.length > 80 && <p className="mt-2 text-xs text-slate-500">Mostrando os 80 primeiros de {data.subjects.length}. <Link className="text-brand-600" to="/planner">Veja todos na aba Assuntos.</Link></p>}
      <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><ChevronRight className="h-3 w-3" /> Clique em um assunto para ver a explicação.</p>
    </Card>
  );
}

