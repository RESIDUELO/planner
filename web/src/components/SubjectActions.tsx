/**
 * Ações de um assunto no Planner, as mesmas vindas de qualquer lugar
 * (menu do toque longo/botão direito, deslizar, círculo de concluir):
 * concluir, mover para outro dia, foco, abrir e excluir. Cada ação responde
 * com um aviso pequeno e, quando dá, "Desfazer".
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { areaShort } from '../lib/areas';
import { shortDate } from '../lib/format';
import { usePomodoro } from '../lib/pomodoro';
import { toast } from '../lib/toast';
import { useCheck, useReviewDone, type DnD, type Drag } from '../pages/Planner';
import { ActionMenu, DayChoices, finePointer, type Anchor, type RowGestures } from './Gestures';
import { useInvalidateStudy } from './SubjectModal';

export interface Target {
  kind: 'task' | 'review' | 'library';
  subjectId: string;
  name: string;
  area?: string | null;
  /** Dia em que está (aula/revisão); na lista, a próxima data marcada. */
  from?: string | null;
  methodIds?: string[];
  done?: boolean;
}

interface Api {
  menu: (t: Target, anchor: Anchor) => void;
  complete: (t: Target, done: boolean) => void;
  remove: (t: Target) => void;
  gestures: (t: Target) => RowGestures;
}

const Ctx = createContext<Api | null>(null);
export const useSubjectActions = () => useContext(Ctx);

export function SubjectActionsProvider({ data, dnd, onOpen, children }: { data: any; dnd: DnD; onOpen: (id: string) => void; children: ReactNode }) {
  const check = useCheck();
  const reviewDone = useReviewDone();
  const invalidate = useInvalidateStudy();
  const pomodoro = usePomodoro();
  const [open, setOpen] = useState<{ t: Target; anchor: Anchor; mode: 'actions' | 'move' | 'confirm' } | null>(null);
  const own = (id: string) => !!data?.subjects?.find((s: any) => s.subjectId === id)?.own;

  const hide = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean; name: string }) => api.put(`/api/planner/subjects/${id}/hidden`, { hidden }),
    onSuccess: (_r, v) => {
      invalidate();
      if (v.hidden) toast(`${v.name} excluído do planner`, { action: { label: 'Desfazer', onClick: () => hide.mutate({ ...v, hidden: false }) } });
      else toast(`${v.name} de volta ao planner`);
    },
    onError: (e) => toast(errorMessage(e), { tone: 'negative' }),
  });
  const destroy = useMutation({
    mutationFn: (t: Target) => api.del(`/api/subjects/${t.subjectId}`),
    onSuccess: (_r, t) => { invalidate(); toast(`${t.name} excluído`); },
    onError: (e) => toast(errorMessage(e), { tone: 'negative' }),
  });

  const complete = (t: Target, done: boolean) => {
    if (t.kind === 'review') {
      if (!done) return;
      reviewDone.mutate(t.subjectId, { onError: (e) => toast(errorMessage(e), { tone: 'negative' }) });
      toast(`✓ Revisão feita: ${t.name}`);
      return;
    }
    const methodIds = t.kind === 'task' ? t.methodIds : undefined;
    check.mutate({ subjectId: t.subjectId, methodIds, done }, { onError: (e) => toast(errorMessage(e), { tone: 'negative' }) });
    if (done) toast(`✓ ${t.name} concluído`, { action: { label: 'Desfazer', onClick: () => check.mutate({ subjectId: t.subjectId, methodIds, done: false }) } });
  };
  const remove = (t: Target) => {
    // Assunto próprio: excluir apaga o histórico dele (definitivo, pede confirmação).
    // Assunto da prova: sai do planner e dá para desfazer.
    if (own(t.subjectId)) setOpen({ t, anchor: null, mode: 'confirm' });
    else hide.mutate({ id: t.subjectId, hidden: true, name: t.name });
  };
  const move = (t: Target, to: string) => {
    const d: Drag = t.kind === 'library'
      ? { type: 'library', subjectId: t.subjectId, from: '', name: t.name }
      : { type: t.kind, subjectId: t.subjectId, from: t.from ?? '', methodIds: t.methodIds, name: t.name };
    dnd.send(d, to);
  };
  const focus = (t: Target) => { pomodoro.start({ subject: { id: t.subjectId, name: t.name, area: t.area ?? undefined } }); pomodoro.setExpanded(true); };

  const api_: Api = {
    menu: (t, anchor) => setOpen({ t, anchor, mode: 'actions' }),
    complete,
    remove,
    gestures: (t) => ({
      onMenu: (anchor) => setOpen({ t, anchor, mode: 'actions' }),
      right: t.done ? undefined : { label: t.kind === 'review' ? 'Revisão feita' : 'Concluir', run: () => complete(t, true) },
      left: t.kind === 'review' ? undefined : { label: 'Excluir', run: () => remove(t) },
    }),
  };

  const t = open?.t;
  const isOwn = t ? own(t.subjectId) : false;
  const items = !t ? [] : t.kind === 'review' ? [
    { label: 'Revisão feita', onClick: () => complete(t, true), hidden: t.done },
    { label: 'Mover para outro dia', onClick: () => setOpen({ ...open!, mode: 'move' }), hidden: t.done },
    { label: 'Abrir assunto', onClick: () => onOpen(t.subjectId) },
  ] : [
    { label: t.done ? 'Desmarcar' : t.kind === 'library' ? 'Marcar assunto como concluído' : 'Concluir', onClick: () => complete(t, !t.done) },
    { label: t.kind === 'library' ? 'Colocar em um dia' : 'Mover para outro dia', onClick: () => setOpen({ ...open!, mode: 'move' }), hidden: t.done },
    { label: 'Iniciar foco', onClick: () => focus(t), hidden: t.done },
    { label: isOwn ? 'Abrir e editar' : 'Abrir assunto', onClick: () => onOpen(t.subjectId) },
    { label: isOwn ? 'Excluir assunto' : 'Excluir do planner', onClick: () => remove(t), destructive: true, hint: isOwn ? undefined : 'dá para desfazer' },
  ];
  const subtitle = t ? [areaShort(t.area ?? undefined), t.from ? shortDate(t.from, false) : null].filter(Boolean).join(' · ') : undefined;
  const close = () => setOpen(null);

  return (
    <Ctx.Provider value={api_}>
      {children}
      {open && t && (
        <ActionMenu title={open.mode === 'move' ? `Mover ${t.name}` : open.mode === 'confirm' ? `Excluir ${t.name}?` : t.name}
          subtitle={subtitle} items={items} anchor={open.anchor} onClose={close}>
          {open.mode === 'move' ? <DayChoices current={t.kind === 'library' ? null : t.from} sheet={!finePointer() || !open.anchor} onPick={(d) => { close(); move(t, d); }} />
            : open.mode === 'confirm' ? (
              <div className="px-6 py-4">
                <p className="text-[15px] text-ink-2">O assunto e todo o histórico dele (atividades, revisões e questões) são apagados. Não dá para desfazer.</p>
                <div className="mt-5 flex items-center gap-3">
                  <button role="menuitem" onClick={() => { close(); destroy.mutate(t); }} className="rounded-full bg-negative px-4 py-2 text-[14px] text-white transition hover:opacity-90 active:opacity-80">Excluir de vez</button>
                  <button role="menuitem" onClick={close} className="rounded-full px-3 py-2 text-[14px] text-ink-2 transition hover:text-ink">Cancelar</button>
                </div>
              </div>
            ) : undefined}
        </ActionMenu>
      )}
    </Ctx.Provider>
  );
}
