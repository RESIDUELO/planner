import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/api';
import { shortDate, todayBR } from '../lib/format';
import { IS_LOCAL } from '../lib/platform';
import { useResidencies } from '../lib/residency';
import { toast } from '../lib/toast';
import { addDays } from '../../../shared/dates';
import { Button, Note, Segmented, Sheet, Toggle } from './ui';

type Period = 'all' | 'ahead';
/** Até onde vai o PDF de um planner montado à mão (sem prova, ele não tem fim). */
const MANUAL_WEEKS = 12;
/** Um ano e pouco: o bastante para qualquer cronograma, sem virar um livro. */
const MAX_DAYS = 400;

/** Período do PDF: do início do plano (ou de hoje) até a última prova. */
export function pdfRange(data: any, period: Period, today = todayBR()) {
  const start: string = data.plan.start_date;
  const from = period === 'ahead' && today > start ? today : start;
  const exams = (data.exams as any[]).map((e) => e.exam_date).filter(Boolean) as string[];
  let to: string = !exams.length
    ? addDays(from > today ? from : today, MANUAL_WEEKS * 7 - 1)
    : [data.plan.end_date, ...exams].filter(Boolean).sort().at(-1)!;
  if (to < from) to = from;
  if (to > addDays(from, MAX_DAYS)) to = addDays(from, MAX_DAYS);
  return { from, to };
}

/** "Baixar em PDF": o cronograma inteiro, com a agenda junto. */
export function PlannerPdfSheet({ data, onClose }: { data: any; onClose: () => void }) {
  const { user } = useAuth();
  const residencies = useResidencies();
  const today = todayBR();
  const started = data.plan.start_date < today;
  const [period, setPeriod] = useState<Period>('all');
  const [agenda, setAgenda] = useState(true);
  const [reviews, setReviews] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { from, to } = pdfRange(data, period, today);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { downloadPlannerPdf } = await import('../lib/plannerPdfData');
      await downloadPlannerPdf({ from, to, agenda, reviews }, {
        planner: data, residencies: residencies.data, today, share: IS_LOCAL,
        owner: user && !user.isGuest ? user.name : undefined,
      });
      toast('✓ PDF do planner pronto');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const row = 'flex items-center justify-between gap-4 py-3';
  return (
    <Sheet open onClose={onClose} title="Baixar o planner em PDF">
      <p className="text-[16px] text-ink-2">
        Um arquivo com o cronograma todo: a capa com as provas e as datas importantes, um calendário por mês e cada dia com as aulas, as revisões e as tarefas.
      </p>
      {started && (
        <div className="mt-6">
          <Segmented value={period} onChange={setPeriod}
            options={[{ value: 'all', label: 'Desde o início' }, { value: 'ahead', label: 'De hoje em diante' }]} />
        </div>
      )}
      <p className="mt-4 text-[15px]" data-testid="pdf-range">{shortDate(from)} a {shortDate(to)}</p>
      {!data.exams.length && <p className="mt-1 text-[13px] text-ink-3">Sem prova escolhida, o PDF mostra as próximas {MANUAL_WEEKS} semanas.</p>}
      <div className="mt-6 border-y border-line">
        <div className={row}><span className="text-[15px]">Incluir a agenda<span className="block text-[13px] text-ink-3">Tarefas, lembretes e anotações de cada dia</span></span>
          <Toggle label="Incluir a agenda" checked={agenda} onChange={setAgenda} /></div>
        <div className={`${row} border-t border-line`}><span className="text-[15px]">Incluir as revisões</span>
          <Toggle label="Incluir as revisões" checked={reviews} onChange={setReviews} /></div>
      </div>
      {error && <Note tone="negative" className="mt-6">{error}</Note>}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button onClick={download} loading={busy} data-testid="pdf-download">Baixar PDF</Button>
        <Button variant="plain" onClick={onClose}>Cancelar</Button>
      </div>
    </Sheet>
  );
}
