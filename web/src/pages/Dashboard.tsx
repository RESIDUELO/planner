import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlarmClock, BookOpenCheck, CalendarCheck, CheckCircle2, ClipboardList, Target, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateBR, int, num1, pct } from '../lib/format';
import { Alert, Badge, Button, Card, Empty, Hint, PageHeader, Progress, Spinner, Stat } from '../components/ui';

export function DashboardPage() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/api/dashboard') });
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  const first = user?.name?.split(' ')[0];

  if (!d?.hasPlan) {
    const steps = [
      { done: d?.selectedExams > 0, label: 'Escolha suas provas', to: '/provas', text: 'Somente provas cadastradas pela administração aparecem.' },
      { done: d?.profileConfigured, label: 'Informe como e quanto você estuda', to: '/planner', text: 'Métodos, horas por dia e dias da semana.' },
      { done: false, label: 'Gere seu planner', to: '/planner', text: 'Assuntos ordenados pelo que mais caiu nas provas escolhidas.' },
    ];
    return (
      <>
        <PageHeader title={`Olá${first && first !== 'Visitante' ? `, ${first}` : ''}!`} subtitle="Vamos montar sua estratégia de preparação." />
        {d?.nextExam && (
          <div className="mb-6 rounded-xl bg-brand-700 p-6 text-white">
            <div className="text-sm text-brand-100">Próxima prova</div>
            <div className="mt-1 text-xl font-semibold">{d.nextExam.label}</div>
            <div className="mt-1 text-sm text-brand-100">{dateBR(d.nextExam.date)} · {d.nextExam.daysLeft} dias</div>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <Link key={s.label} to={s.to} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-300">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                {s.done ? <CheckCircle2 className="h-4 w-4 text-ok-500" /> : <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700">{i + 1}</span>}
                Passo {i + 1}
              </div>
              <div className="mt-2 font-semibold text-slate-900">{s.label}</div>
              <p className="mt-1 text-sm text-slate-500">{s.text}</p>
            </Link>
          ))}
        </div>
      </>
    );
  }

  const primary = d.dominated.find((x: any) => x.isPrimary) ?? d.dominated[0];
  return (
    <>
      <PageHeader
        title={`Olá${first && first !== 'Visitante' ? `, ${first}` : ''}!`}
        subtitle={<>{d.plan.name} · {d.plan.mode === 'multi' ? 'modo multiprova' : 'prova principal'}</>}
        action={<Link to="/planner"><Button><BookOpenCheck className="h-4 w-4" /> O que estudar hoje</Button></Link>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="relative overflow-hidden rounded-xl bg-brand-700 p-6 text-white shadow-sm lg:col-span-1">
          <div className="pointer-events-none absolute -right-10 -bottom-16 h-48 w-48 rounded-full bg-brand-500/40 blur-2xl" />
          <div className="text-sm text-brand-100">Próxima prova</div>
          <div className="mt-1 text-lg font-semibold">{d.nextExam?.label ?? '—'}</div>
          <div className="mt-6 flex items-baseline gap-2">
            <span className="tabular text-5xl font-semibold">{d.nextExam?.daysLeft ?? '—'}</span>
            <span className="text-brand-100">dias para a prova</span>
          </div>
          <div className="mt-1 text-sm text-brand-100">{dateBR(d.nextExam?.date, { dateStyle: 'long' })}</div>
          <div className="mt-6">
            <div className="flex justify-between text-sm"><span className="text-brand-100">Progresso geral</span><span className="tabular font-semibold">{pct(d.progress, 0)}</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-emerald-300" style={{ width: `${d.progress * 100}%` }} /></div>
          </div>
        </div>

        <Card className="lg:col-span-2" title={<span className="flex items-center gap-1.5">Questões potencialmente dominadas <Hint text="Estimativa matemática, não promessa de acerto: para cada assunto, questões esperadas na prova (frequência histórica × nº de questões) × seu domínio estimado (acerto registrado, ajustado pelo tamanho da amostra e pela memória atual)." /></span>}
          subtitle="Estimativa baseada nos dados históricos cadastrados e no seu desempenho registrado">
          <div className="grid gap-6 sm:grid-cols-2">
            {d.dominated.map((x: any) => (
              <div key={x.editionId}>
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">{x.label}{x.isPrimary && <Badge tone="info">principal</Badge>}</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="tabular text-3xl font-semibold text-slate-900">{num1(x.dominated)}</span>
                  <span className="tabular text-slate-500">/ {x.totalQuestions ?? '?'}</span>
                </div>
                <Progress className="mt-2" tone="ok" value={x.totalQuestions ? x.dominated / x.totalQuestions : 0} label={`Questões dominadas em ${x.label}`} />
                <div className="mt-1 text-xs text-slate-500">
                  {x.daysLeft != null ? `${x.daysLeft} dias` : 'sem data'} · análise de {x.editionsAnalyzed} {x.editionsAnalyzed === 1 ? 'edição' : 'edições'}
                </div>
              </div>
            ))}
          </div>
          {primary && <p className="mt-4 text-xs text-slate-500">{d.masteryNote}</p>}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Assuntos estudados" value={<>{d.subjects.studied}<span className="text-base text-slate-400"> / {d.subjects.total}</span></>} hint={`${d.subjects.inProgress} em andamento · ${d.subjects.pending} pendentes`} icon={<BookOpenCheck className="h-4 w-4" />} />
        <Stat label="Revisões hoje" value={d.reviews.today} hint={`${d.reviews.doneToday} feitas hoje`} icon={<CalendarCheck className="h-4 w-4" />} />
        <Stat label="Revisões atrasadas" value={d.reviews.overdue} tone={d.reviews.overdue ? 'late' : undefined} hint={d.reviews.overdue ? 'Priorize-as hoje' : 'Tudo em dia'} icon={<AlarmClock className="h-4 w-4" />} />
        <Stat label="Questões realizadas" value={int(d.questions.answered)} hint={d.questions.accuracy != null ? `${pct(d.questions.accuracy, 0)} de acerto` : 'Nenhuma registrada'} icon={<Target className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-1.5">Cobertura histórica <Hint text="Soma da fração histórica das questões (nas provas selecionadas) dos assuntos que você já estudou." /></span>}>
          <div className="tabular text-3xl font-semibold text-slate-900">{pct(d.coverage.studied)}</div>
          <p className="mt-1 text-sm text-slate-500">das questões históricas estão em assuntos que você já estudou.</p>
          <Progress className="mt-4" value={d.coverage.studied} tone="ok" />
          <p className="mt-3 text-xs text-slate-500">O planner cobre {pct(d.coverage.scheduled)} até a prova com o tempo disponível.</p>
        </Card>
        <Card className="lg:col-span-2" title="Próximos assuntos" action={<Link to="/planner" className="text-xs font-medium text-brand-600 hover:underline">Ver planner</Link>}>
          {d.nextSubjects.length === 0 ? <Empty icon={<TrendingUp className="h-8 w-8" />} title="Todos os assuntos agendados foram estudados" /> : (
            <ul className="divide-y divide-slate-100">
              {d.nextSubjects.map((s: any) => (
                <li key={s.subjectId} className="flex items-center gap-4 py-2.5">
                  <span className="tabular w-8 text-sm font-semibold text-slate-400">#{s.rank}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{s.name}</div>
                    <Progress className="mt-1.5 h-1.5" value={s.progress} />
                  </div>
                  <span className="tabular text-xs text-slate-500">{pct(s.percentage)}</span>
                  <Badge tone={s.levelLabel === 'Muito alta' ? 'brand' : s.levelLabel === 'Alta' ? 'info' : 'neutral'}>{s.levelLabel}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {d.plan.warnings?.length > 0 && (
        <div className="mt-4 space-y-2">{d.plan.warnings.map((w: string) => <Alert key={w} tone="warn">{w}</Alert>)}</div>
      )}
      <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-400"><ClipboardList className="h-3.5 w-3.5" /> Planner gerado com {d.plan.algorithm}.</p>
    </>
  );
}
