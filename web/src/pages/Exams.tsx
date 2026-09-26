import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { api, errorMessage } from '../lib/api';
import { daysText, pct, REG_STATUS, shortDate, WINDOW_LABEL } from '../lib/format';
import { Advanced, Button, Empty, Field, Note, Section, Sheet, Spinner, Tint, Title, Toggle } from '../components/ui';

export function ExamsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exams'], queryFn: () => api.get<any[]>('/api/exams') });
  const [open, setOpen] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.put(`/api/me/editions/${id}`, body),
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ['exams'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (e) => setErr(errorMessage(e)),
  });
  if (q.isLoading) return <Spinner />;
  const all = q.data ?? [];
  const mine = all.filter((e) => e.selected);
  const others = all.filter((e) => !e.selected);
  const update = (id: string, body: any) => m.mutate({ id, body });

  return (
    <div className="mx-auto max-w-2xl">
      <Title>Provas</Title>
      {err && <Note tone="negative" className="-mt-8 mb-8">{err}</Note>}
      {all.length === 0 ? (
        <Empty title="Nenhuma prova disponível">Ainda não há provas com análise de questões cadastrada.</Empty>
      ) : (
        <div className="space-y-16">
          <Section label="Minhas provas">
            {mine.length === 0 ? (
              <p className="border-t border-line pt-5 text-[17px] text-ink-2">Você ainda não escolheu uma prova.</p>
            ) : (
              <ExamList exams={mine} open={open} setOpen={setOpen} update={update} showHistory={setHistoryOf} />
            )}
          </Section>
          {others.length > 0 && (
            <Section label={mine.length ? 'Adicionar outra prova' : 'Escolha sua prova'}>
              <ExamList exams={others} open={open} setOpen={setOpen} update={update} showHistory={setHistoryOf} />
            </Section>
          )}
        </div>
      )}
      {historyOf && <HistorySheet exam={historyOf} onClose={() => setHistoryOf(null)} />}
    </div>
  );
}

function ExamList({ exams, open, setOpen, update, showHistory }: {
  exams: any[]; open: string | null; setOpen: (id: string | null) => void; update: (id: string, body: any) => void; showHistory: (e: any) => void;
}) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {exams.map((e) => {
        const isOpen = open === e.edition_id;
        return (
          <article key={e.edition_id} data-testid={`exam-${e.institution}`}>
            <button onClick={() => setOpen(isOpen ? null : e.edition_id)} aria-expanded={isOpen}
              className="flex w-full items-center gap-4 py-5 text-left transition-opacity hover:opacity-70">
              <div className="min-w-0 flex-1">
                <div className="font-display text-[30px] leading-tight">{e.institution}</div>
                <div className="mt-0.5 text-[14px] text-ink-2">{e.exam_name}{e.is_primary && ' · principal'}</div>
              </div>
              <div className="shrink-0 text-right">
                {e.selected ? (
                  e.exam_date ? (
                    <>
                      <div className="tabular font-display text-[22px] leading-tight">{shortDate(e.exam_date)}</div>
                      <div className="text-[13px] text-ink-2">{e.days_left >= 0 ? daysText(e.days_left) : 'realizada'}</div>
                    </>
                  ) : <Tint area="GO" className="text-[14px]">Definir data</Tint>
                ) : (
                  <>
                    {e.date_official && <div className="tabular font-display text-[22px] leading-tight">{shortDate(e.exam_date)}</div>}
                    <span className="text-[14px] text-ink underline underline-offset-4">Adicionar</span>
                  </>
                )}
              </div>
              <ChevronDown className={clsx('h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200 ease-apple', isOpen && 'rotate-180')} />
            </button>
            {isOpen && <ExamDetails exam={e} update={update} showHistory={() => showHistory(e)} />}
          </article>
        );
      })}
    </div>
  );
}

/** Detalhes sob demanda. Data, inscrição e valor são informados pelo próprio aluno. */
function ExamDetails({ exam, update, showHistory }: { exam: any; update: (id: string, body: any) => void; showHistory: () => void }) {
  const initial = () => ({
    examDate: exam.exam_date ?? '', registrationStart: exam.registration_start ?? '',
    registrationEnd: exam.registration_end ?? '', registrationFee: exam.registration_fee != null ? String(exam.registration_fee) : '',
  });
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(initial()), [exam.exam_date, exam.registration_start, exam.registration_end, exam.registration_fee]);
  const save = (key: keyof typeof v, value: string) => {
    if (value === initial()[key]) return;
    update(exam.edition_id, { [key]: key === 'registrationFee' ? (value === '' ? null : Number(value)) : value || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  const input = (key: keyof typeof v, label: string, type: string, extra: any = {}) => (
    <Field label={label}>
      <input type={type} className="field" aria-label={`${label} - ${exam.institution}`} value={v[key]} {...extra}
        onChange={(ev) => setV({ ...v, [key]: ev.target.value })} onBlur={(ev) => save(key, ev.target.value)} />
    </Field>
  );
  const w = WINDOW_LABEL[exam.registration_window];

  if (!exam.selected) {
    return (
      <div className="pb-8 animate-in">
        <p className="text-[15px] text-ink-2">{exam.institution_name}. {exam.history.message}</p>
        <div className="mt-6 flex flex-wrap items-center gap-6">
          <Button onClick={() => update(exam.edition_id, { selected: true })}>Adicionar à minha preparação</Button>
          <Button variant="plain" onClick={showHistory}>Assuntos mais cobrados</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8 animate-in">
      {exam.date_official ? (
        <p className="text-[15px]">Prova em <span className="font-display text-[22px]">{shortDate(exam.exam_date)}</span> <span className="text-[13px] text-ink-3">· data oficial</span></p>
      ) : <div className="max-w-[12rem]">{input('examDate', 'Data da prova', 'date')}</div>}
      <div className="mt-2 h-5 text-[13px]">{saved ? <span className="text-ink">✓ Salvo</span> : exam.registration_window !== 'unknown' && <span className="text-ink-3">{w.label}</span>}</div>

      <Advanced className="mt-4" label="Inscrição, valor e mais">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        {input('registrationStart', 'Inscrição: início', 'date')}
        {input('registrationEnd', 'Inscrição: fim', 'date')}
        {input('registrationFee', 'Valor (R$)', 'number', { min: 0, step: '0.01', placeholder: '0,00' })}
      </div>
      <div className="mt-6 divide-y divide-line border-y border-line">
        <label className="flex items-center justify-between gap-4 py-3.5">
          <span className="text-[15px]">Situação da inscrição</span>
          <select aria-label="Situação da inscrição" className="max-w-[55%] bg-transparent text-right text-[15px] text-ink-2 outline-none"
            value={exam.registration_status ?? ''} onChange={(ev) => update(exam.edition_id, { status: ev.target.value || null })}>
            <option value="">Não informada</option>
            {Object.entries(REG_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-[15px]">Prova principal</span>
          <Toggle label="Prova principal" checked={exam.is_primary} onChange={(on) => on && update(exam.edition_id, { isPrimary: true })} />
        </div>
      </div>
      </Advanced>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <Button variant="plain" onClick={showHistory}>Assuntos mais cobrados</Button>
        <Button variant="destructive" onClick={() => update(exam.edition_id, { selected: false })}>Remover</Button>
      </div>
      <p className="mt-6 text-[13px] text-ink-3">{exam.institution_name} · {exam.history.message}</p>
    </div>
  );
}

function HistorySheet({ exam, onClose }: { exam: any; onClose: () => void }) {
  const q = useQuery({ queryKey: ['history', exam.exam_id], queryFn: () => api.get(`/api/exams/${exam.exam_id}/history`) });
  const [showAll, setShowAll] = useState(false);
  const h = q.data;
  return (
    <Sheet open onClose={onClose} wide title={`O que mais cai na ${exam.institution}`}>
      {q.isLoading ? <Spinner /> : !h ? null : (
        <>
          <p className="-mt-3 mb-6 text-[15px] text-ink-2">
            {h.message}{h.editionsAnalyzed > 0 && ` ${h.years[0]}–${h.years[h.years.length - 1]}, ${h.totalQuestions} questões.`}
          </p>
          <ol className="divide-y divide-line border-y border-line">
            {(showAll ? h.subjects : h.subjects.slice(0, 15)).map((s: any) => (
              <li key={s.subjectId} className="flex items-center gap-4 py-3.5">
                <span className="tabular w-6 text-[14px] text-ink-3">{s.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[17px]">{s.name}</div>
                  <div className="truncate text-[13px] text-ink-2">{s.area}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular text-[17px]">{pct(s.percentage)}</div>
                  <div className="tabular text-[13px] text-ink-3" title="Edições em que apareceu">{s.questions} q · {s.editionsPresent}/{s.editionsAnalyzed}</div>
                </div>
              </li>
            ))}
          </ol>
          {h.subjects.length > 15 && (
            <Button variant="plain" className="mt-4" onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar menos' : `Mostrar todos (${h.subjects.length})`}</Button>
          )}
          <p className="mt-6 text-[13px] text-ink-3">% = fração das questões da prova. "6/6" = edições em que o assunto apareceu. Tudo calculado a partir das questões cadastradas.</p>
        </>
      )}
    </Sheet>
  );
}
