/**
 * Residências: as residências em que a pessoa vai se inscrever, cada uma com
 * a linha do tempo (edital, inscrição, prova, resultado...), vagas e nota de
 * corte, taxa e a situação dela. Tudo cadastrado à mão.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, X } from 'lucide-react';
import { clsx } from 'clsx';
import { api, ApiError, errorMessage } from '../lib/api';
import { shortDate, todayBR } from '../lib/format';
import { useWide } from '../lib/zoom';
import { TONE_TINT, upcoming, useResidencies, useResidencyActions, type ResidencyPatch, type ResidencyView } from '../lib/residency';
import { TypeDot, UpcomingList } from '../components/Residencies';
import { Button, CheckSquare, Eyebrow, Field, Note, Segmented, Sheet, Spinner, SquareButton } from '../components/ui';
import {
  DEFAULT_STEPS, defaultSteps, nextEvent, RANGE_KEYS, residencyStatus, sortResidencies, STEP_TYPES,
  type Institution, type Specialty, type Step, type StepType,
} from '../../../shared/residency';

export function ResidenciesPage() {
  const today = todayBR();
  const q = useResidencies();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const desktop = useWide();
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
            <button onClick={() => setCreating(true)} data-testid="new-residency"
              className="flex shrink-0 items-center gap-2 pb-1 text-[14px] text-ink-2 transition hover:text-ink">
              <Plus className="h-[18px] w-[18px]" strokeWidth={1.25} /><span className="hidden sm:inline">Nova residência</span>
            </button>
          </div>
        </div>
        <div className={clsx('border-t border-line', desktop && 'no-scrollbar fade-scroll -mx-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-10')}>
          {list.length === 0 ? (
            <div className="py-10">
              <p className="font-display text-[26px] italic">Nenhuma residência ainda.</p>
              <p className="mt-2 max-w-md text-[15px] text-ink-2">
                Cadastre as residências em que você vai se inscrever: as datas de cada etapa vão para a Agenda, e o prazo mais próximo aparece no Planner.
              </p>
              <button onClick={() => setCreating(true)} className="mt-6 flex items-center gap-2 text-[15px] text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                <Plus className="h-4 w-4" strokeWidth={1.5} />Cadastrar a primeira
              </button>
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

function SpecialtyList({ list, onChange, owner }: { list: Specialty[]; onChange: (l: Specialty[]) => void; owner?: string }) {
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

function ResidencyEditor({ residency, onClose }: { residency?: ResidencyView; onClose: () => void }) {
  const { create, patch, remove } = useResidencyActions();
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api.get<any[]>('/api/exams') });
  const [d, setD] = useState<Draft>(() => residency
    ? { ...residency, multi: residency.institutions.length > 0 }
    : blank());
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
    delete (body as any).id; delete (body as any).createdAt; delete (body as any).exam;
    try {
      if (residency) await patch.mutateAsync({ id: residency.id, patch: body });
      else await create.mutateAsync(body);
      onClose();
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <Sheet open wide onClose={onClose} footer={<>
      {residency && (confirmDel
        ? <Button variant="destructive" size="sm" className="mr-auto" onClick={() => { remove.mutate(residency.id); onClose(); }}>Confirmar exclusão</Button>
        : <Button variant="plain" size="sm" className="mr-auto text-negative" onClick={() => setConfirmDel(true)}>Excluir</Button>)}
      <Button variant="plain" onClick={onClose}>Cancelar</Button>
      <Button onClick={save} loading={create.isPending || patch.isPending}>Salvar</Button>
    </>}>
      <div className="space-y-10">
        <div className="space-y-4 pr-8">
          <input className="w-full border-b border-line bg-transparent pb-2 font-display text-[32px] leading-tight outline-none placeholder:text-ink-3 focus:border-ink"
            aria-label="Nome da residência" placeholder={residency ? 'Nome' : 'Nova residência'} autoFocus={!residency}
            value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
            <Field label="Cidade"><input className="field" value={d.city ?? ''} onChange={(e) => set({ city: e.target.value })} /></Field>
            <Field label="Link do edital">
              <div className="flex items-center gap-2">
                <input className="field" type="url" inputMode="url" placeholder="https://" value={d.editalUrl ?? ''} onChange={(e) => set({ editalUrl: e.target.value })} />
                {d.editalUrl && <a href={d.editalUrl} target="_blank" rel="noreferrer" aria-label="Abrir edital" className="shrink-0 rounded-full p-2 text-ink-2 hover:bg-fill hover:text-ink"><ExternalLink className="h-4 w-4" strokeWidth={1.5} /></a>}
              </div>
            </Field>
          </div>
        </div>

        <section>
          <Head>Minha situação</Head>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <Segmented value={d.decision ?? 'yes'} onChange={(v) => set({ decision: v })}
              options={[{ value: 'yes', label: 'Vou fazer' }, { value: 'maybe', label: 'Talvez' }, { value: 'no', label: 'Não vou' }]} />
            <Check on={!!d.enrolled} onChange={(v) => set({ enrolled: v })} label="Inscrito" />
          </div>
        </section>

        <section>
          <Head>Vagas e nota de corte do ano anterior</Head>
          <div className="mb-4"><Check on={d.multi} label="Prova com várias instituições" hint="Ex.: ENARE. Um cartão só, com as instituições dentro."
            onChange={(v) => set({ multi: v, institutions: v && !d.institutions.length ? [{ name: '', city: '', specialties: [] }] : d.institutions })} /></div>
          {d.multi ? (
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
              <input className="field" type="number" min={0} step="0.01" placeholder="0,00" value={d.fee ?? ''}
                onChange={(e) => set({ fee: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            {reducao && (
              <div>
                <span className="mb-1.5 block text-[13px] text-ink-2">Período para pedir redução ou isenção</span>
                <div className="flex min-h-[42px] flex-wrap items-center gap-2 text-[13px] text-ink-3">
                  <DateInput label="Redução - início" value={reducao.date} onChange={(v) => setStep(reducao.id, { date: v })} />a
                  <DateInput label="Redução - fim" value={reducao.end} onChange={(v) => setStep(reducao.id, { end: v })} />
                </div>
              </div>
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-3">
            <Check on={!!d.reductionRequested} onChange={(v) => set({ reductionRequested: v })} label="Pedi redução" />
            {d.reductionRequested && (
              <Segmented value={d.reductionGranted == null ? 'wait' : d.reductionGranted ? 'yes' : 'no'}
                onChange={(v) => set({ reductionGranted: v === 'wait' ? null : v === 'yes' })}
                className="[&>button]:py-0 [&>button]:text-[14px]"
                options={[{ value: 'wait', label: 'Aguardando' }, { value: 'yes', label: 'Aceita' }, { value: 'no', label: 'Negada' }]} />
            )}
            <Check on={!!d.paid} onChange={(v) => set({ paid: v })} label="Paguei" />
          </div>
        </section>

        <section>
          <Head>Linha do tempo</Head>
          <ol>
            {d.steps.map((s) => {
              const range = RANGE_KEYS.includes(s.key);
              const locked = s.key === 'prova' && !!officialDate;
              return (
                <li key={s.id} data-testid="step" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/70 py-2">
                  <SquareButton size="sm" on={s.done} onChange={(v) => setStep(s.id, { done: v })} label={`${s.label} - feito`} />
                  <TypeDot type={s.type} />
                  {s.key === 'custom'
                    ? <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" value={s.label} aria-label="Nome da etapa" onChange={(e) => setStep(s.id, { label: e.target.value })} />
                    : <span className={clsx('min-w-0 flex-1 text-[15px]', s.done && 'text-ink-3 line-through decoration-1')}>{s.label}</span>}
                  <span className="ml-auto flex items-center gap-1.5 text-[13px] text-ink-3">
                    {range ? (
                      <>
                        <DateInput label={`${s.label} - início`} value={s.date} onChange={(v) => setStep(s.id, { date: v })} />a
                        <DateInput label={`${s.label} - fim`} value={s.end} onChange={(v) => setStep(s.id, { end: v })} />
                      </>
                    ) : (
                      <DateInput label={`${s.label} - dia`} value={locked ? officialDate! : s.date} onChange={(v) => setStep(s.id, { date: v })} disabled={locked} />
                    )}
                    <button type="button" onClick={() => set({ steps: d.steps.filter((x) => x.id !== s.id) })} aria-label={`Remover etapa ${s.label}`}
                      className="rounded-full p-1 text-ink-3 hover:text-ink"><X className="h-3.5 w-3.5" /></button>
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
          {removed.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
              <span>Etapas removidas:</span>
              {removed.map((x) => <button key={x.key} type="button" onClick={() => restore(x.key)} className="underline-offset-4 hover:text-ink hover:underline">+ {x.label}</button>)}
            </div>
          )}
        </section>

        <section>
          <Head>Ligação com Provas</Head>
          <select className="field" aria-label="Prova em Provas" value={d.examEditionId ?? ''} onChange={(e) => link(e.target.value || null)}>
            <option value="">Nenhuma</option>
            {(exams.data ?? []).map((e) => <option key={e.edition_id} value={e.edition_id}>{e.institution} · {e.exam_name}</option>)}
          </select>
          <p className="mt-1.5 text-[12px] text-ink-3">
            {d.examEditionId
              ? officialDate ? 'A prova tem data oficial, a mesma aqui e em Provas.' : 'A data da prova fica igual aqui e em Provas.'
              : 'Se esta residência tem uma prova que está em Provas, ligue as duas para a data da prova ficar igual nos dois lugares.'}
          </p>
        </section>

        <Field label="Observações">
          <textarea className="field min-h-[80px] resize-none" rows={3} value={d.notes ?? ''} aria-label="Observações" placeholder="Programa novo, local de prova…"
            onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        {error && <Note tone="negative">{error}</Note>}
      </div>
    </Sheet>
  );
}
