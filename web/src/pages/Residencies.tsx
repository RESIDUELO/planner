/**
 * Residências: as residências em que a pessoa vai se inscrever, cada uma com
 * a linha do tempo (edital, inscrição, prova, resultado...), vagas e nota de
 * corte, taxa e a situação dela. Escolhidas do catálogo (as datas já vêm e
 * se atualizam sozinhas) ou cadastradas à mão.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ListChecks, Plus, Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { api, ApiError, errorMessage } from '../lib/api';
import { shortDate, todayBR } from '../lib/format';
import { useWide } from '../lib/zoom';
import { useAuth } from '../lib/auth';
import { IS_LOCAL } from '../lib/platform';
import { toast } from '../lib/toast';
import {
  TONE_TINT, upcoming, useCatalog, useCatalogActions, useResidencies, useResidencyActions, type ResidencyPatch, type ResidencyView,
} from '../lib/residency';
import { TypeDot, UpcomingList } from '../components/Residencies';
import { Button, CheckSquare, Eyebrow, Field, Note, Segmented, Sheet, Spinner, SquareButton } from '../components/ui';
import {
  DEFAULT_STEPS, defaultSteps, nextEvent, RANGE_KEYS, residencyStatus, sortResidencies, stepOf, STEP_TYPES,
  type CatalogEntry, type Institution, type Specialty, type Step, type StepType,
} from '../../../shared/residency';

export function ResidenciesPage() {
  const today = todayBR();
  const q = useResidencies();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const desktop = useWide();
  const picking = params.has('escolher');
  const pick = () => setParams({ escolher: '1' }, { replace: true });
  useEffect(() => {
    document.documentElement.classList.add('rp-fit');
    return () => document.documentElement.classList.remove('rp-fit');
  }, []);

  const list = useMemo(() => sortResidencies(q.data ?? [], today), [q.data, today]);
  const events = useMemo(() => upcoming(q.data, today), [q.data, today]);
  const openId = params.get('r');
  const open = openId ? list.find((r) => r.id === openId) : undefined;
  const close = () => setParams({}, { replace: true });

  if (q.isLoading) return <Spinner />;
  if (q.error && !q.data) return <ResidenciesError error={q.error} />;
  const active = list.filter((r) => r.decision !== 'no').length;
  return (
    <div className="grid gap-14 fit:h-[calc(var(--app-h,100dvh)-var(--chrome-h))] fit:grid-cols-[minmax(0,1fr)_320px] fit:grid-rows-[minmax(0,1fr)] fit:gap-10">
      <section aria-label="Residências" className="min-w-0 fit:flex fit:min-h-0 fit:flex-col">
        <div className="fit:shrink-0">
          <Eyebrow>Residências{list.length > 0 && ` · ${active} ${active === 1 ? 'acompanhada' : 'acompanhadas'}`}</Eyebrow>
          <div className="mt-3 mb-6 flex items-end justify-between gap-4">
            <h1 className="font-display text-[40px] leading-none sm:text-[52px]">Minhas residências</h1>
            <div className="flex shrink-0 items-center gap-5 pb-1">
              <button onClick={pick} data-testid="pick-residencies"
                className="flex items-center gap-2 text-[14px] text-ink transition hover:opacity-70">
                <ListChecks className="h-[18px] w-[18px]" strokeWidth={1.25} /><span>Escolher<span className="hidden sm:inline"> residências</span></span>
              </button>
              <button onClick={() => setCreating(true)} data-testid="new-residency" aria-label="Nova residência"
                className="flex items-center gap-2 text-[14px] text-ink-2 transition hover:text-ink">
                <Plus className="h-[18px] w-[18px]" strokeWidth={1.25} /><span className="hidden sm:inline">Nova residência</span>
              </button>
            </div>
          </div>
        </div>
        <div className={clsx('border-t border-line', desktop && 'no-scrollbar fade-scroll -mx-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-10')}>
          {list.length === 0 ? (
            <div className="py-10">
              <p className="font-display text-[26px] italic">Nenhuma residência ainda.</p>
              <p className="mt-2 max-w-md text-[15px] text-ink-2">
                Escolha as residências em que você vai se inscrever: as datas de cada etapa já vêm preenchidas, vão para a Agenda, e o prazo mais próximo aparece no Planner.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Button onClick={pick}>Escolher residências</Button>
                <button onClick={() => setCreating(true)} className="flex items-center gap-2 text-[14px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink">
                  Cadastrar à mão
                </button>
              </div>
            </div>
          ) : (
            list.map((r) => <ResidencyCard key={r.id} r={r} today={today} onOpen={() => setParams({ r: r.id }, { replace: true })} />)
          )}
        </div>
      </section>

      <aside aria-label="Próximos prazos" className="min-w-0 fit:flex fit:min-h-0 fit:flex-col">
        <div className="flex items-baseline gap-3 fit:shrink-0">
          <span className="font-display text-[26px] italic">Próximos prazos</span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="no-scrollbar mt-2 fit:min-h-0 fit:flex-1 fit:overflow-y-auto fit:overscroll-contain fit:fade-scroll fit:pb-6">
          <UpcomingList events={events} today={today} empty="As datas que você marcar nas residências aparecem aqui." />
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-3">
            {(Object.keys(STEP_TYPES) as StepType[]).map((t) => <span key={t} className="inline-flex items-center gap-1.5"><TypeDot type={t} />{STEP_TYPES[t].toLowerCase()}</span>)}
          </div>
        </div>
      </aside>

      {picking && <CatalogPicker mine={q.data ?? []} today={today} onClose={close} onManual={() => { close(); setCreating(true); }} />}
      {creating && <ResidencyEditor onClose={() => setCreating(false)} />}
      {open && <ResidencyEditor key={open.id} residency={open} onClose={close} />}
    </div>
  );
}

function ResidenciesError({ error }: { error: unknown }) {
  const missing = error instanceof ApiError && error.status === 503;
  return (
    <div className="mx-auto max-w-xl py-10">
      <Note tone="negative">
        {missing
          ? <>As Residências ainda não foram ativadas no banco do site. No Supabase, abra <b>SQL Editor → New query</b>, cole o arquivo <b>supabase/parts/15_residencies.sql</b> e clique em <b>Run</b>. Depois recarregue esta página.</>
          : <>Não foi possível abrir as Residências: {errorMessage(error)}</>}
      </Note>
    </div>
  );
}

const specText = (s: Specialty) => `${s.name}${s.vacancies != null ? ` ${s.vacancies} ${s.vacancies === 1 ? 'vaga' : 'vagas'}` : ''}${s.cutoff ? `, corte ${s.cutoff}` : ''}`;

function StatusBadge({ r, today }: { r: ResidencyView; today: string }) {
  const st = residencyStatus(r, today);
  const tint = TONE_TINT[st.tone];
  return <span data-testid="status" className={clsx('text-[12.5px]', tint ? `tint ${tint}` : 'text-ink-3')}>{st.label}</span>;
}

function ResidencyCard({ r, today, onOpen }: { r: ResidencyView; today: string; onOpen: () => void }) {
  const next = nextEvent(r, today);
  const specs = r.institutions.length
    ? `${r.institutions.length} ${r.institutions.length === 1 ? 'instituição' : 'instituições'}`
    : r.specialties.map(specText).join(' · ');
  return (
    <article data-testid={`residency-${r.name}`} className={clsx('border-b border-line transition-opacity', r.decision === 'no' && 'opacity-45')}>
      <button onClick={onOpen} className="flex w-full items-start gap-5 py-5 text-left transition-opacity hover:opacity-70">
        <div className="min-w-0 flex-1">
          <div className="font-display text-[28px] leading-tight">{r.name}</div>
          {(r.city || specs) && <div className="mt-0.5 truncate text-[13px] text-ink-2">{[r.city, specs].filter(Boolean).join(' · ')}</div>}
          <div className="mt-2.5 hidden sm:block"><StatusBadge r={r} today={today} /></div>
        </div>
        <div className="max-w-[45%] shrink-0 pt-1 text-right" data-testid="next-deadline">
          {next ? (
            <>
              <div className="text-[10.5px] font-medium tracking-[0.16em] text-ink-3 uppercase">próximo prazo</div>
              <div className="tabular mt-1 font-display text-[22px] leading-tight">{shortDate(next.date, false)}</div>
              <div className="text-[12px] leading-snug text-ink-2"><TypeDot type={next.type} className="mr-1.5 align-middle" />{next.label}</div>
            </>
          ) : <div className="text-[13px] text-ink-3">{r.decision === 'no' ? '' : 'datas a divulgar'}</div>}
        </div>
      </button>
      <div className="-mt-3 pb-4 sm:hidden"><StatusBadge r={r} today={today} /></div>
      {(r.exam || r.editalUrl) && (
        <div className="-mt-2 flex flex-wrap gap-x-4 pb-4 text-[12px] text-ink-3">
          {r.editalUrl && <a href={r.editalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:text-ink hover:underline">edital<ExternalLink className="h-3 w-3" strokeWidth={1.5} /></a>}
          {r.exam && <>
            <Link to="/planner" className="underline-offset-4 hover:text-ink hover:underline">ver no planner</Link>
            <Link to="/provas" className="underline-offset-4 hover:text-ink hover:underline">ver em Provas</Link>
          </>}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- Catálogo

const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Escolher residências do catálogo: marcar e adicionar; as datas já vêm prontas. */
function CatalogPicker({ mine, today, onClose, onManual }: { mine: ResidencyView[]; today: string; onClose: () => void; onManual: () => void }) {
  const { user } = useAuth();
  const admin = user?.role === 'admin' && !IS_LOCAL;
  const cat = useCatalog();
  const { add } = useCatalogActions();
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [term, setTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CatalogEntry | 'new' | null>(null);
  const have = new Set(mine.map((r) => r.catalogId).filter(Boolean));
  const all = cat.data?.entries ?? [];
  const shown = term.trim() ? all.filter((e) => norm(`${e.name} ${e.city} ${e.institutions.map((i) => i.name).join(' ')}`).includes(norm(term.trim()))) : all;
  const toggle = (id: string) => setSel((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const confirm = async () => {
    setError(null);
    try {
      const r = await add.mutateAsync([...sel]);
      toast(r.added === 1 ? '1 residência adicionada, com as datas' : `${r.added} residências adicionadas, com as datas`);
      onClose();
    } catch (e) { setError(errorMessage(e)); }
  };

  if (editing) return <ResidencyEditor entry={editing === 'new' ? undefined : editing} catalogMode onClose={() => setEditing(null)} />;
  return (
    <Sheet open wide onClose={onClose} title="Escolher residências" footer={<>
      {admin && cat.data?.ready && <Button variant="plain" size="sm" className="mr-auto" onClick={() => setEditing('new')} data-testid="catalog-new">Cadastrar no catálogo</Button>}
      <Button variant="plain" onClick={onClose}>Cancelar</Button>
      <Button onClick={confirm} disabled={!sel.size} loading={add.isPending} data-testid="catalog-add">
        {sel.size ? `Adicionar ${sel.size}` : 'Adicionar'}
      </Button>
    </>}>
      <p className="-mt-3 mb-6 text-[15px] text-ink-2">
        Marque as residências em que você vai se inscrever. As datas de cada etapa já vêm preenchidas e se atualizam sozinhas quando saírem as novas.
      </p>
      {cat.isLoading ? <Spinner /> : cat.error ? <Note tone="negative">{errorMessage(cat.error)}</Note> : !cat.data?.ready ? (
        <Note>
          {admin
            ? <>O catálogo ainda não foi ativado no banco do site. No Supabase, abra <b>SQL Editor → New query</b>, cole o arquivo <b>supabase/parts/17_residency_catalog.sql</b> e clique em <b>Run</b>.</>
            : 'O catálogo de residências ainda não está disponível.'}
        </Note>
      ) : all.length === 0 ? (
        <div className="border-t border-line py-6">
          <p className="font-display text-[22px] italic">Nenhuma residência no catálogo ainda.</p>
          {admin
            ? <button onClick={() => setEditing('new')} className="mt-3 text-[15px] text-ink underline decoration-line underline-offset-4 hover:decoration-ink">Cadastrar a primeira</button>
            : <button onClick={onManual} className="mt-3 text-[15px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">Enquanto isso, cadastrar à mão</button>}
        </div>
      ) : (
        <>
          {all.length > 6 && (
            <label className="mb-4 flex items-center gap-2 border-b border-line pb-2 focus-within:border-ink">
              <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} />
              <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3" placeholder="Buscar por nome ou cidade"
                aria-label="Buscar residência" value={term} onChange={(e) => setTerm(e.target.value)} />
            </label>
          )}
          <ul className="divide-y divide-line border-y border-line" data-testid="catalog-list">
            {shown.map((e) => {
              const inList = have.has(e.id);
              const on = inList || sel.has(e.id);
              const prova = stepOf(e, 'prova')?.date;
              const next = nextEvent({ id: e.id, name: e.name, steps: e.steps }, today);
              return (
                <li key={e.id} data-testid={`catalog-${e.name}`} className={clsx('flex items-center gap-4 py-3.5', !e.published && 'opacity-60')}>
                  <label className={clsx('flex min-w-0 flex-1 items-center gap-4', inList ? 'cursor-default' : 'cursor-pointer')}>
                    <input type="checkbox" className="sr-only" checked={on} disabled={inList} onChange={() => toggle(e.id)} aria-label={e.name} />
                    <CheckSquare on={on} className={clsx(inList && 'opacity-40')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-[22px] leading-tight">{e.name}</span>
                      <span className="block truncate text-[13px] text-ink-2">
                        {[e.city, e.institutions.length ? `${e.institutions.length} instituições` : null, inList ? 'já está na sua lista' : !e.published ? 'rascunho, só você vê' : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {prova ? <><span className="block text-[10.5px] font-medium tracking-[0.16em] text-ink-3 uppercase">prova</span><span className="tabular block text-[15px]">{shortDate(prova, false)}</span></>
                        : <span className="block text-[13px] text-ink-3">{next ? `${next.label} ${shortDate(next.date, false)}` : 'datas a divulgar'}</span>}
                    </span>
                  </label>
                  {admin && <button onClick={() => setEditing(e)} className="shrink-0 text-[13px] text-ink-3 underline-offset-4 hover:text-ink hover:underline">Editar</button>}
                </li>
              );
            })}
            {shown.length === 0 && <li className="py-4 text-[15px] text-ink-3">Nada encontrado.</li>}
          </ul>
          <button onClick={onManual} className="mt-5 text-[13px] text-ink-3 underline-offset-4 hover:text-ink hover:underline">Não achou? Cadastrar à mão</button>
        </>
      )}
      {error && <Note tone="negative" className="mt-4">{error}</Note>}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Edição

type Draft = Omit<ResidencyPatch, 'steps' | 'specialties' | 'institutions'> & { steps: Step[]; specialties: Specialty[]; institutions: Institution[]; multi: boolean };

const blank = (): Draft => ({
  name: '', city: '', editalUrl: '', specialties: [], institutions: [], fee: null, reductionRequested: false, reductionGranted: null,
  paid: false, decision: 'yes', enrolled: false, notes: '', steps: defaultSteps(), examEditionId: null, multi: false,
});

const uid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function Head({ children }: { children: ReactNode }) {
  return <div className="mb-3 border-b border-ink/70 pb-1.5 text-[10.5px] font-medium tracking-[0.18em] text-ink-2 uppercase">{children}</div>;
}

function Check({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="relative flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <CheckSquare on={on} size="sm" className="mt-[3px]" />
      <span><span className="block text-[15px]">{label}</span>{hint && <span className="block text-[12px] text-ink-3">{hint}</span>}</span>
    </label>
  );
}

/** Data em texto ("12 out 2026" ou "a divulgar"); tocar abre o calendário do aparelho. */
function DateInput({ value, onChange, label, disabled }: { value: string | null; onChange: (v: string | null) => void; label: string; disabled?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={clsx('relative inline-flex min-w-[84px] justify-end border-b border-dotted', disabled ? 'border-transparent' : 'border-ink-3/60')}>
        <span className={clsx('tabular text-[14px]', value ? 'text-ink' : 'text-ink-3')}>{value ? shortDate(value) : 'a divulgar'}</span>
        {!disabled && (
          <input type="date" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}
            onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* sem suporte */ } }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        )}
      </span>
      {value && !disabled
        ? <button type="button" onClick={() => onChange(null)} aria-label={`Limpar ${label}`} className="rounded-full p-0.5 text-ink-3 hover:text-ink"><X className="h-3 w-3" /></button>
        : <span className="w-4" />}
    </span>
  );
}

function SpecialtyList({ list, onChange, owner, readOnly }: { list: Specialty[]; onChange: (l: Specialty[]) => void; owner?: string; readOnly?: boolean }) {
  if (readOnly) {
    return list.length
      ? <ul className="divide-y divide-line/70 border-y border-line/70">{list.map((s, i) => <li key={i} className="py-1.5 text-[15px]">{specText(s)}</li>)}</ul>
      : <p className="text-[13px] text-ink-3">A divulgar.</p>;
  }
  const set = (i: number, p: Partial<Specialty>) => onChange(list.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const tag = owner ? ` - ${owner}` : '';
  return (
    <div>
      {list.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_64px_84px_20px] gap-x-3 pb-1 text-[11px] text-ink-3">
          <span>Especialidade</span><span>Vagas</span><span>Nota de corte</span><span />
        </div>
      )}
      {list.map((s, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_64px_84px_20px] items-center gap-x-3 border-b border-line/70 py-1.5" data-testid="specialty">
          <input className="min-w-0 bg-transparent text-[15px] outline-none" value={s.name} placeholder="Radiologia" aria-label={`Especialidade${tag}`}
            onChange={(e) => set(i, { name: e.target.value })} />
          <input className="tabular min-w-0 bg-transparent text-[15px] outline-none" inputMode="numeric" value={s.vacancies ?? ''} placeholder="-" aria-label={`Vagas${tag}`}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); set(i, { vacancies: v ? Number(v) : null }); }} />
          <input className="tabular min-w-0 bg-transparent text-[15px] outline-none" value={s.cutoff} placeholder="66/100" aria-label={`Nota de corte${tag}`}
            onChange={(e) => set(i, { cutoff: e.target.value })} />
          <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`Remover ${s.name || 'especialidade'}`} className="text-ink-3 hover:text-ink"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...list, { name: '', vacancies: null, cutoff: '' }])}
        className="mt-1 flex items-center gap-2 py-2 text-[13px] text-ink-3 transition hover:text-ink">
        <Plus className="h-4 w-4" strokeWidth={1.25} />Adicionar especialidade
      </button>
    </div>
  );
}

/**
 * Editor de uma residência da pessoa ou, com `catalogMode`, de uma residência
 * do catálogo (administração). Na da pessoa que veio do catálogo, nome,
 * edital, vagas, taxa e as datas cadastradas lá ficam fixos.
 */
function ResidencyEditor({ residency, entry, catalogMode, onClose }: { residency?: ResidencyView; entry?: CatalogEntry; catalogMode?: boolean; onClose: () => void }) {
  const mineActions = useResidencyActions();
  const catalogActions = useCatalogActions();
  const { create, patch, remove } = catalogMode ? catalogActions : mineActions;
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api.get<any[]>('/api/exams') });
  const [d, setD] = useState<Draft>(() => residency
    ? { ...residency, multi: residency.institutions.length > 0 }
    : entry ? { ...blank(), ...entry, multi: entry.institutions.length > 0 }
    : blank());
  const [published, setPublished] = useState(entry?.published ?? true);
  const current = catalogMode ? entry : residency;
  // Da pessoa, vindo do catálogo: o que está lá não se muda aqui
  const fixed = !catalogMode && !!residency?.catalog;
  const fixedSteps = new Set(residency?.catalog?.dated ?? []);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [newStep, setNewStep] = useState<{ label: string; type: StepType }>({ label: '', type: 'inscricao' });
  const set = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));
  const setStep = (id: string, p: Partial<Step>) => setD((cur) => ({ ...cur, steps: cur.steps.map((s) => (s.id === id ? { ...s, ...p } : s)) }));
  const reducao = d.steps.find((s) => s.key === 'reducao');
  const linked = (exams.data ?? []).find((e) => e.edition_id === d.examEditionId);
  const officialDate = linked?.date_official ? linked.exam_date : residency?.exam?.official && residency.examEditionId === d.examEditionId ? residency.steps.find((s) => s.key === 'prova')?.date : null;
  const removed = DEFAULT_STEPS.filter((x) => !d.steps.some((s) => s.key === x.key));

  const link = (id: string | null) => {
    const e = (exams.data ?? []).find((x) => x.edition_id === id);
    setD((cur) => ({ ...cur, examEditionId: id, steps: e?.exam_date ? cur.steps.map((s) => (s.key === 'prova' ? { ...s, date: e.exam_date } : s)) : cur.steps }));
  };
  // Etapa padrão de volta, no lugar dela; etapa nova, no fim das do mesmo tipo
  const restore = (key: Step['key']) => setD((cur) => {
    const def = DEFAULT_STEPS.find((x) => x.key === key)!;
    const order = (k: Step['key']) => DEFAULT_STEPS.findIndex((x) => x.key === k);
    const at = cur.steps.findIndex((s) => s.key !== 'custom' && order(s.key) > order(key));
    const steps = [...cur.steps];
    steps.splice(at < 0 ? steps.length : at, 0, { ...def, id: key, date: null, end: null, done: false });
    return { ...cur, steps };
  });
  const addStep = () => {
    const label = newStep.label.trim();
    if (!label) return;
    setD((cur) => {
      const lastOfType = cur.steps.map((s) => s.type).lastIndexOf(newStep.type);
      const steps = [...cur.steps];
      steps.splice(lastOfType < 0 ? steps.length : lastOfType + 1, 0, { id: uid(), key: 'custom', label, type: newStep.type, date: null, end: null, done: false });
      return { ...cur, steps };
    });
    setNewStep({ ...newStep, label: '' });
  };

  const save = async () => {
    setError(null);
    const name = (d.name ?? '').trim();
    if (!name) return setError('Escreva o nome da residência.');
    const clean = (l: Specialty[]) => l.filter((s) => s.name.trim()).map((s) => ({ ...s, name: s.name.trim(), cutoff: s.cutoff.trim() }));
    const { multi, ...rest } = d;
    const body: ResidencyPatch & { name: string } = {
      ...rest, name, city: (d.city ?? '').trim(), editalUrl: (d.editalUrl ?? '').trim(),
      specialties: clean(d.specialties),
      institutions: multi ? d.institutions.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), city: i.city.trim(), specialties: clean(i.specialties) })) : [],
      steps: d.steps.map((s) => ({ ...s, label: s.label.trim() || 'Etapa' })),
      reductionGranted: d.reductionRequested ? d.reductionGranted ?? null : null,
    };
    delete (body as any).id; delete (body as any).createdAt; delete (body as any).exam; delete (body as any).catalog; delete (body as any).catalogId;
    let send: any = body;
    if (catalogMode) {
      // No catálogo só vai o que é de edital (nada de situação, pagamento ou "feito")
      const { name: n, city, editalUrl, specialties, institutions, fee, steps, examEditionId, notes } = body;
      send = { name: n, city, editalUrl, specialties, institutions, fee, steps: steps?.map((x) => ({ ...x, done: false })), examEditionId, notes, published };
    }
    try {
      if (current) await patch.mutateAsync({ id: current.id, patch: send });
      else await create.mutateAsync(send);
      if (catalogMode) toast(current ? `${name} atualizada no catálogo` : `${name} cadastrada no catálogo`);
      onClose();
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <Sheet open wide onClose={onClose} footer={<>
      {current && (confirmDel
        ? <Button variant="destructive" size="sm" className="mr-auto" onClick={() => { remove.mutate(current.id); onClose(); }}>Confirmar exclusão</Button>
        : <Button variant="plain" size="sm" className="mr-auto text-negative" onClick={() => setConfirmDel(true)}>Excluir</Button>)}
      <Button variant="plain" onClick={onClose}>Cancelar</Button>
      <Button onClick={save} loading={create.isPending || patch.isPending}>Salvar</Button>
    </>}>
      <div className="space-y-10">
        <div className="space-y-4 pr-8">
          {catalogMode && <Eyebrow>{entry ? 'Catálogo · editar' : 'Catálogo · nova residência'}</Eyebrow>}
          <input className="w-full border-b border-line bg-transparent pb-2 font-display text-[32px] leading-tight outline-none placeholder:text-ink-3 focus:border-ink read-only:border-transparent"
            aria-label="Nome da residência" placeholder={current ? 'Nome' : 'Nova residência'} autoFocus={!current} readOnly={fixed}
            value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          {fixed && <p className="text-[12px] text-ink-3" data-testid="from-catalog">Do catálogo: nome, edital, vagas, taxa e as datas já divulgadas vêm prontos e se atualizam sozinhos. O resto é seu.</p>}
          <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
            <Field label="Cidade"><input className="field" value={d.city ?? ''} readOnly={fixed} onChange={(e) => set({ city: e.target.value })} /></Field>
            <Field label="Link do edital">
              <div className="flex items-center gap-2">
                <input className="field" type="url" inputMode="url" placeholder="https://" value={d.editalUrl ?? ''} readOnly={fixed} onChange={(e) => set({ editalUrl: e.target.value })} />
                {d.editalUrl && <a href={d.editalUrl} target="_blank" rel="noreferrer" aria-label="Abrir edital" className="shrink-0 rounded-full p-2 text-ink-2 hover:bg-fill hover:text-ink"><ExternalLink className="h-4 w-4" strokeWidth={1.5} /></a>}
              </div>
            </Field>
          </div>
        </div>

        {!catalogMode && <section>
          <Head>Minha situação</Head>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <Segmented value={d.decision ?? 'yes'} onChange={(v) => set({ decision: v })}
              options={[{ value: 'yes', label: 'Vou fazer' }, { value: 'maybe', label: 'Talvez' }, { value: 'no', label: 'Não vou' }]} />
            <Check on={!!d.enrolled} onChange={(v) => set({ enrolled: v })} label="Inscrito" />
          </div>
        </section>}

        <section>
          <Head>Vagas e nota de corte do ano anterior</Head>
          {!fixed && <div className="mb-4"><Check on={d.multi} label="Prova com várias instituições" hint="Ex.: ENARE. Um cartão só, com as instituições dentro."
            onChange={(v) => set({ multi: v, institutions: v && !d.institutions.length ? [{ name: '', city: '', specialties: [] }] : d.institutions })} /></div>}
          {fixed ? (
            d.institutions.length ? (
              <div className="space-y-5">
                {d.institutions.map((inst, i) => (
                  <div key={i} className="border-l border-line pl-4" data-testid="institution">
                    <div className="text-[17px]">{inst.name}{inst.city && <span className="text-[13px] text-ink-3"> · {inst.city}</span>}</div>
                    <div className="mt-1"><SpecialtyList readOnly list={inst.specialties} onChange={() => {}} /></div>
                  </div>
                ))}
              </div>
            ) : <SpecialtyList readOnly list={d.specialties} onChange={() => {}} />
          ) : d.multi ? (
            <div className="space-y-6">
              {d.institutions.map((inst, i) => {
                const setInst = (p: Partial<Institution>) => set({ institutions: d.institutions.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <div key={i} className="border-l border-line pl-4" data-testid="institution">
                    <div className="flex items-center gap-3">
                      <input className="min-w-0 flex-1 border-b border-line bg-transparent py-1 text-[17px] outline-none placeholder:text-ink-3 focus:border-ink" placeholder="Instituição"
                        aria-label="Instituição" value={inst.name} onChange={(e) => setInst({ name: e.target.value })} />
                      <input className="w-36 border-b border-line bg-transparent py-1 text-[14px] outline-none placeholder:text-ink-3 focus:border-ink" placeholder="Cidade"
                        aria-label={`Cidade - ${inst.name || 'instituição'}`} value={inst.city} onChange={(e) => setInst({ city: e.target.value })} />
                      <button type="button" onClick={() => set({ institutions: d.institutions.filter((_, j) => j !== i) })} aria-label={`Remover ${inst.name || 'instituição'}`} className="text-ink-3 hover:text-ink"><X className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="mt-2"><SpecialtyList list={inst.specialties} owner={inst.name || undefined} onChange={(l) => setInst({ specialties: l })} /></div>
                  </div>
                );
              })}
              <button type="button" onClick={() => set({ institutions: [...d.institutions, { name: '', city: '', specialties: [] }] })}
                className="flex items-center gap-2 text-[13px] text-ink-3 transition hover:text-ink">
                <Plus className="h-4 w-4" strokeWidth={1.25} />Adicionar instituição
              </button>
            </div>
          ) : <SpecialtyList list={d.specialties} onChange={(l) => set({ specialties: l })} />}
        </section>

        <section>
          <Head>Taxa de inscrição</Head>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <Field label="Valor (R$)">
              <input className="field" type="number" min={0} step="0.01" placeholder="0,00" value={d.fee ?? ''} readOnly={fixed}
                onChange={(e) => set({ fee: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            {reducao && (
              <div>
                <span className="mb-1.5 block text-[13px] text-ink-2">Período para pedir redução ou isenção</span>
                <div className="flex min-h-[42px] flex-wrap items-center gap-2 text-[13px] text-ink-3">
                  <DateInput label="Redução - início" value={reducao.date} onChange={(v) => setStep(reducao.id, { date: v })} disabled={fixedSteps.has(reducao.id)} />a
                  <DateInput label="Redução - fim" value={reducao.end} onChange={(v) => setStep(reducao.id, { end: v })} disabled={fixedSteps.has(reducao.id)} />
                </div>
              </div>
            )}
          </div>
          {!catalogMode && <div className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-3">
            <Check on={!!d.reductionRequested} onChange={(v) => set({ reductionRequested: v })} label="Pedi redução" />
            {d.reductionRequested && (
              <Segmented value={d.reductionGranted == null ? 'wait' : d.reductionGranted ? 'yes' : 'no'}
                onChange={(v) => set({ reductionGranted: v === 'wait' ? null : v === 'yes' })}
                className="[&>button]:py-0 [&>button]:text-[14px]"
                options={[{ value: 'wait', label: 'Aguardando' }, { value: 'yes', label: 'Aceita' }, { value: 'no', label: 'Negada' }]} />
            )}
            <Check on={!!d.paid} onChange={(v) => set({ paid: v })} label="Paguei" />
          </div>}
        </section>

        <section>
          <Head>Linha do tempo</Head>
          <ol>
            {d.steps.map((s) => {
              const range = RANGE_KEYS.includes(s.key);
              const locked = (s.key === 'prova' && !!officialDate) || fixedSteps.has(s.id);
              const fromCatalog = fixed && (fixedSteps.has(s.id) || s.key !== 'custom');
              return (
                <li key={s.id} data-testid="step" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/70 py-2">
                  {!catalogMode && <SquareButton size="sm" on={s.done} onChange={(v) => setStep(s.id, { done: v })} label={`${s.label} - feito`} />}
                  <TypeDot type={s.type} />
                  {s.key === 'custom' && !fromCatalog
                    ? <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" value={s.label} aria-label="Nome da etapa" onChange={(e) => setStep(s.id, { label: e.target.value })} />
                    : <span className={clsx('min-w-0 flex-1 text-[15px]', s.done && 'text-ink-3 line-through decoration-1')}>{s.label}</span>}
                  <span className="ml-auto flex items-center gap-1.5 text-[13px] text-ink-3">
                    {range ? (
                      <>
                        <DateInput label={`${s.label} - início`} value={s.date} onChange={(v) => setStep(s.id, { date: v })} disabled={locked} />a
                        <DateInput label={`${s.label} - fim`} value={s.end} onChange={(v) => setStep(s.id, { end: v })} disabled={locked} />
                      </>
                    ) : (
                      <DateInput label={`${s.label} - dia`} value={locked ? officialDate! : s.date} onChange={(v) => setStep(s.id, { date: v })} disabled={locked} />
                    )}
                    {fromCatalog ? <span className="w-[22px]" /> : (
                      <button type="button" onClick={() => set({ steps: d.steps.filter((x) => x.id !== s.id) })} aria-label={`Remover etapa ${s.label}`}
                        className="rounded-full p-1 text-ink-3 hover:text-ink"><X className="h-3.5 w-3.5" /></button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
            <Plus className="h-4 w-4 text-ink-3" strokeWidth={1.25} />
            <input className="min-w-0 flex-1 border-b border-line bg-transparent py-1 text-[15px] outline-none placeholder:text-ink-3 focus:border-ink" placeholder="Nova etapa"
              aria-label="Nova etapa" value={newStep.label} onChange={(e) => setNewStep({ ...newStep, label: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addStep()} />
            <Segmented value={newStep.type} onChange={(t) => setNewStep({ ...newStep, type: t })} className="gap-3 [&>button]:py-0 [&>button]:text-[13px]"
              options={(Object.keys(STEP_TYPES) as StepType[]).map((t) => ({ value: t, label: STEP_TYPES[t] }))} />
            <button type="button" onClick={addStep} className="text-[13px] text-ink underline decoration-line underline-offset-4 hover:decoration-ink">Adicionar</button>
          </div>
          {removed.length > 0 && !fixed && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
              <span>Etapas removidas:</span>
              {removed.map((x) => <button key={x.key} type="button" onClick={() => restore(x.key)} className="underline-offset-4 hover:text-ink hover:underline">+ {x.label}</button>)}
            </div>
          )}
        </section>

        <section>
          <Head>Ligação com Provas</Head>
          <select className="field" aria-label="Prova em Provas" value={d.examEditionId ?? ''} onChange={(e) => link(e.target.value || null)} disabled={fixed && !!d.examEditionId}>
            <option value="">Nenhuma</option>
            {(exams.data ?? []).map((e) => <option key={e.edition_id} value={e.edition_id}>{e.institution} · {e.exam_name}</option>)}
          </select>
          <p className="mt-1.5 text-[12px] text-ink-3">
            {d.examEditionId
              ? officialDate ? 'A prova tem data oficial, a mesma aqui e em Provas.' : 'A data da prova fica igual aqui e em Provas.'
              : 'Se esta residência tem uma prova que está em Provas, ligue as duas para a data da prova ficar igual nos dois lugares.'}
          </p>
        </section>

        {catalogMode ? (
          <Check on={published} onChange={setPublished} label="Visível para todos" hint="Desmarcado, fica como rascunho: só a administração vê." />
        ) : <Field label="Observações">
          <textarea className="field min-h-[80px] resize-none" rows={3} value={d.notes ?? ''} aria-label="Observações" placeholder="Programa novo, local de prova…"
            onChange={(e) => set({ notes: e.target.value })} />
        </Field>}
        {error && <Note tone="negative">{error}</Note>}
      </div>
    </Sheet>
  );
}
