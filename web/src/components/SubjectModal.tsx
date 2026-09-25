import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';
import { api, errorMessage } from '../lib/api';
import { dateTimeBR, daysBetween, isoBR, LEVEL_TEXT, num1, pct, relativeDays, shortDate, todayBR } from '../lib/format';
import { Button, Disclosure, Note, Progress, Sheet, Spinner } from './ui';
import { ReviewButtons } from './ReviewButtons';

const RATING_LABEL: Record<string, string> = { again: 'Errei', hard: 'Difícil', good: 'Bom', easy: 'Fácil' };

export function useInvalidateStudy() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['planner', 'today', 'dashboard', 'subject', 'calendar', 'performance', 'upcoming']) qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Folha do assunto: o que fazer primeiro; o resto sob demanda. */
export function SubjectModal({ subjectId, onClose }: { subjectId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['subject', subjectId], queryFn: () => api.get(`/api/planner/subjects/${subjectId}`) });
  const invalidate = useInvalidateStudy();
  const [msg, setMsg] = useState<{ tone: 'positive' | 'negative' | 'neutral'; text: string } | null>(null);
  const [practice, setPractice] = useState({ questions: '', correct: '', minutes: '' });

  const toggle = useMutation({
    mutationFn: ({ methodId, done }: { methodId: string; done: boolean }) => api.post(`/api/planner/subjects/${subjectId}/methods/${methodId}`, { done }),
    onSuccess: (r: any) => { invalidate(); if (r.cardCreated) setMsg({ tone: 'positive', text: 'Assunto estudado. A primeira revisão foi agendada.' }); },
    onError: (e) => setMsg({ tone: 'negative', text: errorMessage(e) }),
  });
  const log = useMutation({
    mutationFn: () => api.post(`/api/planner/subjects/${subjectId}/practice`, {
      questions: Number(practice.questions), correct: Number(practice.correct), minutes: practice.minutes ? Number(practice.minutes) : null,
    }),
    onSuccess: (r: any) => {
      invalidate();
      setPractice({ questions: '', correct: '', minutes: '' });
      setMsg({ tone: r.reviewAnticipated ? 'neutral' : 'positive', text: r.reviewAnticipated
        ? 'Registrado. Como o acerto ficou abaixo de 60%, a revisão foi antecipada.'
        : r.studied ? 'Registrado. Assunto estudado — revisão agendada.' : 'Questões registradas.' });
    },
    onError: (e) => setMsg({ tone: 'negative', text: errorMessage(e) }),
  });
  const undo = useMutation({ mutationFn: (id: string) => api.del(`/api/planner/practice/${id}`), onSuccess: invalidate });

  const d = q.data;
  const s = d?.subject;
  const today = todayBR();
  return (
    <Sheet open onClose={onClose} wide>
      {q.isLoading || !s ? <Spinner /> : (
        <div className="space-y-12">
          <header>
            <p className="text-[14px] text-ink-2">{s.area}{s.specialty ? ` · ${s.specialty}` : ''}</p>
            <h2 className="mt-1 pr-8 text-[32px] leading-tight font-semibold tracking-[-0.03em]">{s.name}</h2>
            <p className="mt-2 text-[15px] text-ink-2">
              {LEVEL_TEXT[s.level]} · #{s.rank} · {pct(s.percentage)} da prova
              {s.status === 'studied' && <span className="text-positive"> · Estudado</span>}
              {!s.scheduled && ' · fora do tempo disponível'}
            </p>
          </header>

          <section>
            <div className="divide-y divide-line border-y border-line">
              {s.checklist.map((c: any) => (
                <button key={c.methodId} disabled={toggle.isPending} onClick={() => toggle.mutate({ methodId: c.methodId, done: !c.done })}
                  className="flex w-full items-center gap-4 py-4 text-left transition-opacity hover:opacity-70">
                  <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-all duration-200 ease-apple',
                    c.done ? 'border-positive bg-positive text-white' : 'border-ink-3/50')}>
                    {c.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                  <span className={clsx('flex-1 text-[17px]', c.done && 'text-ink-2')}>{c.name}</span>
                  <span className="text-[14px] text-ink-3">{c.done ? shortDate(isoBR(c.completedAt), false) : c.scheduledDate ? `${shortDate(c.scheduledDate, false)} · ${c.minutes} min` : ''}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-4">
              <Progress value={s.progress} tone={s.progress === 1 ? 'positive' : 'accent'} />
              <span className="tabular text-[14px] text-ink-2">{pct(s.progress, 0)}</span>
            </div>
          </section>

          <section>
            <h3 className="text-[21px] font-semibold tracking-[-0.02em]">Questões</h3>
            <p className="mt-1 text-[15px] text-ink-2">
              {s.performance.answered ? <>{s.performance.answered} feitas · <span className="text-ink">{pct(s.performance.accuracy, 0)}</span> de acerto</> : 'Nenhuma registrada ainda.'}
            </p>
            <form className="mt-5 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); log.mutate(); }}>
              <input className="field w-24" aria-label="Questões feitas" type="number" min={1} required placeholder="Feitas" value={practice.questions} onChange={(e) => setPractice({ ...practice, questions: e.target.value })} />
              <input className="field w-24" aria-label="Acertos" type="number" min={0} required placeholder="Acertos" value={practice.correct} onChange={(e) => setPractice({ ...practice, correct: e.target.value })} />
              <input className="field w-24" aria-label="Minutos" type="number" min={0} placeholder="Min" value={practice.minutes} onChange={(e) => setPractice({ ...practice, minutes: e.target.value })} />
              <Button type="submit" variant="secondary" loading={log.isPending}>Registrar</Button>
            </form>
          </section>

          <section>
            <h3 className="text-[21px] font-semibold tracking-[-0.02em]">Revisão</h3>
            {s.card ? (
              <>
                <p className="mt-1 text-[15px] text-ink-2">
                  Próxima revisão: <span className="text-ink">{s.card.nextReview ? `${shortDate(s.card.nextReview, false)} (${relativeDays(daysBetween(s.card.nextReview, today))})` : 'nenhuma antes da prova'}</span>
                </p>
                {s.card.nextReview && s.card.nextReview <= today && (
                  <div className="mt-5"><p className="mb-3 text-[15px]">Como foi lembrar deste assunto?</p><ReviewButtons subjectId={s.subjectId} onDone={(t) => setMsg({ tone: 'positive', text: t })} /></div>
                )}
              </>
            ) : <p className="mt-1 text-[15px] text-ink-2">Conclua o checklist para começar as revisões espaçadas.</p>}
          </section>

          {msg && <Note tone={msg.tone}>{msg.text}</Note>}

          <div className="border-t border-line">
            <Disclosure summary="Por que este assunto?" className="border-b border-line">
              <p className="text-[15px] leading-relaxed text-ink-2">{d.explanation}</p>
              <div className="mt-5 space-y-4">
                {s.perExam.map((pe: any) => {
                  const ex = d.exams.find((e: any) => e.editionId === pe.editionId);
                  return (
                    <div key={pe.editionId}>
                      <div className="text-[15px]">{ex?.label?.split(' — ')[0]} <span className="text-ink-3">· {pe.percentage > 0 ? `${pct(pe.percentage)} · ${pe.editionsPresent}/${pe.editionsAnalyzed} edições` : 'não aparece'}</span></div>
                      {pe.byYear?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular">
                          {pe.byYear.map((y: any) => (
                            <span key={y.year} className={y.questions ? 'text-ink' : 'text-ink-3'} title={`${y.year}: ${y.questions} questão(ões)`}>
                              {y.year} {y.questions ? `✓ ${y.questions}` : '—'}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-5 text-[13px] text-ink-3">Esperadas na próxima prova: {num1(s.estimatedQuestions)} questões · média de {num1(s.annualAverage)} por edição.</p>
            </Disclosure>

            <Disclosure summary="Domínio e memória" className="border-b border-line">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[15px]">
                <div><dt className="text-ink-2">Domínio estimado</dt><dd className="tabular text-[22px] font-medium">{pct(s.mastery.mastery, 0)}</dd></div>
                <div><dt className="text-ink-2">Questões dominadas</dt><dd className="tabular text-[22px] font-medium">{num1(s.estimatedQuestions * s.mastery.mastery)} <span className="text-[15px] font-normal text-ink-3">de {num1(s.estimatedQuestions)}</span></dd></div>
                {s.card && <>
                  <div><dt className="text-ink-2">Lembrança hoje</dt><dd className="tabular">{pct(s.card.retrievability, 0)}</dd></div>
                  <div><dt className="text-ink-2">Estabilidade</dt><dd className="tabular">{num1(s.card.stability)} dias</dd></div>
                  <div><dt className="text-ink-2">Último estudo</dt><dd>{s.lastStudiedAt ? relativeDays(-daysBetween(today, isoBR(s.lastStudiedAt))) : '—'}</dd></div>
                </>}
              </dl>
              <p className="mt-4 text-[13px] text-ink-3">Estimativa, não promessa: acerto suavizado ((acertos + {d.mastery.priorWeight}×50%) / (questões + {d.mastery.priorWeight})) × probabilidade atual de lembrar.</p>
            </Disclosure>

            <Disclosure summary="Prioridade de hoje" className="border-b border-line">
              <p className="text-[15px]"><span className="tabular text-[22px] font-medium">{num1(s.dynamic.score)}</span> <span className="text-ink-3">de 100</span></p>
              <dl className="mt-3 space-y-1 text-[14px] text-ink-2">
                {([['historical', 'Histórico'], ['proximity', 'Proximidade da prova'], ['forgetting', 'Esquecimento'], ['performance', 'Desempenho']] as const).map(([k, l]) => (
                  <div key={k} className="flex justify-between"><dt>{l}</dt><dd className="tabular">{num1(s.dynamic.components[k] * 100)} / {Math.round(d.weights[k] * 100)}</dd></div>
                ))}
              </dl>
            </Disclosure>

            {(d.subtopics.length > 0 || d.reviews.length > 0 || d.practice.length > 0) && (
              <Disclosure summary="Histórico e subassuntos" className="border-b border-line">
                {d.subtopics.length > 0 && <p className="text-[14px] leading-relaxed text-ink-2">{d.subtopics.slice(0, 40).join(' · ')}</p>}
                {d.practice.length > 0 && (
                  <ul className="mt-4 space-y-1 text-[14px] text-ink-2">
                    {d.practice.map((p: any) => (
                      <li key={p.id} className="flex items-center justify-between">
                        <span>{dateTimeBR(p.practiced_at)} · {p.correct_count}/{p.questions_count}</span>
                        <Button variant="destructive" size="sm" onClick={() => undo.mutate(p.id)}>Excluir</Button>
                      </li>
                    ))}
                  </ul>
                )}
                {d.reviews.length > 0 && (
                  <ul className="mt-4 space-y-1 text-[14px] text-ink-2">
                    {d.reviews.map((r: any, i: number) => (
                      <li key={i}>{dateTimeBR(r.reviewed_at)} · {RATING_LABEL[r.rating]} · próxima em {Math.round(r.new_interval)} dia(s)</li>
                    ))}
                  </ul>
                )}
              </Disclosure>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
