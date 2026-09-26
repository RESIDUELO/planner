/**
 * "+" num dia do planner: escolhe um assunto das provas (ou um criado antes)
 * ou cria um assunto novo, só seu. Tudo vira o mesmo tipo de item no dia.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { api, errorMessage } from '../lib/api';
import { areaShort, tintFor } from '../lib/areas';
import { shortDate, todayBR } from '../lib/format';
import { weekdayLong } from '../lib/agenda';
import { Button, Note, Sheet } from './ui';
import { useInvalidateStudy } from './SubjectModal';

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function AddSubjectSheet({ date, data, onClose }: { date: string; data: any; onClose: () => void }) {
  const invalidate = useInvalidateStudy();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayBR();
  const areas = useQuery({ queryKey: ['areas'], queryFn: () => api.get<{ id: string; name: string; other: boolean }[]>('/api/areas'), staleTime: Infinity });
  const add = useMutation({
    mutationFn: (b: { subjectId?: string; name?: string; areaId?: string | null }) => api.post(`/api/planner/days/${date}/subjects`, b),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });

  const all: any[] = (data?.subjects ?? []).filter((s: any) => s.status !== 'studied');
  const found = useMemo(() => (query ? all.filter((s) => plain(s.name).includes(plain(query))) : all), [all, query]);
  const fromExam = found.filter((s) => !s.own);
  const mine = found.filter((s) => s.own);
  const nothing = !all.length;
  const showForm = creating || nothing;
  const startCreate = () => { setName(query); setCreating(true); setError(null); };

  const Row = ({ s }: { s: any }) => {
    const d = s.nextScheduledDate as string | null;
    return (
      <li>
        <button onClick={() => { setError(null); add.mutate({ subjectId: s.subjectId }); }} disabled={add.isPending} data-testid="add-pick"
          className="flex w-full items-center gap-3 border-b border-line/60 py-2.5 text-left transition-opacity hover:opacity-70 disabled:opacity-40">
          <span className={`h-2 w-2 shrink-0 rounded-full dot-${tintFor(s.area)}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] leading-snug">{s.name}</span>
            <span className="block truncate text-[11px] text-ink-3">
              {areaShort(s.area)}{s.hidden ? ' · fora do planner' : d ? ` · ${d === date ? 'já neste dia' : d < today ? 'atrasado' : `em ${shortDate(d, false)}`}` : ' · sem dia'}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <Sheet open onClose={onClose} title={<>Adicionar <span className="text-ink-3 italic">· {weekdayLong(date)}, {shortDate(date, false)}</span></>}>
      {!showForm && (
        <>
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input className="field pl-9" autoFocus placeholder="Pesquisar assunto…" aria-label="Pesquisar assunto" value={query}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !found.length && query.trim()) startCreate(); }} />
          </label>
          <div className="no-scrollbar mt-4 max-h-[46vh] overflow-y-auto">
            {mine.length > 0 && (
              <section aria-label="Seus assuntos" className="mb-5">
                <p className="text-[10.5px] font-medium tracking-[0.18em] text-ink-2 uppercase">Seus assuntos</p>
                <ul>{mine.slice(0, query ? 50 : 20).map((s) => <Row key={s.subjectId} s={s} />)}</ul>
              </section>
            )}
            {fromExam.length > 0 && (
              <section aria-label="Da prova">
                <p className="text-[10.5px] font-medium tracking-[0.18em] text-ink-2 uppercase">Da prova</p>
                <ul>{fromExam.slice(0, query ? 50 : 30).map((s) => <Row key={s.subjectId} s={s} />)}</ul>
              </section>
            )}
            {!found.length && <p className="py-3 text-[14px] text-ink-3">Nenhum assunto com esse nome.</p>}
          </div>
          <button onClick={startCreate} className="mt-4 flex items-center gap-2 text-[15px] text-ink transition hover:opacity-70" data-testid="add-create">
            <Plus className="h-4 w-4" strokeWidth={1.5} />Criar novo assunto{query.trim() && <span className="text-ink-3">“{query.trim()}”</span>}
          </button>
        </>
      )}

      {showForm && (
        <form className="animate-in" onSubmit={(e) => { e.preventDefault(); setError(null); add.mutate({ name: name.trim(), areaId }); }}>
          <p className="text-[13px] text-ink-2">{nothing ? 'Escreva o tema que você quer estudar neste dia.' : 'Um assunto só seu: não muda a base de assuntos das provas.'}</p>
          <input className="mt-4 w-full border-b border-line bg-transparent pb-2 font-display text-[26px] leading-tight outline-none placeholder:text-ink-3 focus:border-ink"
            autoFocus aria-label="Nome do assunto" placeholder="Ex.: Síndrome de Brugada" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          <p className="mt-6 mb-2 text-[13px] text-ink-2">Área <span className="text-ink-3">(opcional)</span></p>
          <div className="flex flex-wrap gap-2">
            {(areas.data ?? []).filter((a) => !a.other).map((a) => (
              <button type="button" key={a.id} aria-pressed={areaId === a.id} onClick={() => setAreaId(areaId === a.id ? null : a.id)}
                className={clsx('rounded-full border px-3 py-1 text-[13px] transition', areaId === a.id ? 'border-ink bg-ink text-canvas' : 'border-line text-ink-2 hover:border-ink hover:text-ink')}>
                {areaShort(a.name)}
              </button>
            ))}
          </div>
          <div className="mt-8 flex items-center gap-4">
            <Button type="submit" disabled={!name.trim()} loading={add.isPending}>Adicionar ao Planner</Button>
            {!nothing && <Button type="button" variant="plain" onClick={() => setCreating(false)}>Voltar à lista</Button>}
          </div>
        </form>
      )}
      {error && <Note tone="negative" className="mt-6">{error}</Note>}
    </Sheet>
  );
}
