/** Peças da Agenda usadas na própria Agenda e no Planner (tarefas marcadas "Mostrar no Planner"). */
import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarCheck2, ListChecks, Plus, X } from 'lucide-react';
import { clsx } from 'clsx';
import { errorMessage } from '../lib/api';
import { shortDate, todayBR } from '../lib/format';
import { PRIORITY, splitTime, useTaskActions, type AgendaTask, type TaskKind, type TaskPatch } from '../lib/agenda';
import { Button, CheckSquare, Field, Note, Segmented, Sheet, SquareButton } from './ui';

/** Uma linha da agenda: quadradinho (tarefa) ou sininho (lembrete). */
export function AgendaRow({ task, onOpen, checklist, inPlanner, className }: {
  task: AgendaTask; onOpen: (t: AgendaTask) => void; checklist?: boolean; inPlanner?: boolean; className?: string;
}) {
  const { toggle, patch } = useTaskActions();
  const today = todayBR();
  const reminder = task.kind === 'reminder';
  const late = !task.done && task.kind === 'general' && !!task.date && task.date < today;
  const doneItems = task.checklist.filter((c) => c.done).length;
  const meta = [
    task.kind === 'general' && task.date && !inPlanner && <span key="d" className={late ? 'text-today' : undefined}>prazo {shortDate(task.date, false)}</span>,
    inPlanner && task.kind === 'general' && <span key="p">prazo</span>,
    task.priority && !task.done && <span key="pr" className={clsx('tint text-[10.5px]', PRIORITY[task.priority].tint)}>{PRIORITY[task.priority].label}</span>,
    task.checklist.length > 0 && !checklist && <span key="c" className="inline-flex items-center gap-1"><ListChecks className="h-3 w-3" strokeWidth={1.75} />{doneItems}/{task.checklist.length}</span>,
    task.showInPlanner && !inPlanner && task.date && <span key="pl" className="inline-flex items-center gap-1" title="Aparece no Planner"><CalendarCheck2 className="h-3 w-3" strokeWidth={1.75} />planner</span>,
  ].filter(Boolean);
  const setItem = (i: number, done: boolean) => patch.mutate({ id: task.id, patch: { checklist: task.checklist.map((c, j) => (j === i ? { ...c, done } : c)) } });

  return (
    <li className={clsx('border-b border-line/70 py-3 last:border-0', className)} data-testid="agenda-task">
      <div className="flex items-start gap-3.5">
        {reminder
          ? <span className="flex w-[19px] shrink-0 justify-center pt-[3px] text-ink-3"><Bell className="h-4 w-4" strokeWidth={1.5} /></span>
          : <span className="pt-[3px]"><SquareButton on={task.done} onChange={(v) => toggle(task, v)} label={`Concluir ${task.title}`} /></span>}
        <button onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70">
          <span className={clsx('block text-[16px] leading-snug', task.done && 'text-ink-3 line-through decoration-1')}>
            {reminder && task.time && <span className="tabular mr-2 text-ink-2">{task.time}</span>}
            <span data-testid="agenda-title">{task.title}</span>
          </span>
          {meta.length > 0 && <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-3">{meta}</span>}
          {task.note && !checklist && <span className="mt-0.5 block truncate text-[12px] text-ink-3">{task.note}</span>}
        </button>
      </div>
      {checklist && task.checklist.length > 0 && !task.done && (
        <ul className="mt-2 ml-[33px] space-y-1.5">
          {task.checklist.map((c, i) => (
            <li key={i} className="flex items-center gap-2.5 text-[14px]">
              <SquareButton size="sm" on={c.done} onChange={(v) => setItem(i, v)} label={`${c.text} - feito`} />
              <span className={clsx(c.done && 'text-ink-3 line-through decoration-1')}>{c.text}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** "+ Adicionar": vira um campo; Enter salva e já deixa pronto para a próxima. */
export function AddLine({ label, onAdd, testId, bell }: { label: string; onAdd: (text: string) => Promise<unknown>; testId?: string; bell?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  // Salva em segundo plano: dá para seguir escrevendo a próxima sem esperar
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    setError(null);
    onAdd(t).catch((e) => { setText((cur) => cur || t); setError(errorMessage(e)); });
  };
  if (!open) return (
    <button onClick={() => setOpen(true)} data-testid={testId} className="flex items-center gap-3.5 py-3 text-[14px] text-ink-3 transition hover:text-ink">
      <Plus className="h-[19px] w-[19px]" strokeWidth={1.25} />{label}
    </button>
  );
  return (
    <>
    <div className="flex items-center gap-3.5 py-2">
      {bell ? <Bell className="h-[19px] w-[19px] shrink-0 text-ink-3" strokeWidth={1.25} /> : <CheckSquare on={false} className="opacity-50" />}
      <input ref={input} value={text} aria-label={label} placeholder={label}
        className="min-w-0 flex-1 border-b border-line bg-transparent py-1 text-[16px] outline-none placeholder:text-ink-3 focus:border-ink"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setText(''); setOpen(false); } }}
        onBlur={() => { if (!text.trim()) setOpen(false); }} />
    </div>
    {error && <p role="alert" className="-mt-1 mb-2 ml-[33px] text-[12px] text-negative">Não foi possível salvar: {error}</p>}
    </>
  );
}

/** Cria uma tarefa a partir da linha rápida (lembretes aceitam "14h Dentista"). */
export function useQuickAdd() {
  const { create } = useTaskActions();
  return (kind: TaskKind, text: string, date: string | null) => {
    const { time, title } = kind === 'reminder' ? splitTime(text) : { time: null, title: text };
    return create.mutateAsync({ kind, title, date, time });
  };
}

const KIND_LABEL: Record<TaskKind, string> = { day: 'Tarefa do dia', reminder: 'Lembrete', general: 'Tarefa geral' };

/** Folha de edição: todos os detalhes opcionais ficam aqui, longe da lista. */
export function TaskEditor({ task, onClose }: { task: AgendaTask; onClose: () => void }) {
  const { patch, remove } = useTaskActions();
  const [d, setD] = useState<TaskPatch>({ kind: task.kind, title: task.title, date: task.date, time: task.time, priority: task.priority, note: task.note, checklist: task.checklist, showInPlanner: task.showInPlanner });
  const [item, setItem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const set = (p: TaskPatch) => setD({ ...d, ...p });
  const list = d.checklist ?? [];
  const general = d.kind === 'general';

  const setKind = (kind: TaskKind) => set({ kind, date: kind !== 'general' && !d.date ? task.date ?? todayBR() : d.date, time: kind === 'reminder' ? d.time : null });
  const addItem = () => { if (item.trim()) { set({ checklist: [...list, { text: item.trim(), done: false }] }); setItem(''); } };
  const save = async () => {
    setError(null);
    const body: TaskPatch = { ...d, title: d.title?.trim(), checklist: list.filter((c) => c.text.trim()) };
    if (!body.title) return setError('Escreva a tarefa.');
    if (!general && !body.date) return setError('Escolha o dia.');
    try { await patch.mutateAsync({ id: task.id, patch: body }); onClose(); } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <Sheet open onClose={onClose} title={KIND_LABEL[d.kind ?? 'day']} footer={<>
      <Button variant="destructive" size="sm" className="mr-auto" onClick={() => { remove.mutate(task.id); onClose(); }}>Excluir</Button>
      <Button variant="plain" onClick={onClose}>Cancelar</Button>
      <Button onClick={save} loading={patch.isPending}>Salvar</Button>
    </>}>
      <div className="space-y-7">
        <input className="w-full border-b border-line bg-transparent pb-2 font-display text-[26px] leading-tight outline-none focus:border-ink" aria-label="Tarefa"
          value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} />

        <Segmented value={d.kind ?? 'day'} onChange={setKind} options={(['day', 'reminder', 'general'] as TaskKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />

        <div className="grid grid-cols-2 gap-4">
          <Field label={general ? 'Prazo (opcional)' : 'Dia'}>
            <input type="date" className="field" aria-label={general ? 'Prazo' : 'Dia'} value={d.date ?? ''} onChange={(e) => set({ date: e.target.value || null })} />
          </Field>
          {d.kind === 'reminder' && (
            <Field label="Horário (opcional)">
              <input type="time" className="field" aria-label="Horário" value={d.time ?? ''} onChange={(e) => set({ time: e.target.value || null })} />
            </Field>
          )}
        </div>
        {general && <p className="-mt-4 text-[12px] text-ink-3">O prazo não agenda a tarefa: ela continua em Tarefas a fazer e aparece como lembrete no dia do prazo.</p>}

        <div>
          <p className="mb-2 text-[13px] text-ink-2">Prioridade</p>
          <Segmented value={String(d.priority ?? 0)} onChange={(v) => set({ priority: v === '0' ? null : (Number(v) as 1 | 2 | 3) })}
            options={[{ value: '0', label: 'Nenhuma' }, { value: '1', label: 'Baixa' }, { value: '2', label: 'Média' }, { value: '3', label: 'Alta' }]} />
        </div>

        <div>
          <p className="mb-1 text-[13px] text-ink-2">Checklist</p>
          <ul>
            {list.map((c, i) => (
              <li key={i} className="flex items-center gap-3 border-b border-line/70 py-2">
                <SquareButton size="sm" on={c.done} onChange={(v) => set({ checklist: list.map((x, j) => (j === i ? { ...x, done: v } : x)) })} label={`${c.text} - feito`} />
                <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" value={c.text} aria-label="Item da checklist"
                  onChange={(e) => set({ checklist: list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                <button onClick={() => set({ checklist: list.filter((_, j) => j !== i) })} aria-label={`Remover ${c.text}`} className="rounded-full p-1 text-ink-3 hover:text-ink"><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3 py-2">
            <CheckSquare size="sm" on={false} className="opacity-50" />
            <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3" placeholder="Adicionar item" aria-label="Adicionar item"
              value={item} onChange={(e) => setItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem()} onBlur={addItem} />
          </div>
        </div>

        <Field label="Observação">
          <textarea className="field min-h-[72px] resize-none" rows={2} value={d.note ?? ''} aria-label="Observação" onChange={(e) => set({ note: e.target.value })} />
        </Field>

        <label className="flex cursor-pointer items-start gap-3.5 border-t border-line pt-5">
          <input type="checkbox" className="sr-only" checked={!!d.showInPlanner} onChange={(e) => set({ showInPlanner: e.target.checked })} aria-label="Mostrar no Planner" />
          <CheckSquare on={!!d.showInPlanner} className="mt-0.5" />
          <span>
            <span className="block text-[15px]">Mostrar no Planner</span>
            <span className="block text-[12px] text-ink-3">
              {!d.date ? 'Escolha uma data para ela aparecer no Planner.' : `Aparece em ${shortDate(d.date, false)} no Planner, como tarefa da agenda (não vira assunto nem revisão).`}
            </span>
          </span>
        </label>
        {error && <Note tone="negative">{error}</Note>}
      </div>
    </Sheet>
  );
}
