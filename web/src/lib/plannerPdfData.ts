/**
 * Dados do planner em PDF: busca pelas mesmas rotas das telas (calendário,
 * agenda, residências) e entrega pronto para o desenho em plannerPdf.ts.
 */
import { api } from './api';
import type { AgendaRange, AgendaTask } from './agenda';
import { allEvents, type ResidencyView } from './residency';
import { addDays } from '../../../shared/dates';
import { buildPlannerPdf, type PdfDay, type PdfInput, type PdfTask } from './plannerPdf';

export interface PdfOptions { from: string; to: string; agenda: boolean; reviews: boolean }

/** Busca tudo o que vai no PDF, do dia `from` ao dia `to`. */
export async function collectPlannerPdf(opts: PdfOptions, ctx: { planner: any; residencies?: ResidencyView[]; owner?: string; today: string }): Promise<PdfInput> {
  const { from, to } = opts;
  // O calendário aceita até 62 dias por consulta
  const calendar: any[] = [];
  for (let a = from; a <= to; a = addDays(a, 60)) {
    const b = addDays(a, 59) < to ? addDays(a, 59) : to;
    const r: any = await api.get(`/api/reviews/calendar?from=${a}&to=${b}`);
    calendar.push(...(r?.days ?? []));
  }
  let agenda: AgendaRange | null = null;
  if (opts.agenda) {
    // A Agenda pode não estar ativada no banco: o PDF sai sem ela
    try { agenda = await api.get<AgendaRange>(`/api/agenda?from=${from}&to=${to}`); } catch { agenda = null; }
  }
  const events = allEvents(ctx.residencies).filter((e) => e.date >= from && e.date <= to);
  const byDate = new Map<string, PdfDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) byDate.set(d, { date: d, subjects: [], reviews: [], tasks: [], exams: [], events: [] });
  for (const c of calendar) {
    const day = byDate.get(c.date);
    if (!day) continue;
    day.exams = [...c.exams];
    day.subjects = c.newSubjects.map((n: any) => ({ name: n.name, area: n.area, specialty: n.specialty, methods: n.methods ?? [], done: !!n.done }));
    if (opts.reviews) {
      const seen = new Set<string>();
      for (const r of c.reviews) {
        if (seen.has(r.subjectId)) continue;
        seen.add(r.subjectId);
        day.reviews.push({ name: r.name, done: r.status === 'done', overdue: r.status === 'overdue' });
      }
    }
  }
  for (const e of events) byDate.get(e.date)?.events.push({ residency: e.residency, label: e.label, type: e.type, done: e.done });
  if (agenda) {
    for (const t of agenda.tasks) if (t.date) byDate.get(t.date)?.tasks.push(toPdfTask(t));
    for (const [d, n] of Object.entries(agenda.notes)) { const day = byDate.get(d); if (day && n.trim()) day.note = n.trim(); }
  }
  const p = ctx.planner;
  const primary = p.exams.find((e: any) => e.is_primary) ?? p.exams[0];
  const template = !!p.plan.summary?.template;
  return {
    title: 'Cronograma de estudos',
    subtitle: !p.exams.length ? 'Meu planner' : template ? p.plan.name : primary ? `${primary.institution}${primary.exam_name ? ` · ${primary.exam_name}` : ''}` : p.plan.name,
    owner: ctx.owner,
    today: ctx.today,
    from, to,
    exams: p.exams.map((e: any) => ({ name: e.institution, date: e.exam_date ?? null })),
    days: [...byDate.values()],
    general: (agenda?.general ?? []).map(toPdfTask),
    withAgenda: !!agenda,
    withReviews: opts.reviews,
  };
}

const toPdfTask = (t: AgendaTask): PdfTask => ({ title: t.title, time: t.time, kind: t.kind, priority: t.priority, done: t.done, note: t.note, checklist: t.checklist ?? [] });

/** Baixa o arquivo (no app do celular, abre o "Compartilhar" para salvar ou enviar). */
export async function saveFile(blob: Blob, name: string, share = false) {
  if (share) {
    const file = new File([blob], name, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], title: name }); return; } catch (e) { if ((e as Error)?.name === 'AbortError') return; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const pdfFileName = (input: Pick<PdfInput, 'subtitle' | 'from' | 'to'>) => {
  const slug = (input.subtitle ?? 'planner').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `planner-${slug || 'estudos'}-${input.from}-a-${input.to}.pdf`;
};

/** Busca, desenha e baixa. */
export async function downloadPlannerPdf(opts: PdfOptions, ctx: Parameters<typeof collectPlannerPdf>[1] & { share?: boolean }) {
  const input = await collectPlannerPdf(opts, ctx);
  const blob = buildPlannerPdf(input).output('blob');
  await saveFile(blob, pdfFileName(input), ctx.share);
}
