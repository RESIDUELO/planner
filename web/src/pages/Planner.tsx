import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ChevronLeft, ChevronRight, Plus, Search, SlidersHorizontal, Timer } from 'lucide-react';
import { clsx } from 'clsx';
import { api, errorMessage } from '../lib/api';
import { daysBetween, pct, relativeDays, shortDate, todayBR } from '../lib/format';
import { areaShort, tintFor } from '../lib/areas';
import { usePomodoro } from '../lib/pomodoro';
import { useWide } from '../lib/zoom';
import { IS_LOCAL } from '../lib/platform';
import { allEvents, nearest, useResidencies } from '../lib/residency';
import type { ResidencyEvent } from '../../../shared/residency';
import { DeadlineLine, TypeDot } from '../components/Residencies';
import { Advanced, Button, CheckButton, CheckCircle, Eyebrow, Field, Hint, Menu, Note, Segmented, Sheet, Spinner, Tint, Title, Toggle } from '../components/ui';
import { AgendaRow, TaskEditor } from '../components/Agenda';
import { AddSubjectSheet } from '../components/AddSubject';
import { longDate, usePlannerTasks, weekdayLong, type AgendaTask } from '../lib/agenda';
import { PerformanceStrip, SubjectLibrary } from '../components/Workspace';
import { MonthCalendar, monthStart } from '../components/MonthCalendar';
import { SubjectModal, useInvalidateStudy } from '../components/SubjectModal';
import { SubjectActionsProvider, useSubjectActions, type Target } from '../components/SubjectActions';
import { finePointer, SwipeRow, usePageSwipe } from '../components/Gestures';
import { toast } from '../lib/toast';
import { useWidgets } from '../lib/widgets';
import { CustomizeSheet } from '../components/Customize';
import { addDays, weekday } from '../../../shared/dates';

export function PlannerPage() {
  const q = useQuery({ queryKey: ['planner'], queryFn: () => api.get('/api/planner') });
  const { user } = useAuth();
  const [setup, setSetup] = useState(false);
  if (q.isLoading) return <Spinner />;
  return (
    <>
      {/* Primeira vez: escolher uma prova (cronograma automático) ou montar do zero, à mão */}
      {setup || !q.data?.plan
        ? <PlannerSetup onDone={() => setSetup(false)} canCancel={!!q.data?.plan} />
        : <PlannerView data={q.data} onReconfigure={() => setSetup(true)} />}
      {user?.isGuest && (
        <p className="mx-auto mt-20 max-w-3xl text-[13px] text-ink-3">
          Você está no modo visitante. <Link to="/configuracoes" className="text-ink underline underline-offset-4">Crie uma conta</Link> para acessar de outros dispositivos.
        </p>
      )}
    </>
  );
}

// ============================================================================
// Começar - uma pergunta por vez: provas → data de início → como estuda
// ============================================================================

export const REVIEW_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];

type SetupStep = 'exams' | 'start' | 'methods';
const STEP_OUT_MS = 220;

function PlannerSetup({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }) {
  const qc = useQueryClient();
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api.get<any[]>('/api/exams') });
  const settings = useQuery({ queryKey: ['study-settings'], queryFn: () => api.get('/api/me/study-settings') });
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<any[]>('/api/templates') });
  const [tplId, setTplId] = useState<string | null>(null);
  const [sel, setSel] = useState<string[] | null>(null);
  const [primary, setPrimary] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [methods, setMethods] = useState<any[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<SetupStep>('exams');
  // "Continuar sem escolher uma prova": planner montado à mão
  const [manual, setManual] = useState(false);
  // A etapa atual sai (fade) e a próxima entra no mesmo lugar
  const [leaving, setLeaving] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const go = (next: SetupStep) => {
    setError(null);
    setLeaving(true);
    window.setTimeout(() => {
      setStep(next);
      setLeaving(false);
      top.current?.scrollIntoView({ block: 'nearest' });
    }, STEP_OUT_MS);
  };

  useEffect(() => {
    if (exams.data && sel === null) {
      const s = exams.data.filter((e) => e.selected);
      setSel(s.map((e) => e.edition_id));
      setPrimary(s.find((e) => e.is_primary)?.edition_id ?? s[0]?.edition_id ?? null);
    }
  }, [exams.data]);
  useEffect(() => {
    if (settings.data && !profile) {
      // Reconfigurando: o planner novo não começa numa data que já passou
      const saved = settings.data.profile.configured ? settings.data.profile.start_date : null;
      setProfile({ ...settings.data.profile, start_date: saved && saved > todayBR() ? saved : todayBR() });
      setMethods(settings.data.methods.map((m: any) => ({ ...m, enabled: m.configured ? m.enabled : ['video', 'flashcards'].includes(m.code), minutes: m.estimated_minutes })));
    }
  }, [settings.data]);

  const generate = useMutation({
    mutationFn: async () => {
      if (!manual) {
        for (const e of chosen) {
          if (!e.date_official && dates[e.edition_id] && dates[e.edition_id] !== e.exam_date) await api.put(`/api/me/editions/${e.edition_id}`, { examDate: dates[e.edition_id], keepPlanner: true });
        }
      }
      await api.put('/api/me/study-settings', {
        profile: {
          ...profile, daily_hours: Number(profile.daily_hours), study_days_per_week: Number(profile.study_days_per_week),
          questions_per_day: Number(profile.questions_per_day), reviews_per_day: Number(profile.reviews_per_day ?? 2),
          preferred_start_time: profile.preferred_start_time?.slice(0, 5) || null, preferred_end_time: profile.preferred_end_time?.slice(0, 5) || null,
        },
        methods: methods.map((m) => ({ id: m.id, enabled: m.enabled, minutes: Number(m.minutes) })),
      });
      if (manual) return api.post('/api/planner/manual', { startDate: profile.start_date });
      if (tplId) return api.post('/api/planner/generate-template', { templateId: tplId, editionIds: chosen.map((e) => e.edition_id), primaryEditionId: primary });
      return api.post('/api/planner/generate', { editionIds: sel, primaryEditionId: primary, startDate: profile.start_date });
    },
    onSuccess: () => { qc.invalidateQueries(); onDone(); },
    onError: (e) => setError(errorMessage(e)),
  });

  if (exams.isLoading || settings.isLoading || !profile || sel === null) return <Spinner />;
  const tpls = templates.data ?? [];
  // Com o cronograma pessoal, a prova dele já vem nele: as outras são opcionais
  const tpl = tpls.find((t: any) => t.id === tplId) ?? null;
  const tplEdition = tpl?.examEditionId ?? null;
  const available = (exams.data ?? []).filter((e) => (e.days_left == null || e.days_left > 0) && e.edition_id !== tplEdition);
  const chosen = available.filter((e) => sel.includes(e.edition_id));
  const dateOf = (e: any) => (e.date_official ? e.exam_date : dates[e.edition_id] ?? e.exam_date ?? '');
  const missingDate = chosen.some((e) => !dateOf(e) || dateOf(e) <= todayBR());
  const enabledMethods = methods.filter((m) => m.enabled);
  const examsReady = tplId ? !missingDate : chosen.length > 0 && !!primary && !missingDate;
  const startReady = !!tplId || (!!profile.start_date && profile.start_date >= todayBR());
  const ready = enabledMethods.length > 0 && Number(profile.daily_hours) > 0;
  const stepIndex = step === 'exams' ? 0 : step === 'start' ? 1 : 2;

  const toggleExam = (id: string) => {
    const on = sel.includes(id);
    const next = on ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    if (!next.includes(primary ?? '')) setPrimary(next[0] ?? null);
    if (!primary && !on) setPrimary(id);
  };

  return (
    <div className="mx-auto max-w-2xl" ref={top}>
      <Title eyebrow="Seu planner começa aqui" trailing={canCancel ? <Button variant="plain" size="sm" onClick={onDone}>Cancelar</Button> : undefined}>Planner</Title>

      <div className="-mt-4 mb-10 flex items-center gap-4">
        <span className="sr-only">Etapa {stepIndex + 1} de 3</span>
        <span className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className={clsx('h-1.5 rounded-full transition-all duration-300 ease-apple', i === stepIndex ? 'w-6 bg-ink' : i < stepIndex ? 'w-1.5 bg-ink' : 'w-1.5 bg-line')} />
          ))}
        </span>
        {step !== 'exams' && (
          <button type="button" onClick={() => go(step === 'methods' ? 'start' : 'exams')} className="text-[13px] text-ink-3 transition hover:text-ink">
            Voltar
          </button>
        )}
      </div>

      <div key={step} className={clsx(leaving ? 'rp-step-out' : 'rp-step-in')} data-testid={`setup-${step}`}>
        {step === 'exams' && (
          <section aria-label="Provas">
            <StepQuestion>Quais provas você quer fazer?</StepQuestion>

            {tpls.length > 0 && (
              <div className="mt-6">
                <span className="font-display text-[20px] italic text-ink-2">Só para você</span>
                <div className="mt-2 border-t border-line">
                  {tpls.map((t: any) => (
                    <label key={t.id} className="flex cursor-pointer items-center gap-4 border-b border-line py-4">
                      <input type="checkbox" className="sr-only" checked={tplId === t.id} aria-label={`Usar ${t.name}`}
                        onChange={() => setTplId(tplId === t.id ? null : t.id)} />
                      <CheckCircle on={tplId === t.id} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-[24px] leading-tight">{t.name}</span>
                        <span className="block text-[13px] text-ink-2">{t.lessons} aulas a partir de {shortDate(t.startDate, false)} · {t.studied} temas já estudados · prova em {shortDate(t.examDate)}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-[13px] text-ink-3">{IS_LOCAL ? '' : 'Visível só para administradores. '}Segue as datas do seu cronograma; o que você já estudou entra como concluído.</p>
              </div>
            )}

            {tpls.length > 0 && <span className="mt-8 block font-display text-[20px] italic text-ink-2">{tplId ? 'Junto com o cronograma' : 'Provas'}</span>}
            {tplId && <p className="mt-1 text-[14px] text-ink-2">Opcional. O cronograma vem primeiro, nas datas dele; os assuntos das provas marcadas aqui entram no tempo que sobra e, depois dele, até a data de cada prova.</p>}
            {available.length === 0 ? <p className="mt-4 text-[17px] text-ink-2">Ainda não há provas disponíveis.</p> : (
              <div className={clsx('border-t border-line', tpls.length ? 'mt-2' : 'mt-6')}>
                {available.map((e) => {
                  const on = sel.includes(e.edition_id);
                  return (
                    <div key={e.edition_id} className="border-b border-line py-4">
                      <label className="flex cursor-pointer items-center gap-4">
                        <input type="checkbox" className="sr-only" checked={on} aria-label={`Selecionar ${e.institution}`} onChange={() => toggleExam(e.edition_id)} />
                        <CheckCircle on={on} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-[24px] leading-tight">{e.institution}</span>
                          <span className="block text-[13px] text-ink-2">{e.exam_name}</span>
                        </span>
                        {e.date_official && <span className="shrink-0 text-right text-[14px]">{shortDate(e.exam_date)}<span className="block text-[11px] text-ink-3">data oficial</span></span>}
                      </label>
                      {on && (!e.date_official || chosen.length > 1) && (
                        <div className="mt-3 ml-10 flex flex-wrap items-end gap-x-6 gap-y-3 animate-in">
                          {!e.date_official && (
                            <Field label="Data da prova" className="w-44">
                              <input type="date" className="field" aria-label={`Data da prova - ${e.institution}`} min={todayBR()}
                                value={dateOf(e)} onChange={(ev) => setDates({ ...dates, [e.edition_id]: ev.target.value })} />
                            </Field>
                          )}
                          {chosen.length > 1 && (
                            <label className="flex items-center gap-2 pb-2.5 text-[14px] text-ink-2">
                              <input type="radio" name="primary" className="accent-[var(--ink)]" checked={primary === e.edition_id} onChange={() => setPrimary(e.edition_id)} /> Principal
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!tplId && chosen.some((e) => e.history.sufficiency === 'insufficient' || e.history.sufficiency === 'none') && (
              <Note className="mt-8">Algumas provas têm poucos dados históricos: {chosen.filter((e) => !['good', 'limited'].includes(e.history.sufficiency)).map((e) => `${e.institution} (${e.history.message})`).join('; ')}</Note>
            )}
            <StepActions>
              <Button size="lg" disabled={!examsReady} onClick={() => { setManual(false); go('start'); }}>Confirmar</Button>
              {(chosen.length > 0 || tplId) && missingDate && <p className="mt-3 text-[13px] text-ink-3">Informe a data da prova para continuar.</p>}
              {!canCancel && (
                <button type="button" data-testid="scratch" onClick={() => { setManual(true); setTplId(null); go('start'); }}
                  className="mt-6 block text-[14px] text-ink-2 underline decoration-line underline-offset-4 transition hover:text-ink hover:decoration-ink">
                  Continuar sem escolher uma prova
                </button>
              )}
            </StepActions>
          </section>
        )}

        {step === 'start' && (
          <section aria-label="Início">
            <StepQuestion>Quando você quer começar?</StepQuestion>
            {tplId && !manual ? (
              <p className="mt-6 text-[17px] text-ink-2">Em {shortDate(tpl?.startDate, false)}, na primeira aula do seu cronograma.</p>
            ) : (
              <Field label="Data de início" className="mt-6 w-52">
                <input type="date" className="field" aria-label="Data de início" min={todayBR()} value={profile.start_date ?? ''}
                  onChange={(e) => setProfile({ ...profile, start_date: e.target.value })} />
              </Field>
            )}
            <StepActions>
              <Button size="lg" disabled={!startReady} onClick={() => go('methods')}>Confirmar</Button>
            </StepActions>
          </section>
        )}

        {step === 'methods' && (
          <section aria-label="Como estudar">
            <StepQuestion>Como você quer estudar?</StepQuestion>
            <p className="mt-2 text-[14px] text-ink-2">Um assunto fica concluído quando você faz tudo o que marcou aqui.</p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              {methods.map((m, i) => (
                <label key={m.id} className={clsx('cursor-pointer rounded-full border px-4 py-2 text-[15px] transition select-none',
                  m.enabled ? 'border-ink bg-ink text-canvas' : 'border-line text-ink hover:border-ink')}>
                  <input type="checkbox" className="sr-only" checked={m.enabled} aria-label={m.name}
                    onChange={(e) => setMethods(methods.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
                  {m.name}
                </label>
              ))}
            </div>

            <Advanced className="mt-10 border-t border-line pt-5">
              <div className="space-y-8">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Horas por dia">
                    <input type="number" min={0.5} max={16} step={0.5} className="field" value={profile.daily_hours} onChange={(e) => setProfile({ ...profile, daily_hours: e.target.value })} />
                  </Field>
                  <Field label="Revisões por dia">
                    <select className="field" aria-label="Revisões por dia" value={profile.reviews_per_day ?? 2} onChange={(e) => setProfile({ ...profile, reviews_per_day: Number(e.target.value) })}>
                      {REVIEW_OPTIONS.map((n) => <option key={n} value={n}>até {n}</option>)}
                    </select>
                  </Field>
                  <Field label="Questões por dia">
                    <input type="number" min={0} max={500} className="field" value={profile.questions_per_day} onChange={(e) => setProfile({ ...profile, questions_per_day: e.target.value })} />
                  </Field>
                  <Field label="Dias de estudo por semana">
                    <input type="number" min={1} max={7} className="field" value={profile.study_days_per_week} onChange={(e) => setProfile({ ...profile, study_days_per_week: e.target.value })} />
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
                            <input type="number" min={5} max={600} className="field w-20 text-right" aria-label={`Minutos - ${m.name}`} value={m.minutes}
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
            <StepActions>
              <Button size="lg" disabled={!ready} loading={generate.isPending} onClick={() => { setError(null); generate.mutate(); }}>Confirmar</Button>
              {enabledMethods.length === 0 && <p className="mt-3 text-[13px] text-ink-3">Escolha ao menos um jeito de estudar.</p>}
            </StepActions>
          </section>
        )}
      </div>
    </div>
  );
}

function StepQuestion({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-[32px] leading-tight tracking-[-0.01em]">{children}</h2>;
}

function StepActions({ children }: { children: ReactNode }) {
  return <div className="mt-10">{children}</div>;
}

// ============================================================================
// Planner - semana editorial: assuntos | revisões
// ============================================================================

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));

function PlannerView({ data, onReconfigure }: { data: any; onReconfigure: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'about' | 'subjects' | 'multi' | 'reconfigure' | 'customize'>(null);
  const w = useWidgets();
  const qc = useQueryClient();
  const replan = useMutation({ mutationFn: () => api.post('/api/planner/replan'), onSuccess: () => qc.invalidateQueries() });
  const exam = data.exams.find((e: any) => e.is_primary) ?? data.exams[0];
  const left = exam?.exam_date ? daysBetween(exam.exam_date, todayBR()) : null;
  const [adding, setAdding] = useState<string | null>(null);
  // Dia escolhido no calendário ao lado: a semana (ou o dia) vai até ele
  const [jump, setJump] = useState({ date: todayBR(), n: 0 });
  // Sem prova: planner montado à mão (a prova e o cronograma automático são opcionais)
  const noExam = !data.exams.length;
  const eyebrow: ReactNode = noExam
    ? 'Meu planner'
    : data.plan.summary?.template
    ? `${data.plan.name} · ${shortDate(exam?.exam_date)}${left != null && left > 0 ? ` · faltam ${left} dias` : ''}`
    : exam?.exam_date ? `${exam.institution} · ${shortDate(exam.exam_date)}${left != null && left > 0 ? ` · faltam ${left} dias` : ''}` : data.plan.name.replace(/^Planner /, '');
  const dnd = useDnd();
  const menu = (
    <Menu items={[
      { label: 'Reorganizar a partir de hoje', onClick: () => replan.mutate(), hidden: noExam },
      { label: 'Todos os assuntos', onClick: () => setSheet('subjects'), hidden: !data.subjects.length },
      { label: 'Tabela combinada das provas', onClick: () => setSheet('multi'), hidden: data.exams.length < 2 },
      { label: 'Escolher prova para montar cronograma', onClick: onReconfigure, hidden: !noExam },
      { label: 'Personalizar', onClick: () => setSheet('customize') },
      { label: 'Sobre este plano', onClick: () => setSheet('about'), hidden: noExam },
    ]} />
  );
  // Reconfigurar à vista no topo; antes, um aviso (para um clique sem querer não refazer o planner)
  const actions = (
    <>
      {!noExam && (
        <button type="button" onClick={() => setSheet('reconfigure')} data-testid="reconfigure" aria-label="Reconfigurar planner"
          className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] font-medium tracking-[0.16em] text-ink-2 uppercase transition hover:border-ink hover:text-ink">
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="hidden sm:inline">Reconfigurar</span>
        </button>
      )}
      {menu}
    </>
  );

  // Coluna ao lado da semana: some quando tudo dela foi escondido em "Personalizar"
  const aside = w.library || w.calendar || w.performance || noExam;
  // Tela larga (computador, tablet ou celular deitados): tudo cabe na tela, sem rolagem da página
  const desktop = useWide();
  useEffect(() => {
    document.documentElement.classList.add('rp-fit');
    return () => document.documentElement.classList.remove('rp-fit');
  }, []);

  return (
    <SubjectActionsProvider data={data} dnd={dnd} onOpen={setOpen}>
    <div className={clsx('grid gap-14 fit:h-[calc(var(--app-h,100dvh)-var(--chrome-h))] fit:grid-rows-[minmax(0,1fr)] fit:gap-10', aside && 'fit:grid-cols-[minmax(0,1fr)_300px]')}>
      <section aria-label="Semana" className="min-w-0 fit:flex fit:min-h-0 fit:flex-col">
        <WeekView onOpen={setOpen} onReplan={() => replan.mutate()} replanning={replan.isPending} dnd={dnd} eyebrow={eyebrow} menu={actions} desktop={desktop} onAdd={setAdding} jump={jump} />
      </section>
      {aside && <aside aria-label="Estudo" className="no-scrollbar min-w-0 space-y-12 fit:flex fit:min-h-0 fit:flex-col fit:gap-10 fit:space-y-0 fit:overflow-y-auto">
        {(w.library || noExam) && <SubjectLibrary data={data} dnd={dnd} onOpen={setOpen} onAll={() => setSheet('subjects')} fit={desktop} />}
        {noExam && (
          <button onClick={onReconfigure} data-testid="choose-exam"
            className="-mt-8 block shrink-0 text-left text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink fit:-mt-7">
            Escolher prova para montar cronograma
          </button>
        )}
        {w.calendar && <PlannerCalendar dnd={dnd} picked={jump.date} onPick={(date) => setJump({ date, n: jump.n + 1 })} />}
        {w.performance && <PerformanceStrip />}
      </aside>}

      {sheet === 'about' && <AboutPlan data={data} onClose={() => setSheet(null)} />}
      {sheet === 'customize' && <CustomizeSheet onClose={() => setSheet(null)} />}
      {sheet === 'reconfigure' && (
        <Sheet open onClose={() => setSheet(null)} title="Reconfigurar o planner?">
          <p className="text-[16px] text-ink-2">Você vai escolher de novo as provas, a data de início e como estuda, e o cronograma é montado outra vez a partir disso.</p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-[15px] text-ink-2">
            <li><span className="text-ink">Continuam:</span> o que você já estudou, as revisões, as questões registradas e os assuntos que você criou.</li>
            <li><span className="text-ink">Mudam:</span> as datas das aulas, inclusive as que você arrastou para outro dia.</li>
          </ul>
          <p className="mt-4 text-[15px] text-ink-2">Nada muda até você confirmar a última etapa; dá para cancelar no caminho.</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Button onClick={() => { setSheet(null); onReconfigure(); }}>Reconfigurar</Button>
            <Button variant="plain" onClick={() => setSheet(null)}>Manter como está</Button>
          </div>
        </Sheet>
      )}
      {sheet === 'subjects' && <Sheet open onClose={() => setSheet(null)} wide title="Assuntos"><SubjectList data={data} onOpen={(id) => { setSheet(null); setOpen(id); }} /></Sheet>}
      {sheet === 'multi' && <Sheet open onClose={() => setSheet(null)} wide title="Tabela combinada"><MultiTable data={data} onOpen={(id) => { setSheet(null); setOpen(id); }} /></Sheet>}
      {open && <SubjectModal subjectId={open} onClose={() => setOpen(null)} />}
      {adding && <AddSubjectSheet date={adding} data={data} onClose={() => setAdding(null)} />}
    </div>
    </SubjectActionsProvider>
  );
}

/** Calendário do mês (igual ao da Agenda): escolhe o dia e recebe aulas, revisões e assuntos arrastados. */
function PlannerCalendar({ dnd, picked, onPick }: { dnd: DnD; picked: string; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(monthStart(picked));
  useEffect(() => setMonth(monthStart(picked)), [picked]);
  const cell = (d: string) => {
    const ok = !!dnd.drag && d >= dnd.today && d !== dnd.drag.from;
    const key = `cal|${d}`;
    return {
      props: {
        'data-drop': ok ? 'on' : undefined,
        onDragOver: (e: React.DragEvent) => { if (!ok) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dnd.over !== key) dnd.setOver(key); },
        onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) dnd.setOver(null); },
        onDrop: (e: React.DragEvent) => { e.preventDefault(); if (ok) dnd.drop(d); },
      },
      circle: ok && dnd.over === key ? 'bg-fill ring-1 ring-ink' : undefined,
    };
  };
  return (
    <div className="shrink-0 animate-in" data-testid="planner-calendar">
      <MonthCalendar month={month} day={picked} today={dnd.today} onPick={onPick} onMonth={setMonth} cell={cell} />
    </div>
  );
}

/** Estado do arrastar, compartilhado entre a semana e a lista de assuntos. */
function useDnd(): DnD {
  const today = todayBR();
  const invalidate = useInvalidateStudy();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: ({ d, to }: { d: Drag; to: string; undo?: boolean }) => (d.type === 'library'
      ? api.post(`/api/planner/subjects/${d.subjectId}/schedule`, { to })
      : d.type === 'task'
        ? api.post(`/api/planner/subjects/${d.subjectId}/move`, { from: d.from, to, methodIds: d.methodIds })
        : api.post(`/api/reviews/${d.subjectId}/move`, { to })),
    // A tela muda na hora; o servidor confirma depois (e, se falhar, volta como estava)
    onMutate: async ({ d, to, undo }) => {
      await qc.cancelQueries({ queryKey: ['week'] });
      const before = qc.getQueriesData({ queryKey: ['week'] });
      const planner: any = qc.getQueryData(['planner']);
      qc.setQueriesData({ queryKey: ['week'] }, (old: any) => (old?.days ? { ...old, days: moveInWeek(old.days, d, to, planner) } : old));
      const where = `${WD[weekday(to)].toLowerCase()}, ${shortDate(to, false)}`;
      // Desfazer: volta para o dia de onde saiu (se ainda dá: hoje ou depois)
      const back = !undo && d.type !== 'library' && d.from >= today;
      if (undo) toast(`${d.name} de volta para ${where}`);
      else toast(`✓ ${d.name} ${d.type === 'review' ? 'revisão movida para' : 'adicionado a'} ${where}`,
        back ? { action: { label: 'Desfazer', onClick: () => move.mutate({ d: { ...d, from: to }, to: d.from, undo: true }) } } : {});
      return { before };
    },
    onError: (e, _v, c) => {
      c?.before.forEach(([k, v]) => qc.setQueryData(k, v));
      toast(errorMessage(e), { tone: 'negative' });
    },
    onSettled: invalidate,
  });
  return {
    drag, over, setOver, today, busy: false,
    send: (d, to) => move.mutate({ d, to }),
    start: (d) => setDrag(d),
    end: () => { setDrag(null); setOver(null); },
    drop: (to) => { if (drag) move.mutate({ d: drag, to }); setDrag(null); setOver(null); },
  };
}

/** Aplica o arrastar na semana já carregada, do mesmo jeito que o servidor fará. */
function moveInWeek(days: any[], d: Drag, to: string, planner: any): any[] {
  const out = days.map((x) => ({ ...x, newSubjects: [...x.newSubjects], reviews: [...x.reviews] }));
  const dayOf = (date: string) => out.find((x) => x.date === date);
  if (d.type === 'review') {
    let item: any = null;
    for (const x of out) {
      const i = x.reviews.findIndex((r: any) => r.subjectId === d.subjectId && r.status !== 'done');
      if (i >= 0 && !item) { item = x.reviews[i]; x.reviews.splice(i, 1); }
    }
    const target = dayOf(to);
    if (target) target.reviews.push({ ...(item ?? { subjectId: d.subjectId, name: d.name }), status: 'scheduled' });
    return out;
  }
  // Aulas: tira do(s) dia(s) de origem as atividades que mudam de dia
  const methods: { id: string; name: string }[] = [];
  let base: any = null;
  const take = (x: any, ids?: string[]) => {
    x.newSubjects = x.newSubjects.flatMap((n: any) => {
      if (n.subjectId !== d.subjectId || n.done) return [n];
      base ??= n;
      const moving = n.methodIds.map((id: string, i: number) => ({ id, name: n.methods[i] })).filter((m: any) => !ids || ids.includes(m.id));
      methods.push(...moving.filter((m: any) => !methods.some((y) => y.id === m.id)));
      const keep = n.methodIds.map((id: string, i: number) => ({ id, name: n.methods[i] })).filter((m: any) => !moving.some((y: any) => y.id === m.id));
      return keep.length ? [{ ...n, methodIds: keep.map((m: any) => m.id), methods: keep.map((m: any) => m.name) }] : [];
    });
  };
  if (d.type === 'task') { const x = dayOf(d.from); if (x) take(x, d.methodIds); } else out.forEach((x) => take(x));
  if (d.type === 'library') {
    // Leva todas as atividades que faltam, mesmo as que estão fora desta semana
    const s = planner?.subjects?.find((y: any) => y.subjectId === d.subjectId);
    for (const c of s?.checklist ?? []) if (!c.done && !methods.some((m) => m.id === c.methodId)) methods.push({ id: c.methodId, name: c.name });
    base ??= s && { subjectId: s.subjectId, name: s.name, area: s.area, rank: 999, studied: false, progress: s.progress, totalActivities: s.checklist.length };
  }
  const target = dayOf(to);
  if (!target || !methods.length) return out;
  const i = target.newSubjects.findIndex((n: any) => n.subjectId === d.subjectId && !n.done);
  if (i >= 0) {
    const n = target.newSubjects[i];
    const add = methods.filter((m) => !n.methodIds.includes(m.id));
    target.newSubjects[i] = { ...n, methodIds: [...n.methodIds, ...add.map((m) => m.id)], methods: [...n.methods, ...add.map((m) => m.name)] };
  } else {
    target.newSubjects.push({ ...(base ?? { subjectId: d.subjectId, name: d.name }), date: to, done: false, doneAt: null, methodIds: methods.map((m) => m.id), methods: methods.map((m) => m.name) });
  }
  return out;
}

/** Marca/desmarca as atividades daquele dia (ou o assunto inteiro). O servidor reorganiza a fila. */
export function useCheck() {
  const invalidate = useInvalidateStudy();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ subjectId, methodIds, done }: { subjectId: string; methodIds?: string[]; done: boolean }) => {
      if (!methodIds?.length) return api.post(`/api/planner/subjects/${subjectId}/complete`, { done });
      for (const m of methodIds) await api.post(`/api/planner/subjects/${subjectId}/methods/${m}`, { done });
    },
    // O círculo marca na hora; a semana se atualiza logo depois com a resposta
    onMutate: ({ subjectId, methodIds, done }) => {
      const same = (ids?: string[]) => !methodIds?.length || (ids?.length === methodIds.length && ids.every((x) => methodIds.includes(x)));
      qc.setQueriesData({ queryKey: ['week'] }, (old: any) => old?.days ? {
        ...old, days: old.days.map((d: any) => ({ ...d, newSubjects: d.newSubjects.map((n: any) => (n.subjectId === subjectId && same(n.methodIds) ? { ...n, done } : n)) })),
      } : old);
    },
    onSettled: invalidate,
  });
}

/** ✓ Revisão feita (lembrou bem). Outras respostas ficam na folha do assunto. */
export function useReviewDone() {
  const invalidate = useInvalidateStudy();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subjectId: string) => api.post(`/api/reviews/${subjectId}`, { rating: 'good' }),
    onMutate: (subjectId) => {
      qc.setQueriesData({ queryKey: ['week'] }, (old: any) => old?.days ? {
        ...old, days: old.days.map((d: any) => ({ ...d, reviews: d.reviews.map((r: any) => (r.subjectId === subjectId && r.status !== 'done' && d.date <= todayBR() ? { ...r, status: 'done' } : r)) })),
      } : old);
    },
    onSettled: invalidate,
  });
}

function WeekView({ onOpen, onReplan, replanning, dnd, eyebrow, menu, desktop, onAdd, jump }: { onOpen: (id: string) => void; onReplan: () => void; replanning: boolean; dnd: DnD; eyebrow: ReactNode; menu: ReactNode; desktop?: boolean; onAdd: (date: string) => void; jump: { date: string; n: number } }) {
  const today = todayBR();
  // DIA | SEMANA: a mesma semana (mesmos dados), vista um dia por vez ou inteira
  const [mode, setModeState] = useState<ViewMode>(() => { try { return localStorage.getItem(VIEW_KEY) === 'dia' ? 'dia' : 'semana'; } catch { return 'semana'; } });
  const [weekFrom, setFrom] = useState(mondayOf(today));
  const [day, setDay] = useState(today);
  const single = mode === 'dia';
  const from = single ? mondayOf(day) : weekFrom;
  const setMode = (m: ViewMode) => {
    if (m === mode) return;
    if (m === 'dia') setDay(weekFrom === mondayOf(today) ? today : weekFrom);
    else setFrom(mondayOf(day));
    setModeState(m);
    try { localStorage.setItem(VIEW_KEY, m); } catch { /* ignore */ }
  };
  useEffect(() => { if (jump.n) { setDay(jump.date); setFrom(mondayOf(jump.date)); } }, [jump.n]);
  const to = addDays(from, 6);
  const week = useQuery({ queryKey: ['week', from], queryFn: () => api.get(`/api/reviews/calendar?from=${from}&to=${to}`) });
  const t = useQuery({ queryKey: ['today'], queryFn: () => api.get('/api/planner/today') });
  // Tarefas da agenda com "Mostrar no Planner" (continuam sendo da agenda)
  const agenda = usePlannerTasks(from);
  const [task, setTask] = useState<AgendaTask | null>(null);
  const agendaOn = (d: string) => (agenda.data ?? []).filter((x) => x.date === d);
  const check = useCheck();
  const reviewDone = useReviewDone();
  const isThisWeek = from === mondayOf(today);
  const late = (single ? day === today : isThisWeek) ? (t.data?.newSubjects ?? []).filter((s: any) => s.overdue) : [];
  const [a, b] = [from, to].map((d) => d.split('-').map(Number));
  const range = a[1] === b[1] ? `${a[2]} - ${b[2]} ${MONTHS[b[1] - 1]}` : `${a[2]} ${MONTHS[a[1] - 1]} - ${b[2]} ${MONTHS[b[1] - 1]}`;

  const actions = useSubjectActions();
  const widgets = useWidgets();
  // Semana (ou dia) anterior/seguinte: botões, deslizar, trackpad e ← →
  const page = (dir: 1 | -1) => (single ? setDay(addDays(day, dir)) : setFrom(addDays(from, 7 * dir)));
  const swipe = usePageSwipe(page);
  const onCheck = (item: any, done: boolean) => (actions
    ? actions.complete({ kind: 'task', subjectId: item.subjectId, name: item.name, methodIds: item.methodIds }, done)
    : check.mutate({ subjectId: item.subjectId, methodIds: item.methodIds, done }));
  const onReview = (r: any) => (actions ? actions.complete({ kind: 'review', subjectId: r.subjectId, name: r.name }, true) : reviewDone.mutate(r.subjectId));
  const busy = check.isPending || reviewDone.isPending || dnd.busy;

  // Desktop: o cabeçalho fica fixo e os dias rolam por dentro (sem barra visível)
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!desktop || !el || week.isLoading) return;
    const t = el.querySelector<HTMLElement>(`[data-testid="day-${today}"]`);
    // Abre em hoje (se não houver atrasados para mostrar no topo)
    el.scrollTop = !single && isThisWeek && t && !late.length ? Math.max(0, t.offsetTop - 8) : 0;
  }, [desktop, from, week.isLoading, single, day]);
  // Prazo mais próximo das residências (linha discreta sob o título)
  const residencies = useResidencies();
  const deadline = nearest(residencies.data, today);
  const resOn = (date: string) => allEvents(residencies.data).filter((e) => e.date === date);
  // Ainda sem planner: a semana aparece vazia, pronta para receber assuntos
  const days = week.data?.days ?? Array.from({ length: 7 }, (_, i) => ({ date: addDays(from, i), reviews: [], newSubjects: [], exams: [] }));
  const shown = days.filter((d: any) => !single || d.date === day);

  return (
    <div ref={swipe.ref} className={clsx(desktop && 'flex min-h-0 flex-1 flex-col')}>
      <div className="flex items-start justify-between gap-4">
        <Eyebrow className="min-w-0 truncate">{eyebrow}</Eyebrow>
        <div className="-mt-2 flex shrink-0 items-center gap-4">
          <Segmented value={mode} onChange={setMode} className="[&>button]:py-0 [&>button]:text-[12px] [&>button]:font-medium [&>button]:tracking-[0.16em] [&>button]:uppercase"
            options={[{ value: 'dia', label: 'Dia' }, { value: 'semana', label: 'Semana' }]} />
          {menu}
        </div>
      </div>
      <div className={clsx('mt-3 flex items-center justify-between gap-3', desktop ? 'mb-10 shrink-0' : 'mb-10')}>
        <button onClick={() => page(-1)} aria-label={single ? 'Dia anterior' : 'Semana anterior'}
          className="flex items-center gap-1.5 rounded-full py-1.5 pr-2 text-[13px] text-ink-2 transition hover:text-ink">
          <ChevronLeft className="h-5 w-5" strokeWidth={1.5} /><span className="hidden sm:inline">{single ? 'dia anterior' : 'semana anterior'}</span>
        </button>
        <div key={swipe.content.key} className={clsx('text-center', swipe.content.className)} style={swipe.content.style}>
          {single && <div className={clsx('mb-2 text-[11px] font-medium tracking-[0.16em] uppercase', day === today ? 'text-today' : 'text-ink-2')}>{weekdayLong(day)}{day === today && ' · hoje'}</div>}
          <h1 className="font-display text-[40px] leading-none sm:text-[52px]">{single ? longDate(day) : range}</h1>
          {single
            ? day !== today && <button onClick={() => setDay(today)} className="mt-2 text-[12px] text-ink-2 underline underline-offset-4 hover:text-ink">voltar para hoje</button>
            : !isThisWeek && <button onClick={() => setFrom(mondayOf(today))} className="mt-2 text-[12px] text-ink-2 underline underline-offset-4 hover:text-ink">voltar para esta semana</button>}
        </div>
        <button onClick={() => page(1)} aria-label={single ? 'Próximo dia' : 'Próxima semana'}
          className="flex items-center gap-1.5 rounded-full py-1.5 pl-2 text-[13px] text-ink-2 transition hover:text-ink">
          <span className="hidden sm:inline">{single ? 'dia seguinte' : 'semana seguinte'}</span><ChevronRight className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>
      <div className={clsx('-mt-6 min-h-5 text-center text-[13px]', desktop ? 'mb-5 shrink-0' : 'mb-8')} aria-live="polite">
        {deadline ? <DeadlineLine e={deadline} today={today} />
          : <span className="hidden text-ink-3 md:inline">Arraste aulas, revisões ou assuntos da lista para qualquer dia. Botão direito: mais ações.</span>}
      </div>

      <div ref={scroller} data-testid="week-scroll" className={clsx(desktop && 'no-scrollbar fade-scroll relative -mx-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-10')}>
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
                onCheck={(done) => onCheck({ subjectId: s.subjectId, name: s.name, methodIds: s.methods.map((m: any) => m.methodId) }, done)}
                target={{ kind: 'task', subjectId: s.subjectId, name: s.name, area: s.area, from: s.oldestDate, methodIds: s.methods.map((m: any) => m.methodId) }}
                drag={dragProps(dnd, { type: 'task', subjectId: s.subjectId, from: s.oldestDate, methodIds: s.methods.map((m: any) => m.methodId), name: s.name })} />
            ))}
          </ul>
        </section>
      )}

      {week.isLoading ? <WeekSkeleton /> : (
        <div key={swipe.content.key} className={swipe.content.className} style={swipe.content.style}>
          {shown.map((d: any) => (
            <DayBlock key={d.date} day={d} today={today} onOpen={onOpen} questions={d.date === today ? t.data?.questions : null}
              onCheck={onCheck} onReview={onReview} busy={busy} dnd={dnd}
              agenda={widgets.tasks ? agendaOn(d.date) : []} onTask={setTask} detailed={single} onAdd={onAdd} residency={resOn(d.date)} />
          ))}
        </div>
      )}

      {widgets.notes && <WeekNotes week={from} />}
      </div>
      {task && <TaskEditor key={task.id} task={task} onClose={() => setTask(null)} />}
    </div>
  );
}

/** Carregando a semana: o desenho dos dias, sem conteúdo (em vez de um spinner no meio do nada). */
function WeekSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando a semana">
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-14 animate-fade" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="flex items-baseline gap-3"><span className="h-3 w-9 rounded bg-fill" /><span className="h-9 w-10 rounded-[8px] bg-fill" /></div>
          <div className="mt-5 space-y-3 sm:pl-12">
            <div className="h-px bg-line" />
            <div className="h-4 w-2/3 rounded bg-fill" />
            <div className="h-4 w-1/2 rounded bg-fill" />
          </div>
        </div>
      ))}
    </div>
  );
}

type ViewMode = 'dia' | 'semana';
const VIEW_KEY = 'rp-planner-view';

// ---------------------------------------------------------------- Arrastar entre dias
export type Drag = { type: 'task' | 'review' | 'library'; subjectId: string; from: string; methodIds?: string[]; name: string };
export interface DnD {
  drag: Drag | null; over: string | null; today: string; busy: boolean;
  /** Move sem arrastar (menu "Mover para outro dia"). */
  send: (d: Drag, to: string) => void;
  setOver: (k: string | null) => void; start: (d: Drag) => void; end: () => void; drop: (to: string) => void;
}
interface DragProps { li: Record<string, any>; className: string }

/** Linha arrastável (o "quadrado" inteiro). */
export function dragProps(dnd: DnD, d: Drag): DragProps {
  const dragging = dnd.drag?.subjectId === d.subjectId && dnd.drag?.from === d.from && dnd.drag?.type === d.type;
  return {
    li: {
      // Com o dedo, mover é pelo toque longo (o arrastar nativo brigaria com o gesto)
      draggable: finePointer(),
      'aria-roledescription': 'arrastável',
      onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.name); dnd.start(d); },
      onDragEnd: () => dnd.end(),
    },
    className: clsx('cursor-grab active:cursor-grabbing', dragging && 'opacity-40'),
  };
}

/** Coluna que aceita a soltura: só do mesmo tipo (aula → Assuntos, revisão → Revisões), de hoje em diante. */
function dropZone(dnd: DnD, date: string, type: 'task' | 'review', extra?: string) {
  const key = `${date}|${type}`;
  // Aula (ou assunto da lista) só entra em Assuntos; revisão só em Revisões
  const kind = dnd.drag?.type === 'library' ? 'task' : dnd.drag?.type;
  const ok = !!dnd.drag && kind === type && date >= dnd.today && date !== dnd.drag.from;
  return {
    'data-drop': ok ? 'on' : undefined,
    onDragOver: (e: React.DragEvent) => { if (!ok) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dnd.over !== key) dnd.setOver(key); },
    onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) dnd.setOver(null); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); if (ok) dnd.drop(date); },
    className: clsx('-mx-3 rounded-[12px] px-3 pb-2 transition-colors duration-150', extra,
      ok && 'outline-1 outline-dashed outline-ink-3', ok && dnd.over === key && 'bg-fill outline-ink'),
  };
}

function ColumnHead({ children }: { children: string }) {
  return <div className="border-b border-ink/70 pb-1.5 text-[10.5px] font-medium tracking-[0.18em] text-ink-2 uppercase">{children}</div>;
}

function DayBlock({ day, today, onOpen, onCheck, onReview, questions, busy, dnd, agenda = [], onTask, detailed, onAdd, residency = [] }: {
  day: any; today: string; onOpen: (id: string) => void; onCheck: (item: any, done: boolean) => void; onReview: (r: any) => void; questions?: any; busy?: boolean; dnd: DnD;
  agenda?: AgendaTask[]; onTask: (t: AgendaTask) => void; detailed?: boolean; onAdd: (date: string) => void; residency?: ResidencyEvent[];
}) {
  const actions = useSubjectActions();
  const widgets = useWidgets();
  const isToday = day.date === today;
  const past = day.date < today;
  const reviews = (day.reviews as any[]).filter((r, i, arr) => arr.findIndex((x) => x.subjectId === r.subjectId) === i);
  const empty = !day.newSubjects.length && !reviews.length && !day.exams.length && !agenda.length && !residency.length;
  const count = (done: number, total: number, one: string, many: string) => (total ? `${done} de ${total} ${total === 1 ? one : many}` : `sem ${many}`);
  const tasks = agenda.filter((a) => a.kind !== 'reminder');
  if (past && empty && !detailed) return (
    <section data-testid={`day-${day.date}`} className="mb-5 flex items-baseline gap-3 text-ink-3 animate-in">
      <span className="w-9 text-[11px] font-medium tracking-[0.16em] uppercase">{WD[weekday(day.date)]}</span>
      <span className="tabular font-display text-[22px] leading-none">{Number(day.date.slice(8))}</span>
      <span className="h-px flex-1 bg-line" />
    </section>
  );
  return (
    <section data-testid={`day-${day.date}`} aria-label={isToday ? 'Hoje' : undefined} className="mb-14 animate-in">
      {detailed ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 text-[13px] text-ink-2 sm:pl-12">
          {day.exams.map((e: string) => <span key={e} className="tint tint-rose text-[13px] font-medium">Prova · {e}</span>)}
          {residency.map((e) => (
            <Link key={`${e.residencyId}-${e.stepId}-${e.edge}`} to={`/residencias?r=${e.residencyId}`} data-testid="planner-residency"
              className={clsx('inline-flex items-center gap-1.5 self-center rounded-full border border-line px-2.5 py-0.5 text-[13px] text-ink transition hover:border-ink', e.done && 'text-ink-3 line-through decoration-1')}>
              <TypeDot type={e.type} />{e.residency} - {e.label}
            </Link>
          ))}
          <span>{count(day.newSubjects.filter((n: any) => n.done).length, day.newSubjects.length, 'assunto', 'assuntos')}</span>
          <span className="text-line">·</span>
          <span>{count(reviews.filter((r) => r.status === 'done').length, reviews.length, 'revisão', 'revisões')}</span>
          {tasks.length > 0 && <><span className="text-line">·</span><span>{count(tasks.filter((a) => a.done).length, tasks.length, 'tarefa', 'tarefas')}</span></>}
        </div>
      ) : (
      <div className="flex items-baseline gap-3">
        <span className={clsx('w-9 text-[11px] font-medium tracking-[0.16em] uppercase', isToday ? 'text-today' : 'text-ink-2')}>{WD[weekday(day.date)]}</span>
        <span className={clsx('tabular font-display text-[40px] leading-none', isToday ? 'text-today' : past ? 'text-ink-3' : 'text-ink')}>{Number(day.date.slice(8))}</span>
        {day.exams.map((e: string) => <span key={e} className="tint tint-rose self-center text-[13px] font-medium">Prova · {e}</span>)}
        <span className="flex min-w-0 flex-wrap gap-2 self-center">
        {residency.map((e) => (
          <Link key={`${e.residencyId}-${e.stepId}-${e.edge}`} to={`/residencias?r=${e.residencyId}`} data-testid="planner-residency"
            className={clsx('inline-flex items-center gap-1.5 self-center rounded-full border border-line px-2.5 py-0.5 text-[13px] text-ink transition hover:border-ink', e.done && 'text-ink-3 line-through decoration-1')}>
            <TypeDot type={e.type} />{e.residency} - {e.label}
          </Link>
        ))}
        </span>
        <span className="flex-1" />
        {isToday && <span className="text-[11px] tracking-[0.16em] text-today uppercase">hoje</span>}
      </div>
      )}

      <div className={clsx('mt-4 grid gap-x-10 gap-y-7 sm:pl-12', widgets.reviews && 'md:grid-cols-2')}>
        <div data-testid="col-subjects" {...dropZone(dnd, day.date, 'task')}>
          <ColumnHead>Assuntos</ColumnHead>
          <ul>
            {day.newSubjects.map((n: any) => (
              <TaskRow key={n.subjectId} item={{ ...n, done: n.done }} detail={detailed || (!n.done && n.methodIds.length < n.totalActivities) ? n.methods.join(' · ') : undefined}
                pomodoro={isToday || detailed} onOpen={onOpen} onCheck={(done) => onCheck(n, done)} disabled={busy}
                target={{ kind: 'task', subjectId: n.subjectId, name: n.name, area: n.area, from: day.date, methodIds: n.methodIds, done: n.done }}
                drag={n.done ? undefined : dragProps(dnd, { type: 'task', subjectId: n.subjectId, from: day.date, methodIds: n.methodIds, name: n.name })} />
            ))}
            {!day.newSubjects.length && <li className="py-3 text-[14px] text-ink-3">{past ? '-' : 'Livre'}</li>}
          </ul>
          {!past && (
            <button onClick={() => onAdd(day.date)} data-testid="add-subject" title="Adicionar um assunto neste dia"
              className="mt-1 flex items-center gap-1.5 py-1 text-[12px] text-ink-3 opacity-70 transition hover:text-ink hover:opacity-100 focus-visible:opacity-100">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />adicionar assunto
            </button>
          )}
        </div>
        {widgets.reviews && <div data-testid="col-reviews" {...dropZone(dnd, day.date, 'review', clsx(!reviews.length && 'hidden md:block'))}>
          <ColumnHead>Revisões</ColumnHead>
          <ul>
            {reviews.map((r: any) => {
              const done = r.status === 'done';
              const dp = done ? undefined : dragProps(dnd, { type: 'review', subjectId: r.subjectId, from: day.date, name: r.name });
              const g = actions?.gestures({ kind: 'review', subjectId: r.subjectId, name: r.name, area: r.area, from: day.date, done });
              return (
                <SwipeRow key={`r${r.subjectId}`} rest={dp?.li} gestures={g ?? {}} testId="review"
                  className={clsx('border-b border-line/70 last:border-0', dp?.className)} rowClassName="flex items-center gap-4 py-3">
                  <button onClick={() => onOpen(r.subjectId)} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70 active:opacity-50">
                    <span className={clsx('block text-[16px] leading-snug', done && 'text-ink-3 line-through decoration-1')}>{r.name}</span>
                    {r.status === 'overdue' && <span className="text-[11px] text-today">atrasada</span>}
                  </button>
                  <CheckButton on={done} disabled={done || busy} onChange={() => onReview(r)} label={`Revisão feita - ${r.name}`} />
                </SwipeRow>
              );
            })}
            {!reviews.length && <li className="py-3 text-[14px] text-ink-3">-</li>}
          </ul>
        </div>}
      </div>

      {agenda.length > 0 && (
        <div className="mt-7 sm:pl-12" data-testid="planner-agenda">
          <div className="flex items-baseline justify-between border-b border-ink/70 pb-1.5 text-[10.5px] font-medium tracking-[0.18em] text-ink-2 uppercase">
            Tarefas<span className="text-[10px] font-normal tracking-[0.12em] text-ink-3 normal-case italic">da agenda</span>
          </div>
          <ul className="md:columns-2 md:gap-x-10">{agenda.map((a) => <AgendaRow key={a.id} task={a} onOpen={onTask} inPlanner className="break-inside-avoid" />)}</ul>
        </div>
      )}

      {questions?.perDay > 0 && questions.suggestions.length > 0 && (
        <p className="mt-4 text-[13px] text-ink-2 sm:pl-12">
          Questões sugeridas:{' '}
          {questions.suggestions.map((s: any, i: number) => (
            <span key={s.subjectId}>{i > 0 && ', '}<button className="underline decoration-line underline-offset-4 hover:decoration-ink" onClick={() => onOpen(s.subjectId)}>{s.name}</button> ({s.questions})</span>
          ))}
        </p>
      )}
    </section>
  );
}

/** Observações da semana: uma folha pautada, salva sozinha. */
function WeekNotes({ week }: { week: string }) {
  const q = useQuery({ queryKey: ['notes', week], queryFn: () => api.get(`/api/notes/${week}`) });
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const last = useRef('');
  useEffect(() => { const c = q.data?.content ?? ''; setText(c); last.current = c; setState('idle'); }, [q.data, week]);
  const save = async (content: string) => {
    if (content === last.current) return;
    setState('saving');
    try { await api.put(`/api/notes/${week}`, { content }); last.current = content; setState('saved'); } catch { setState('error'); }
  };
  const onChange = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(v), 800);
  };
  const lines = Math.max(7, text.split('\n').length + 2);
  const status = state === 'saving' ? 'Salvando…' : state === 'saved' ? 'Salvo' : state === 'error' ? 'Não foi possível salvar' : '';
  const area = (
    <textarea className="notebook-text" rows={lines} value={text} disabled={q.isLoading} aria-label="Observações da semana"
      placeholder="Escreva o que quiser lembrar nesta semana…" onChange={(e) => onChange(e.target.value)}
      onBlur={() => { clearTimeout(timer.current); save(text); }} />
  );
  return (
    <section className="mt-20 animate-in" aria-label="Observações da semana">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-[30px] italic">Observações da semana</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="notebook mt-5">{area}</div>
      <p className="mt-2 h-4 text-right text-[12px] text-ink-3">{status}</p>
    </section>
  );
}

export function TaskRow({ item, onOpen, onCheck, detail, pomodoro, disabled, drag, target }: { item: { subjectId: string; name: string; area?: string; specialty?: string | null; done: boolean }; onOpen: (id: string) => void; onCheck: (done: boolean) => void; detail?: string; pomodoro?: boolean; disabled?: boolean; drag?: DragProps; target?: Target }) {
  const p = usePomodoro();
  const actions = useSubjectActions();
  const g = target && actions ? actions.gestures(target) : {};
  const widgets = useWidgets();
  return (
    <SwipeRow rest={drag?.li} gestures={g} testId="task"
      className={clsx('border-b border-line/70 last:border-0', drag?.className)} rowClassName="group flex items-center gap-4 py-3">
      <button onClick={() => onOpen(item.subjectId)} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70 active:opacity-50">
        <Tint area={item.area} className={clsx('text-[10.5px] font-medium tracking-[0.14em] uppercase', item.done && 'opacity-50')}>{item.specialty || areaShort(item.area)}</Tint>
        <span data-testid="task-name" className={clsx('mt-1 block text-[16px] leading-snug', item.done && 'text-ink-3 line-through decoration-1')}>{item.name}</span>
        {detail && <span className="block text-[12px] text-ink-3">{detail}</span>}
      </button>
      {!item.done && widgets.pomodoro && (
        <button onClick={() => { p.start({ subject: { id: item.subjectId, name: item.name, area: item.area } }); p.setExpanded(true); }}
          aria-label={`Iniciar Pomodoro - ${item.name}`} title="Iniciar Pomodoro"
          className={clsx('flex items-center gap-1.5 rounded-full text-[12px] text-ink-3 transition hover:text-ink', !pomodoro && 'opacity-0 group-hover:opacity-100 focus:opacity-100')}>
          <Timer className="h-4 w-4" strokeWidth={1.5} />
        </button>
      )}
      <CheckButton on={item.done} onChange={onCheck} disabled={disabled} label={`Concluir ${item.name}`} />
    </SwipeRow>
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
      (status === 'all' || (status === 'hidden' ? s.hidden : status === 'unscheduled' ? !s.scheduled && !s.hidden : s.status === status && !s.hidden)) &&
      (area === 'all' || s.area === area) &&
      (!search || s.name.toLowerCase().includes(search.toLowerCase())));
    return sort === 'dynamic' ? [...l].sort((a: any, b: any) => b.dynamic.score - a.dynamic.score) : l;
  }, [data, search, status, area, sort]);
  const visible = data.subjects.filter((s: any) => !s.hidden);
  const studied = visible.filter((s: any) => s.status === 'studied').length;
  const hiddenCount = data.subjects.length - visible.length;
  const filtered = status !== 'all' || area !== 'all' || sort !== 'rank';

  return (
    <>
      <p className="mb-8 text-[15px] text-ink-2">{studied} de {visible.length} concluídos · ordenados pelo que mais cai{hiddenCount > 0 && ` · ${hiddenCount} fora do planner`}</p>
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
          { label: `${status === 'hidden' ? '✓ ' : ''}Fora do planner (excluídos)`, onClick: () => setStatus('hidden'), hidden: hiddenCount === 0 },
          ...areas.map((a) => ({ label: `${area === a ? '✓ ' : ''}${a}`, onClick: () => setArea(area === a ? 'all' : a) })),
        ]} />
      </div>
      <ol className="divide-y divide-line border-y border-line">
        {list.slice(0, limit).map((s: any) => (
          <li key={s.subjectId}>
            <button onClick={() => onOpen(s.subjectId)} data-testid="subject-card" className="flex w-full items-center gap-4 py-4 text-left transition-opacity hover:opacity-70">
              <span className="tabular w-7 shrink-0 text-[14px] text-ink-3">{s.rank}</span>
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate text-[17px]', (!s.scheduled || s.hidden) && 'text-ink-3', s.status === 'studied' && !s.hidden && 'text-ink-3 line-through decoration-1')}>{s.name}</span>
                <span className="block truncate text-[13px] text-ink-2">
                  <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle dot-${tintFor(s.area)}`} />{areaShort(s.area)} · {s.own ? 'seu assunto' : `${pct(s.percentage)} da prova`} · {s.hidden ? 'fora do planner' : s.card?.nextReview
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
        Peso de cada prova: {weights.map((w) => `${w.label.split(' - ')[0]} ${pct(w.weight, 0)}`).join(' · ')}
        <Hint text="Peso = (2 se principal, 1 se não) × (0,5 + proximidade), normalizado. Proximidade = 1 / (1 + dias até a prova / 60)." />
      </p>
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[520px] text-left text-[15px]">
          <thead>
            <tr className="border-b border-line text-[13px] text-ink-2">
              <th className="py-3 pr-3 font-normal">Assunto</th>
              {exams.map((e) => <th key={e.editionId} className="px-2 py-3 text-right font-normal">{e.label.split(' - ')[0]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.subjects.slice(0, 60).map((s: any) => (
              <tr key={s.subjectId} onClick={() => onOpen(s.subjectId)} className="cursor-pointer transition-opacity hover:opacity-70">
                <td className="py-3 pr-3"><span className="mr-3 tabular text-[13px] text-ink-3">{s.rank}</span>{s.name}</td>
                {exams.map((e) => {
                  const pe = s.perExam.find((p: any) => p.editionId === e.editionId);
                  return <td key={e.editionId} className="tabular px-2 py-3 text-right text-ink-2" title={pe?.level ? LV[pe.level] : 'Não aparece'}>{pe?.percentage ? pct(pe.percentage) : '-'}</td>;
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
        <div><dt className="text-ink-2">Base da análise</dt><dd className="mt-1 space-y-1">{s.exams.map((e: any) => <div key={e.editionId}>{e.label.split(' - ')[0]}: {e.message}{e.years?.length ? ` (${e.years.join(', ')})` : ''}</div>)}</dd></div>
        <div><dt className="text-ink-2">Cobertura</dt><dd className="mt-1">O tempo disponível cobre {pct(s.historicalCoverageScheduled)} das questões históricas.</dd></div>
        <div><dt className="text-ink-2">Reta final</dt><dd className="mt-1">Últimos {s.finalPhaseDays} dias reservados só para revisões.</dd></div>
        {s.warnings?.length > 0 && <div><dt className="text-ink-2">Avisos</dt><dd className="mt-1 space-y-2">{s.warnings.map((w: string) => <p key={w}>{w}</p>)}</dd></div>}
        <div><dt className="text-ink-2">Algoritmos</dt><dd className="mt-1 text-ink-3">{data.plan.algorithm_version} · {data.plan.scheduler_version}</dd></div>
      </dl>
    </Sheet>
  );
}

