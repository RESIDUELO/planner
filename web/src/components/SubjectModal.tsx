import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Circle, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { dateBR, dateTimeBR, daysBetween, isoBR, LEVEL_TONE, num1, pct, relativeDays, todayBR } from '../lib/format';
import { Alert, Badge, Button, Hint, MiniBars, Modal, Progress, Spinner } from './ui';
import { ReviewButtons } from './ReviewButtons';

const RATING_LABEL: Record<string, string> = { again: 'Errei', hard: 'Difícil', good: 'Bom', easy: 'Fácil' };

export function useInvalidateStudy() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['planner', 'today', 'dashboard', 'subject', 'calendar', 'performance']) qc.invalidateQueries({ queryKey: [k] });
  };
}

export function SubjectModal({ subjectId, onClose }: { subjectId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['subject', subjectId], queryFn: () => api.get(`/api/planner/subjects/${subjectId}`) });
  const invalidate = useInvalidateStudy();
  const [msg, setMsg] = useState<{ tone: 'ok' | 'late' | 'info'; text: string } | null>(null);
  const [practice, setPractice] = useState({ questions: '', correct: '', minutes: '' });

  const toggle = useMutation({
    mutationFn: ({ methodId, done }: { methodId: string; done: boolean }) => api.post(`/api/planner/subjects/${subjectId}/methods/${methodId}`, { done }),
    onSuccess: (r: any) => {
      invalidate();
      if (r.cardCreated) setMsg({ tone: 'ok', text: 'Assunto estudado! A primeira revisão foi agendada.' });
    },
    onError: (e) => setMsg({ tone: 'late', text: errorMessage(e) }),
  });
  const log = useMutation({
    mutationFn: () => api.post(`/api/planner/subjects/${subjectId}/practice`, {
      questions: Number(practice.questions), correct: Number(practice.correct), minutes: practice.minutes ? Number(practice.minutes) : null,
    }),
    onSuccess: (r: any) => {
      invalidate();
      setPractice({ questions: '', correct: '', minutes: '' });
      setMsg({ tone: r.reviewAnticipated ? 'info' : 'ok', text: r.reviewAnticipated
        ? 'Registrado. Como o acerto ficou abaixo de 60%, a próxima revisão foi antecipada.'
        : r.studied ? 'Registrado. Assunto estudado — revisão agendada.' : 'Questões registradas.' });
    },
    onError: (e) => setMsg({ tone: 'late', text: errorMessage(e) }),
  });
  const undo = useMutation({ mutationFn: (id: string) => api.del(`/api/planner/practice/${id}`), onSuccess: invalidate });

  const d = q.data;
  const s = d?.subject;
  const today = todayBR();
  return (
    <Modal open onClose={onClose} wide title={s ? `${String(s.rank).padStart(2, '0')} — ${s.name}` : 'Assunto'}>
      {q.isLoading || !s ? <Spinner /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={LEVEL_TONE[s.level]}>Prioridade {s.levelLabel.toLowerCase()}</Badge>
            <Badge>{s.area}{s.specialty ? ` › ${s.specialty}` : ''}</Badge>
            {s.status === 'studied' && <Badge tone="ok"><CheckCircle2 className="h-3 w-3" /> Estudado</Badge>}
            {!s.scheduled && <Badge tone="warn">Fora do tempo disponível</Badge>}
          </div>

          <section className="rounded-lg bg-brand-50 p-4 text-sm text-brand-900">
            <div className="font-semibold">Por que está em #{s.rank}?</div>
            <p className="mt-1">{d.explanation}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><dt className="text-xs text-brand-700">Fração da prova</dt><dd className="tabular font-semibold">{pct(s.percentage)}</dd></div>
              <div><dt className="text-xs text-brand-700">Questões (histórico)</dt><dd className="tabular font-semibold">{num1(s.frequency)}</dd></div>
              <div><dt className="text-xs text-brand-700">Média por edição</dt><dd className="tabular font-semibold">{num1(s.annualAverage)}</dd></div>
              <div><dt className="text-xs text-brand-700">Esperadas na prova</dt><dd className="tabular font-semibold">{num1(s.estimatedQuestions)}</dd></div>
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Presença nas edições cadastradas</h3>
            <div className="space-y-3">
              {s.perExam.map((pe: any) => {
                const ex = d.exams.find((e: any) => e.editionId === pe.editionId);
                return (
                  <div key={pe.editionId} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-slate-800">{ex?.label}</span>
                      <span className="text-xs text-slate-500">
                        {pe.percentage > 0 ? <>{pct(pe.percentage)} · {pe.questions} questões · {pe.editionsPresent}/{pe.editionsAnalyzed} edições · #{pe.rank}</> : 'Não apareceu nesta prova'}
                      </span>
                    </div>
                    {pe.byYear?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {pe.byYear.map((y: any) => (
                          <span key={y.year} title={`${y.year}: ${y.questions} questão(ões)`}
                            className={`tabular inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${y.questions ? 'bg-ok-50 text-ok-700' : 'bg-slate-100 text-slate-400'}`}>
                            {y.year} {y.questions ? <>✓ <b>{y.questions}</b></> : '—'}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-slate-400">{ex?.message}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Seu estudo</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {s.checklist.map((c: any) => (
                <button key={c.methodId} disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ methodId: c.methodId, done: !c.done })}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${c.done ? 'border-ok-500/40 bg-ok-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  {c.done ? <CheckCircle2 className="h-5 w-5 text-ok-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                  <span className="flex-1 font-medium">{c.name}</span>
                  <span className="text-xs text-slate-500">{c.done ? dateBR(c.completedAt) : c.scheduledDate ? `${dateBR(c.scheduledDate)} · ${c.minutes} min` : ''}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3"><Progress value={s.progress} tone={s.progress === 1 ? 'ok' : 'brand'} /><span className="tabular text-xs font-medium text-slate-600">{pct(s.progress, 0)}</span></div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Questões</h3>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><div className="tabular text-xl font-semibold">{s.performance.answered}</div><div className="text-xs text-slate-500">realizadas</div></div>
                <div><div className="tabular text-xl font-semibold text-ok-700">{s.performance.correct}</div><div className="text-xs text-slate-500">acertos</div></div>
                <div><div className="tabular text-xl font-semibold">{pct(s.performance.accuracy, 0)}</div><div className="text-xs text-slate-500">acerto</div></div>
              </div>
              <form className="mt-4 grid grid-cols-3 gap-2" onSubmit={(e) => { e.preventDefault(); log.mutate(); }}>
                <input className="input" aria-label="Questões feitas" type="number" min={1} required placeholder="Feitas" value={practice.questions} onChange={(e) => setPractice({ ...practice, questions: e.target.value })} />
                <input className="input" aria-label="Acertos" type="number" min={0} required placeholder="Acertos" value={practice.correct} onChange={(e) => setPractice({ ...practice, correct: e.target.value })} />
                <input className="input" aria-label="Minutos" type="number" min={0} placeholder="Min" value={practice.minutes} onChange={(e) => setPractice({ ...practice, minutes: e.target.value })} />
                <Button type="submit" className="col-span-3" size="sm" loading={log.isPending}>Registrar questões</Button>
              </form>
              {d.practice.length > 0 && (
                <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto text-xs text-slate-600">
                  {d.practice.map((p: any) => (
                    <li key={p.id} className="flex items-center justify-between">
                      <span>{dateTimeBR(p.practiced_at)} · {p.correct_count}/{p.questions_count}</span>
                      <button onClick={() => undo.mutate(p.id)} className="text-slate-400 hover:text-late-500" aria-label="Excluir registro"><Trash2 className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">Domínio e memória <Hint text={`Domínio = acerto suavizado ((acertos + ${d.mastery.priorWeight}×50%) / (questões + ${d.mastery.priorWeight})) × probabilidade atual de lembrar. É uma estimativa, não uma promessa.`} /></h3>
              <div className="mt-2 flex items-baseline gap-2"><span className="tabular text-2xl font-semibold">{pct(s.mastery.mastery, 0)}</span><span className="text-xs text-slate-500">domínio estimado</span></div>
              <p className="text-xs text-slate-500">{num1(s.estimatedQuestions * s.mastery.mastery)} de {num1(s.estimatedQuestions)} questões esperadas potencialmente dominadas</p>
              {s.card ? (
                <dl className="mt-3 space-y-1 text-xs text-slate-600">
                  <div className="flex justify-between"><dt>Probabilidade de lembrar hoje</dt><dd className="tabular font-medium">{pct(s.card.retrievability, 0)}</dd></div>
                  <div className="flex justify-between"><dt>Estabilidade</dt><dd className="tabular font-medium">{num1(s.card.stability)} dias</dd></div>
                  <div className="flex justify-between"><dt>Último estudo</dt><dd className="font-medium">{s.lastStudiedAt ? relativeDays(-daysBetween(today, isoBR(s.lastStudiedAt))) : '—'}</dd></div>
                  <div className="flex justify-between"><dt>Próxima revisão</dt><dd className="font-medium">{s.card.nextReview ? `${dateBR(s.card.nextReview)} (${relativeDays(daysBetween(s.card.nextReview, today))})` : 'nenhuma antes da prova'}</dd></div>
                </dl>
              ) : <p className="mt-3 text-xs text-slate-500">Conclua o checklist para iniciar as revisões espaçadas.</p>}
              {s.card?.nextReview && s.card.nextReview <= today && (
                <div className="mt-3"><ReviewButtons subjectId={s.subjectId} onDone={(r) => setMsg({ tone: 'ok', text: r })} /></div>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">Prioridade dinâmica <Hint text="Usada para decidir o que fazer primeiro no dia: 40% histórico, 25% proximidade da prova, 20% esquecimento, 15% desempenho." /></h3>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">Score</div><div className="tabular text-base font-semibold">{num1(s.dynamic.score)}</div></div>
              {([['historical', 'Histórico'], ['proximity', 'Proximidade'], ['forgetting', 'Esquecimento'], ['performance', 'Desempenho']] as const).map(([k, l]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">{l}</div><div className="tabular text-base font-semibold">{num1(s.dynamic.components[k] * 100)}</div><div className="text-[10px] text-slate-400">de {Math.round(d.weights[k] * 100)}</div></div>
              ))}
            </div>
          </section>

          {d.subtopics.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Subassuntos cobrados</h3>
              <div className="flex flex-wrap gap-1.5">{d.subtopics.slice(0, 40).map((t: string) => <Badge key={t}>{t}</Badge>)}</div>
            </section>
          )}

          {d.reviews.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Histórico de revisões</h3>
              <MiniBars height={40} data={[...d.reviews].reverse().map((r: any, i: number) => ({ label: String(i + 1), value: Math.round(r.new_interval), title: `${dateTimeBR(r.reviewed_at)} · ${RATING_LABEL[r.rating]} · intervalo ${Math.round(r.new_interval)} dia(s)` }))} />
              <p className="mt-1 text-xs text-slate-500">Intervalo (dias) definido após cada avaliação.</p>
            </section>
          )}

          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <p className="flex items-center gap-1 text-[11px] text-slate-400"><Check className="h-3 w-3" /> Todos os números vêm das questões cadastradas e dos seus registros.</p>
        </div>
      )}
    </Modal>
  );
}
