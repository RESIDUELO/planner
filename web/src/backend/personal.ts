/**
 * Agenda: organização pessoal (tarefas do dia, lembretes, tarefas gerais e
 * anotações por dia). Não toca em nada do planner de estudos; o planner só
 * lê as tarefas marcadas com "Mostrar no Planner".
 */
import { z } from 'zod';
import type { ISODate } from '../../../shared/dates';
import { badRequest, currentUserId, notFound, q, selectAll, type Ctx } from './core';

export interface AgendaTask {
  id: string;
  kind: 'day' | 'reminder' | 'general';
  title: string;
  date: ISODate | null;
  time: string | null;
  priority: 1 | 2 | 3 | null;
  note: string;
  checklist: { text: string; done: boolean }[];
  showInPlanner: boolean;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
}

const COLS = 'id, kind, title, date, time, priority, note, checklist, show_in_planner, done, done_at, position, created_at';

function toTask(r: any): AgendaTask {
  return {
    id: r.id, kind: r.kind, title: r.title, date: r.date ?? null, time: r.time ? String(r.time).slice(0, 5) : null,
    priority: r.priority ?? null, note: r.note ?? '', checklist: Array.isArray(r.checklist) ? r.checklist : [],
    showInPlanner: !!r.show_in_planner, done: !!r.done, doneAt: r.done_at ?? null, createdAt: r.created_at,
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).');
const fields = {
  kind: z.enum(['day', 'reminder', 'general']),
  title: z.string().trim().min(1, 'Escreva a tarefa.').max(300),
  date: isoDate.nullable(),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido (HH:MM).').nullable(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  note: z.string().max(2000),
  checklist: z.array(z.object({ text: z.string().trim().min(1).max(200), done: z.boolean() })).max(50),
  showInPlanner: z.boolean(),
  done: z.boolean(),
};
const createSchema = z.object(fields).partial().required({ title: true });
const updateSchema = z.object(fields).partial();

function toRow(b: Partial<Omit<AgendaTask, 'id' | 'doneAt' | 'createdAt'>>) {
  const r: Record<string, unknown> = {};
  if (b.kind !== undefined) r.kind = b.kind;
  if (b.title !== undefined) r.title = b.title;
  if (b.date !== undefined) r.date = b.date;
  if (b.time !== undefined) r.time = b.time;
  if (b.priority !== undefined) r.priority = b.priority;
  if (b.note !== undefined) r.note = b.note;
  if (b.checklist !== undefined) r.checklist = b.checklist;
  if (b.showInPlanner !== undefined) r.show_in_planner = b.showInPlanner;
  if (b.done !== undefined) { r.done = b.done; r.done_at = b.done ? new Date().toISOString() : null; }
  return r;
}

const byOrder = (a: any, b: any) => (a.time ?? '99').localeCompare(b.time ?? '99') || a.position - b.position;

/** Um período da agenda: as tarefas com data nele, todas as tarefas gerais e as anotações. */
export async function agendaView(ctx: Ctx, from: ISODate, to: ISODate) {
  const uid = await currentUserId(ctx);
  const dated = await selectAll((a, b) => ctx.sb.from('agenda_tasks').select(COLS).eq('user_id', uid).gte('date', from).lte('date', to).order('position').range(a, b));
  const general = await selectAll((a, b) => ctx.sb.from('agenda_tasks').select(COLS).eq('user_id', uid).eq('kind', 'general').order('position').range(a, b));
  const notes = await q<any[]>(ctx.sb.from('agenda_notes').select('date, content').eq('user_id', uid).gte('date', from).lte('date', to));
  return {
    from, to,
    tasks: (dated as any[]).sort(byOrder).map(toTask),
    general: (general as any[]).map(toTask),
    notes: Object.fromEntries(notes.filter((n) => n.content).map((n) => [n.date, n.content])) as Record<ISODate, string>,
  };
}

/** O que a pessoa escolheu mostrar no planner, dia a dia (só leitura para o planner). */
export async function plannerTasks(ctx: Ctx, from: ISODate, to: ISODate) {
  const uid = await currentUserId(ctx);
  const rows = await selectAll((a, b) => ctx.sb.from('agenda_tasks').select(COLS).eq('user_id', uid).eq('show_in_planner', true)
    .gte('date', from).lte('date', to).order('position').range(a, b));
  return (rows as any[]).sort(byOrder).map(toTask);
}

export async function createTask(ctx: Ctx, body: unknown) {
  const uid = await currentUserId(ctx);
  const b = createSchema.parse(body);
  const kind = b.kind ?? 'day';
  if (kind !== 'general' && !b.date) throw badRequest('Escolha o dia.');
  const row = { ...toRow({ ...b, kind }), user_id: uid, position: Date.now() };
  const r = await q(ctx.sb.from('agenda_tasks').insert(row).select(COLS).single());
  return toTask(r);
}

export async function updateTask(ctx: Ctx, id: string, body: unknown) {
  const uid = await currentUserId(ctx);
  const b = updateSchema.parse(body);
  const cur: any = await q(ctx.sb.from('agenda_tasks').select('kind, date').eq('id', id).eq('user_id', uid).maybeSingle());
  if (!cur) throw notFound('Tarefa');
  const kind = b.kind ?? cur.kind;
  const date = b.date !== undefined ? b.date : cur.date;
  if (kind !== 'general' && !date) throw badRequest('Escolha o dia.');
  const r = await q(ctx.sb.from('agenda_tasks').update({ ...toRow(b), updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', uid).select(COLS).single());
  return toTask(r);
}

export async function deleteTask(ctx: Ctx, id: string) {
  const uid = await currentUserId(ctx);
  await q(ctx.sb.from('agenda_tasks').delete().eq('id', id).eq('user_id', uid));
  return { ok: true };
}

/** Anotação do dia; em branco apaga. */
export async function saveNote(ctx: Ctx, date: ISODate, content: string) {
  const uid = await currentUserId(ctx);
  if (!content.trim()) await q(ctx.sb.from('agenda_notes').delete().eq('user_id', uid).eq('date', date));
  else await q(ctx.sb.from('agenda_notes').upsert({ user_id: uid, date, content, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' }));
  return { ok: true };
}
