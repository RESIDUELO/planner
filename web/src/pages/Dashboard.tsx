import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysText, greeting, int, num1, pct, shortDate } from '../lib/format';
import { Button, Hint, Progress, Spinner } from '../components/ui';
import { SubjectModal } from '../components/SubjectModal';

/** Página pessoal: o que eu preciso fazer agora? */
export function DashboardPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const d = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/api/dashboard') });
  const t = useQuery({ queryKey: ['today'], queryFn: () => api.get('/api/planner/today'), enabled: !!d.data?.hasPlan });
  const [open, setOpen] = useState<string | null>(null);
  if (d.isLoading) return <Spinner />;
  const data = d.data;
  const first = user?.isGuest ? '' : user?.name?.split(' ')[0];
  const hello = `${greeting()}${first ? `, ${first}` : ''}.`;

  const guestLine = user?.isGuest && (
    <p className="mt-24 text-[14px] text-ink-3">
      Você está no modo visitante. <Link to="/configuracoes" className="text-accent hover:underline">Crie uma conta</Link> para acessar de outros dispositivos.
    </p>
  );

  if (!data?.hasPlan) {
    const steps = [
      { done: data?.selectedExams > 0, text: 'Escolha a prova que você vai fazer', to: '/provas' },
      { done: data?.profileConfigured, text: 'Conte quanto tempo você tem e como estuda', to: '/planner' },
      { done: false, text: 'Receba seu planner, ordenado pelo que mais cai', to: '/planner' },
    ];
    const next = steps.find((s) => !s.done) ?? steps[2];
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-[40px] leading-tight font-semibold tracking-[-0.03em] animate-in sm:text-[56px]">{hello}</h1>
        <p className="mt-4 text-[21px] text-ink-2 animate-in sm:text-[24px]">Vamos preparar sua estratégia de estudo.</p>
        <ol className="mt-14 space-y-5 animate-in">
          {steps.map((s, i) => (
            <li key={s.text} className="flex items-baseline gap-4">
              <span className={`tabular text-[15px] ${s.done ? 'text-positive' : 'text-ink-3'}`}>{s.done ? '✓' : i + 1}</span>
              <Link to={s.to} className={`text-[19px] transition hover:opacity-70 ${s.done ? 'text-ink-3 line-through decoration-1' : 'text-ink'}`}>{s.text}</Link>
            </li>
          ))}
        </ol>
        <Button size="lg" className="mt-12" onClick={() => nav(next.to)}>{next === steps[0] ? 'Escolher prova' : 'Montar planner'}</Button>
        {guestLine}
      </div>
    );
  }

  const today = t.data;
  const focus = today?.newSubjects?.find((s: any) => !s.overflow) ?? today?.newSubjects?.[0];
  const primary = data.dominated.find((x: any) => x.isPrimary) ?? data.dominated[0];
  const others = data.dominated.filter((x: any) => x !== primary);
  const reviewsDue = today?.reviews?.length ?? data.reviews.today + data.reviews.overdue;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[40px] leading-tight font-semibold tracking-[-0.03em] animate-in sm:text-[56px]">{hello}</h1>

      <section className="mt-12 animate-in">
        <p className="text-[17px] text-ink-2">Você está se preparando para</p>
        <p className="mt-1 text-[28px] font-semibold tracking-[-0.02em]">{primary?.label ?? data.nextExam?.label}</p>
        {primary?.examDate ? (
          <p className="mt-1 text-[17px] text-ink-2">
            {shortDate(primary.examDate)} · <span className="text-ink">{daysText(primary.daysLeft)}</span>{primary.daysLeft > 1 && ' restantes'}
          </p>
        ) : <Link to="/provas" className="mt-1 inline-block text-[17px] text-accent hover:underline">Informe a data da prova</Link>}
        {others.length > 0 && (
          <p className="mt-2 text-[14px] text-ink-3">e também {others.map((o: any) => `${o.label}${o.examDate ? ` (${shortDate(o.examDate, false)})` : ''}`).join(', ')}</p>
        )}
      </section>

      <div className="my-14 h-px bg-line" />

      <section className="animate-in">
        <p className="text-[17px] text-ink-2">Seu foco hoje</p>
        {!today ? <div className="h-32" /> : focus ? (
          <>
            <p className="mt-3 text-[13px] tracking-wide text-ink-3">{focus.area}</p>
            <p className="mt-1 text-[32px] leading-tight font-semibold tracking-[-0.025em] sm:text-[40px]">{focus.name}</p>
            <p className="mt-3 text-[17px] text-ink-2">{focus.methods.map((m: any) => m.name).join(' · ')}</p>
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <Button size="lg" onClick={() => setOpen(focus.subjectId)}>Começar</Button>
              <Link to="/planner" className="text-[15px] text-accent hover:underline">Ver o dia completo</Link>
            </div>
          </>
        ) : reviewsDue > 0 ? (
          <>
            <p className="mt-3 text-[32px] font-semibold tracking-[-0.025em]">Revisões</p>
            <p className="mt-2 text-[17px] text-ink-2">{reviewsDue} {reviewsDue === 1 ? 'tópico para revisar' : 'tópicos para revisar'}</p>
            <Button size="lg" className="mt-8" onClick={() => nav('/revisoes')}>Revisar</Button>
          </>
        ) : data.nextSubjects?.[0] ? (
          <>
            <p className="mt-3 text-[24px] text-ink">Você concluiu o dia.</p>
            <p className="mt-2 text-[17px] text-ink-2">Se quiser adiantar, o próximo é <span className="text-ink">{data.nextSubjects[0].name}</span>.</p>
            <Button variant="secondary" className="mt-6" onClick={() => setOpen(data.nextSubjects[0].subjectId)}>Adiantar</Button>
          </>
        ) : (
          <p className="mt-3 text-[24px] text-ink">Nada pendente para hoje.</p>
        )}
      </section>

      <div className="my-14 h-px bg-line" />

      <section className="animate-in">
        <div className="flex items-baseline justify-between">
          <p className="text-[17px] text-ink-2">Seu progresso</p>
          <p className="tabular text-[28px] font-semibold tracking-[-0.02em]">{pct(data.progress, 0)}</p>
        </div>
        <Progress className="mt-4" value={data.progress} />
        <p className="mt-3 text-[15px] text-ink-2">{data.subjects.studied} de {data.subjects.total} temas estudados</p>

        <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4 text-[15px]">
          <Link to="/revisoes" className="transition hover:opacity-70">
            <dt className="text-ink-2">Revisões</dt>
            <dd className="tabular text-[22px] font-medium">{reviewsDue}{data.reviews.overdue > 0 && <span className="ml-2 text-[14px] font-normal text-negative">{data.reviews.overdue} atrasada{data.reviews.overdue > 1 ? 's' : ''}</span>}</dd>
          </Link>
          <Link to="/desempenho" className="transition hover:opacity-70">
            <dt className="text-ink-2">Questões</dt>
            <dd className="tabular text-[22px] font-medium">{int(data.questions.answered)}</dd>
          </Link>
          <Link to="/desempenho" className="transition hover:opacity-70">
            <dt className="text-ink-2">Acertos</dt>
            <dd className="tabular text-[22px] font-medium">{pct(data.questions.accuracy, 0)}</dd>
          </Link>
        </dl>

        {primary?.totalQuestions && (
          <p className="mt-10 flex items-center gap-1.5 text-[14px] text-ink-3">
            {num1(primary.dominated)} de {primary.totalQuestions} questões potencialmente dominadas
            <Hint text={`Estimativa, não promessa de acerto: questões esperadas de cada assunto (pela frequência histórica) × seu domínio estimado. ${data.masteryNote}`} />
          </p>
        )}
      </section>

      {guestLine}
      {open && <SubjectModal subjectId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
