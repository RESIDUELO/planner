import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { api, errorMessage } from '../lib/api';
import { dateTimeBR, daysBetween, isoBR, LEVEL_TEXT, minutes, num1, pct, relativeDays, shortDate, todayBR } from '../lib/format';
import { areaShort } from '../lib/areas';
import { usePomodoro } from '../lib/pomodoro';
import { Advanced, Button, CheckCircle, Disclosure, Note, Sheet, Spinner, Tint } from './ui';
import { ReviewButtons } from './ReviewButtons';

const RATING_LABEL: Record<string, string> = { again: 'Errei', hard: 'Difícil', good: 'Bom', easy: 'Fácil' };

export function useInvalidateStudy() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['planner', 'today', 'dashboard', 'subject', 'calendar', 'performance', 'upcoming', 'week']) qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Folha do assunto: as atividades escolhidas; todo o resto em "Opções avançadas". */
export function SubjectModal({ subjectId, onClose }: { subjectId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['subject', subjectId], queryFn: () => api.get(`/api/planner/subjects/${subjectId}`) });
  const invalidate = useInvalidateStudy();
  const pomodoro = usePomodoro();
  const [msg, setMsg] = useState<{ tone: 'positive' | 'negative' | 'neutral'; text: string; undoId?: string } | null>(null);
  const [practice, setPractice] = useState({ questions: '', correct: '' });
  const [early, setEarly] = useState(false);
  const onError = (e: unknown) => setMsg({ tone: 'negative', text: errorMessage(e) });
  const studiedMsg = (r: any) => r.cardCreated && setMsg({ tone: 'positive', text: 'Assunto concluído. A primeira revisão foi agendada.' });

  const toggle = useMutation({
    mutationFn: ({ methodId, done }: { methodId: string; done: boolean }) => api.post(`/api/planner/subjects/${subjectId}/methods/${methodId}`, { done }),
    onSuccess: (r: any) => { invalidate(); studiedMsg(r); }, onError,
  });
  const hide = useMutation({
    mutationFn: (hidden: boolean) => api.put(`/api/planner/subjects/${subjectId}/hidden`, { hidden }),
    onSuccess: (_r: any, hidden: boolean) => {
      invalidate();
      setMsg({ tone: 'neutral', text: hidden ? 'Tirado do planner. Continua na lista de assuntos, fora das contas.' : 'De volta ao planner.' });
    },
    onError,
  });
  const complete = useMutation({
    mutationFn: (done: boolean) => api.post(`/api/planner/subjects/${subjectId}/complete`, { done }),
    onSuccess: (r: any) => { invalidate(); studiedMsg(r); }, onError,
  });
  const activities = useMutation({
    mutationFn: (methodIds: string[] | null) => api.put(`/api/planner/subjects/${subjectId}/activities`, { methodIds }),
    onSuccess: (r: any) => { invalidate(); studiedMsg(r); }, onError,
  });
  const log = useMutation({
    mutationFn: () => api.post(`/api/planner/subjects/${subjectId}/practice`, { questions: Number(practice.questions), correct: Number(practice.correct), minutes: null }),
    onMutate: () => setMsg(null),
    onSuccess: (r: any) => {
      invalidate();
      setPractice({ questions: '', correct: '' });
      setMsg({ undoId: r.id, tone: r.reviewAnticipated ? 'neutral' : 'positive', text: r.reviewAnticipated
        ? `Registrado: ${r.performance?.questions_answered ?? ''} questões no total. Como o acerto ficou abaixo de 60%, a revisão foi antecipada.`
        : r.studied ? 'Registrado. Assunto concluído — revisão agendada.' : 'Questões registradas.' });
    },
    onError,
  });
  const undo = useMutation({
    mutationFn: (id: string) => api.del(`/api/planner/practice/${id}`),
    onSuccess: () => { invalidate(); setMsg({ tone: 'neutral', text: 'Registro de questões excluído.' }); }, onError,
  });

  const d = q.data;
  const s = d?.subject;
  const tpl = s?.perExam?.[0]?.template;
  const examQuestions: number = d?.exams?.[0]?.expectedTotalQuestions ?? 100;
  const today = todayBR();
  const busy = toggle.isPending || complete.isPending || activities.isPending;
  const doneCount = s?.checklist.filter((c: any) => c.done).length ?? 0;
  const studied = s?.status === 'studied';
  const selectedIds: string[] = s?.checklist.map((c: any) => c.methodId) ?? [];
  const pickActivity = (id: string) => {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    if (next.length) activities.mutate(next);
  };

  return (
    <Sheet open onClose={onClose} wide>
      {q.isLoading || !s ? <Spinner /> : (
        <div>
          <header>
            <Tint area={s.area} className="text-[12px] tracking-[0.12em] uppercase">{areaShort(s.area)}{s.specialty ? ` · ${s.specialty}` : ''}</Tint>
            <h2 className="mt-4 pr-8 font-display text-[40px] leading-[1.05]">{s.name}</h2>
            <p className="mt-3 text-[14px] text-ink-2" data-testid="subject-status">
              {studied ? <span className="text-ink">✓ Concluído</span> : `${doneCount} de ${s.checklist.length} ${s.checklist.length === 1 ? 'atividade' : 'atividades'}`}
            </p>
          </header>

          {s.hidden && (
            <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[12px] bg-fill px-4 py-3 text-[14px]" role="status">
              <span>Fora do planner: não aparece na semana nem nas revisões e não entra nas contas.</span>
              <Button variant="plain" size="sm" loading={hide.isPending} onClick={() => hide.mutate(false)}>Mostrar no planner de novo</Button>
            </div>
          )}

          {tpl && <TemplateInfo t={tpl} />}

          <ul className="mt-8 border-t border-line" aria-label="Atividades">
            {s.checklist.map((c: any) => (
              <li key={c.methodId} className="border-b border-line">
                <button role="checkbox" aria-checked={c.done} disabled={busy} onClick={() => toggle.mutate({ methodId: c.methodId, done: !c.done })}
                  className="flex w-full items-center gap-4 py-4 text-left transition-opacity hover:opacity-70">
                  <CheckCircle on={c.done} />
                  <span className={clsx('flex-1 text-[17px]', c.done && 'text-ink-3 line-through decoration-1')}>{c.name}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button variant="secondary" onClick={() => { pomodoro.start({ subject: { id: s.subjectId, name: s.name, area: s.area } }); onClose(); pomodoro.setExpanded(true); }}>
              Iniciar Pomodoro
            </Button>
            <Button variant="plain" size="sm" loading={complete.isPending} onClick={() => complete.mutate(!studied)}>
              {studied ? 'Desmarcar assunto' : 'Marcar assunto como concluído'}
            </Button>
            {!s.hidden && <Button variant="destructive" size="sm" loading={hide.isPending} onClick={() => hide.mutate(true)}>Excluir do planner</Button>}
          </div>

          {s.card?.nextReview && s.card.nextReview <= today && (
            <section className="mt-10">
              <p className="mb-3 text-[15px]">↻ Revisão de hoje — como foi lembrar deste assunto?</p>
              <ReviewButtons subjectId={s.subjectId} onDone={(t) => setMsg({ tone: 'positive', text: t })} />
            </section>
          )}
          {s.card && !(s.card.nextReview && s.card.nextReview <= today) && (
            <div className="mt-8">
              <p className="text-[14px] text-ink-2">
                ↻ Próxima revisão: <span className="text-ink">{s.card.nextReview ? `${shortDate(s.card.nextReview, false)} (${relativeDays(daysBetween(s.card.nextReview, today))})` : 'nenhuma antes da prova'}</span>
                {s.card.nextReview && !early && <> · <button className="text-ink underline underline-offset-4" onClick={() => setEarly(true)}>Adiantar revisão</button></>}
              </p>
              {early && <div className="mt-4 animate-in"><p className="mb-3 text-[15px]">Como foi lembrar deste assunto?</p><ReviewButtons subjectId={s.subjectId} onDone={(t) => { setEarly(false); setMsg({ tone: 'positive', text: t }); }} /></div>}
            </div>
          )}

          {msg && (
            <div className="mt-6 flex flex-wrap items-baseline gap-x-4">
              <Note tone={msg.tone}>{msg.text}</Note>
              {msg.undoId && <Button variant="plain" size="sm" loading={undo.isPending} onClick={() => undo.mutate(msg.undoId!)}>Desfazer</Button>}
            </div>
          )}

          <Advanced className="mt-12 border-t border-line pt-5">
            <div className="space-y-10">
              <section>
                <h3 className="text-[12px] tracking-[0.14em] text-ink-2 uppercase">Atividades deste assunto</h3>
                <p className="mt-1 text-[13px] text-ink-3">O assunto é concluído quando todas as atividades marcadas aqui forem feitas.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {d.allMethods.map((m: any) => {
                    const on = selectedIds.includes(m.id);
                    return (
                      <button key={m.id} disabled={busy || (on && selectedIds.length === 1)} aria-pressed={on} onClick={() => pickActivity(m.id)}
                        className={clsx('rounded-full border px-3.5 py-1.5 text-[14px] transition disabled:cursor-default',
                          on ? 'border-ink bg-ink text-canvas' : 'border-line text-ink-2 hover:border-ink hover:text-ink')}>
                        {m.name}{m.minutes ? <span className="opacity-60"> · {minutes(m.minutes)}</span> : null}
                      </button>
                    );
                  })}
                </div>
                {s.customActivities && <Button variant="plain" size="sm" className="mt-3" onClick={() => activities.mutate(null)}>Usar as atividades padrão</Button>}
              </section>

              <section>
                <h3 className="text-[12px] tracking-[0.14em] text-ink-2 uppercase">Questões</h3>
                <p className="mt-1 text-[14px] text-ink-2">
                  {s.performance.answered ? <>{s.performance.answered} feitas · <span className="text-ink">{pct(s.performance.accuracy, 0)}</span> de acerto</> : 'Opcional. Nenhuma registrada ainda.'}
                </p>
                <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); log.mutate(); }}>
                  <input className="field w-24" aria-label="Questões feitas" type="number" min={1} required placeholder="Feitas" value={practice.questions} onChange={(e) => setPractice({ ...practice, questions: e.target.value })} />
                  <input className="field w-24" aria-label="Acertos" type="number" min={0} required placeholder="Acertos" value={practice.correct} onChange={(e) => setPractice({ ...practice, correct: e.target.value })} />
                  <Button type="submit" variant="secondary" loading={log.isPending}>Registrar</Button>
                </form>
                {d.practice.length > 0 && (
                  <ul className="mt-4 border-t border-line text-[14px]" aria-label="Registros de questões">
                    {d.practice.map((p: any) => (
                      <li key={p.id} className="flex items-center justify-between gap-4 border-b border-line py-2">
                        <span><span className="tabular text-ink">{p.correct_count}/{p.questions_count}</span> <span className="text-ink-3">· {dateTimeBR(p.practiced_at)}</span></span>
                        <Button variant="destructive" size="sm" disabled={undo.isPending} onClick={() => undo.mutate(p.id)} aria-label={`Excluir registro de ${p.questions_count} questões`}>Excluir</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="border-t border-line">
                <Disclosure summary="Por que este assunto?" className="border-b border-line">
                  <p className="text-[14px] text-ink-2">{LEVEL_TEXT[s.level]} · #{s.rank} · {pct(s.percentage)} da prova{!s.scheduled && ' · fora do tempo disponível'}</p>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{d.explanation}</p>
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

                <Disclosure summary="Quanto da prova" className="border-b border-line">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[15px]">
                    <div><dt className="text-ink-2">Vale na prova</dt><dd className="tabular font-display text-[30px]">{pct(s.percentage)} <span className="font-sans text-[14px] text-ink-3">≈ {num1(s.percentage * examQuestions)} questões</span></dd></div>
                    <div><dt className="text-ink-2">Você garantiu</dt><dd className="tabular font-display text-[30px]">{studied ? pct(s.percentage) : '0%'}</dd></div>
                    {s.card && <>
                      <div><dt className="text-ink-2">Lembrança hoje</dt><dd className="tabular">{pct(s.card.retrievability, 0)}</dd></div>
                      <div><dt className="text-ink-2">Estabilidade</dt><dd className="tabular">{num1(s.card.stability)} dias</dd></div>
                      <div><dt className="text-ink-2">Último estudo</dt><dd>{s.lastStudiedAt ? relativeDays(-daysBetween(today, isoBR(s.lastStudiedAt))) : '—'}</dd></div>
                    </>}
                  </dl>
                  <p className="mt-4 text-[13px] text-ink-3">{studied ? 'Assunto concluído: a fatia dele na prova conta como garantida.' : 'Conclua o assunto para garantir a fatia dele na prova.'} Em média, caiu {pct(s.percentage)} das questões nas provas analisadas.</p>
                </Disclosure>

                <Disclosure summary="Prioridade de hoje" className="border-b border-line">
                  <p className="text-[15px]"><span className="tabular font-display text-[30px]">{num1(s.dynamic.score)}</span> <span className="text-ink-3">de 100</span></p>
                  <dl className="mt-3 space-y-1 text-[14px] text-ink-2">
                    {([['historical', 'Histórico'], ['proximity', 'Proximidade da prova'], ['forgetting', 'Esquecimento'], ['performance', 'Desempenho']] as const).map(([k, l]) => (
                      <div key={k} className="flex justify-between"><dt>{l}</dt><dd className="tabular">{num1(s.dynamic.components[k] * 100)} / {Math.round(d.weights[k] * 100)}</dd></div>
                    ))}
                  </dl>
                </Disclosure>

                {(d.subtopics.length > 0 || d.reviews.length > 0) && (
                  <Disclosure summary="Histórico e subassuntos" className="border-b border-line">
                    {d.subtopics.length > 0 && <p className="text-[14px] leading-relaxed text-ink-2">{d.subtopics.slice(0, 40).join(' · ')}</p>}
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
          </Advanced>
        </div>
      )}
    </Sheet>
  );
}

const COLOR_TINT: Record<string, string> = { Diamante: 'tint-sky', Verde: 'tint-mint', Amarela: 'tint-butter', Bônus: 'tint-lilac', Resumo: 'tint-peach' };

/** Dados do cronograma pessoal: aula, foco dos cards e questões da prova para fazer. */
function TemplateInfo({ t }: { t: any }) {
  const byYear = new Map<number, number[]>();
  for (const [y, n] of t.refs ?? []) byYear.set(y, [...(byYear.get(y) ?? []), n]);
  const br = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
  return (
    <section className="mt-6 border-l-2 border-line pl-4 text-[14px]" aria-label="Do seu cronograma">
      <p className="text-[11px] tracking-[0.16em] text-ink-2 uppercase">Do seu cronograma</p>
      {t.lesson && (
        <p className="mt-2">Aula MEDCOF: <span className="text-ink">{t.lesson}</span>
          {t.color && <span className={`tint ${COLOR_TINT[t.color.split('/')[0]] ?? 'tint-peach'} ml-2 text-[11px]`}>{t.color}</span>}</p>
      )}
      {t.kind === 'studied' && <p className="mt-1 text-ink-2">Já estudado · {t.cards} cards no Anki{t.fragile ? ' · baralho frágil' : ''} · questões no sábado {br(t.saturday)}</p>}
      {t.focus && <p className="mt-1 text-ink-2">Foco para os cards: <span className="text-ink">{t.focus}</span></p>}
      {t.detail && <p className="mt-1 text-ink-2">{t.detail}</p>}
      {byYear.size > 0 && (
        <p className="mt-1 text-ink-2">Questões da UNOESTE: {[...byYear].map(([y, ns]) => `${y}: ${ns.map((n) => `Q${n}`).join(', ')}`).join(' · ')}</p>
      )}
    </section>
  );
}
