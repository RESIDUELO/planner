import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateBR, greeting, int, num1, pct, shortDate, todayBR } from '../lib/format';
import { Button, Eyebrow, Hint, Progress, Spinner } from '../components/ui';
import { SubjectModal } from '../components/SubjectModal';
import { TaskRow, useCheck } from './Planner';

/** Página pessoal: o que eu preciso fazer agora? */
export function DashboardPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const d = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/api/dashboard') });
  const t = useQuery({ queryKey: ['today'], queryFn: () => api.get('/api/planner/today'), enabled: !!d.data?.hasPlan });
  const check = useCheck();
  const [open, setOpen] = useState<string | null>(null);
  if (d.isLoading) return <Spinner />;
  const data = d.data;
  const first = user?.isGuest ? '' : user?.name?.split(' ')[0];
  const hello = `${greeting()}${first ? `, ${first}` : ''}.`;
  const dateLine = dateBR(todayBR(), { weekday: 'long', day: 'numeric', month: 'long' });

  const guestLine = user?.isGuest && (
    <p className="mt-24 text-[13px] text-ink-3">
      Você está no modo visitante. <Link to="/configuracoes" className="text-ink underline underline-offset-4">Crie uma conta</Link> para acessar de outros dispositivos.
    </p>
  );

  if (!data?.hasPlan) {
    const steps = [
      { done: data?.selectedExams > 0, text: 'Escolha a sua prova', to: '/provas' },
      { done: data?.profileConfigured, text: 'Marque como você estuda', to: '/planner' },
      { done: false, text: 'Receba seu planner, ordenado pelo que mais cai', to: '/planner' },
    ];
    const next = steps.find((s) => !s.done) ?? steps[2];
    return (
      <div className="mx-auto max-w-2xl">
        <Eyebrow className="animate-in">{dateLine}</Eyebrow>
        <h1 className="mt-3 font-display text-[52px] leading-[1.02] animate-in sm:text-[72px]">{hello}</h1>
        <p className="mt-4 text-[19px] text-ink-2 animate-in">Vamos montar seu planner.</p>
        <ol className="mt-14 border-t border-line animate-in">
          {steps.map((s, i) => (
            <li key={s.text} className="flex items-baseline gap-5 border-b border-line py-4">
              <span className="tabular w-6 font-display text-[24px] text-ink-3">{s.done ? '✓' : i + 1}</span>
              <Link to={s.to} className={`text-[18px] transition hover:opacity-70 ${s.done ? 'text-ink-3 line-through decoration-1' : 'text-ink'}`}>{s.text}</Link>
            </li>
          ))}
        </ol>
        <Button size="lg" className="mt-12" onClick={() => nav(next.to)}>{next === steps[0] ? 'Escolher prova' : 'Montar planner'}</Button>
        {guestLine}
      </div>
    );
  }

  const today = t.data;
  const primary = data.dominated.find((x: any) => x.isPrimary) ?? data.dominated[0];
  const others = data.dominated.filter((x: any) => x !== primary);
  const tasks = (today?.newSubjects ?? []).filter((s: any) => !s.overflow);
  const extra = (today?.newSubjects ?? []).length - tasks.length;
  const reviews = today?.reviews ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <Eyebrow className="animate-in">{dateLine}</Eyebrow>
      <h1 className="mt-3 font-display text-[52px] leading-[1.02] animate-in sm:text-[72px]">{hello}</h1>

      <section className="mt-10 flex items-end gap-5 animate-in">
        {primary?.examDate ? (
          <>
            <span className="tabular font-display text-[88px] leading-[0.85] sm:text-[112px]">{primary.daysLeft}</span>
            <span className="pb-1 text-[15px] leading-snug text-ink-2">
              {primary.daysLeft === 1 ? 'dia' : 'dias'} até a<br />
              <span className="text-ink">{(primary.label ?? '').split(' — ')[0]}</span> · {shortDate(primary.examDate)}
              {others.length > 0 && <span className="block text-[13px] text-ink-3">e {others.map((o: any) => `${o.label.split(' — ')[0]}${o.examDate ? ` (${shortDate(o.examDate, false)})` : ''}`).join(', ')}</span>}
            </span>
          </>
        ) : (
          <p className="text-[17px] text-ink-2">{primary?.label ?? data.nextExam?.label} · <Link to="/provas" className="text-ink underline underline-offset-4">informe a data da prova</Link></p>
        )}
      </section>

      <section className="mt-16 animate-in">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[34px] leading-none">Hoje</span>
          <span className="h-px flex-1 bg-ink/80" />
          <Link to="/planner" className="text-[13px] text-ink-2 underline underline-offset-4 hover:text-ink">Ver semana</Link>
        </div>
        {!today ? <div className="h-32" /> : (
          <ul className="mt-2">
            {tasks.map((s: any) => (
              <TaskRow key={s.subjectId} item={{ subjectId: s.subjectId, name: s.name, area: s.area, done: false }} pomodoro onOpen={setOpen}
                detail={s.overdue ? 'atrasado' : undefined}
                onCheck={(done) => check.mutate({ subjectId: s.subjectId, methodIds: s.methods.map((m: any) => m.methodId), done })} />
            ))}
            {reviews.map((r: any) => (
              <li key={`r${r.subjectId}`} className="flex items-center gap-4 border-b border-line/70 py-3 last:border-0">
                <button onClick={() => setOpen(r.subjectId)} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70">
                  <span className="text-[16px]">↻ {r.name}</span>
                  <span className={`ml-2 text-[12px] ${r.overdueDays > 0 ? 'text-today' : 'text-ink-3'}`}>{r.overdueDays > 0 ? 'revisão atrasada' : 'revisão'}</span>
                </button>
                <button onClick={() => setOpen(r.subjectId)} className="text-[13px] text-ink-2 underline underline-offset-4 hover:text-ink">Revisar</button>
              </li>
            ))}
            {tasks.length === 0 && reviews.length === 0 && (
              <li className="py-6">
                <p className="text-[17px]">Tudo feito por hoje.</p>
                {data.nextSubjects?.[0] && (
                  <p className="mt-1 text-[15px] text-ink-2">Se quiser adiantar: <button className="text-ink underline underline-offset-4" onClick={() => setOpen(data.nextSubjects[0].subjectId)}>{data.nextSubjects[0].name}</button></p>
                )}
              </li>
            )}
          </ul>
        )}
        {extra > 0 && <p className="mt-3 text-[13px] text-ink-3">+ {extra} {extra === 1 ? 'assunto' : 'assuntos'} se sobrar tempo, no planner.</p>}
      </section>

      <section className="mt-16 animate-in">
        <div className="flex items-baseline justify-between">
          <Eyebrow>Seu progresso</Eyebrow>
          <span className="tabular font-display text-[30px] leading-none">{pct(data.progress, 0)}</span>
        </div>
        <Progress className="mt-4" value={data.progress} />
        <p className="mt-3 text-[14px] text-ink-2">{data.subjects.studied} de {data.subjects.total} assuntos concluídos</p>

        <dl className="mt-10 grid grid-cols-3 border-t border-line text-[13px]">
          <Link to="/revisoes" className="border-r border-line py-4 pr-4 transition hover:opacity-70">
            <dt className="text-ink-2">Revisões</dt>
            <dd className="tabular font-display text-[32px] leading-tight">{reviews.length || data.reviews.today + data.reviews.overdue}</dd>
          </Link>
          <Link to="/desempenho" className="border-r border-line px-4 py-4 transition hover:opacity-70">
            <dt className="text-ink-2">Questões</dt>
            <dd className="tabular font-display text-[32px] leading-tight">{int(data.questions.answered)}</dd>
          </Link>
          <Link to="/desempenho" className="py-4 pl-4 transition hover:opacity-70">
            <dt className="text-ink-2">Acertos</dt>
            <dd className="tabular font-display text-[32px] leading-tight">{pct(data.questions.accuracy, 0)}</dd>
          </Link>
        </dl>

        {primary?.totalQuestions && (
          <p className="mt-8 flex items-center gap-1.5 text-[13px] text-ink-3">
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
