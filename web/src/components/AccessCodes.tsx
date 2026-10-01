import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { dateBR } from '../lib/format';
import { Button, Note } from './ui';

interface AccessCode {
  id: string;
  code: string;
  note: string;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
  used_by_email: string | null;
  used_by_name: string | null;
  user_active: boolean | null;
}

/** ABCDEFGHJKLM → ABCD-EFGH-JKLM (o banco aceita com ou sem traços). */
export const formatCode = (c: string) => c.match(/.{1,4}/g)?.join('-') ?? c;

const copy = async (text: string) => {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
};

const PAGE = 50;

/** Administração: gerar códigos para vender, ver quem usou e cancelar. */
export function AccessCodes() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['access-codes'], queryFn: () => api.get<AccessCode[]>('/api/admin/access-tokens') });
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string[]>([]);
  const [filter, setFilter] = useState<'free' | 'used' | 'all'>('free');
  const [msg, setMsg] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const codes = await api.post<string[]>('/api/admin/access-tokens', { count, note });
      setFresh(codes.map(formatCode));
      setNote('');
      await qc.invalidateQueries({ queryKey: ['access-codes'] });
    } catch (err) { setMsg({ tone: 'negative', text: errorMessage(err) }); } finally { setBusy(false); }
  };

  const revoke = async (c: AccessCode) => {
    const warn = c.used_at
      ? `Cancelar ${formatCode(c.code)}? ${c.used_by_email ?? 'A conta que usou'} perde o acesso ao site.`
      : `Cancelar ${formatCode(c.code)}? Ele deixa de funcionar.`;
    if (!window.confirm(warn)) return;
    try {
      await api.post(`/api/admin/access-tokens/${c.id}/revoke`);
      await qc.invalidateQueries({ queryKey: ['access-codes'] });
    } catch (err) { setMsg({ tone: 'negative', text: errorMessage(err) }); }
  };

  const rows = (list.data ?? []).filter((c) =>
    filter === 'all' || (filter === 'free' ? !c.used_at && !c.revoked_at : !!c.used_at));
  const free = (list.data ?? []).filter((c) => !c.used_at && !c.revoked_at).length;
  const used = (list.data ?? []).filter((c) => c.used_at).length;

  return (
    <section className="animate-in" data-testid="access-codes">
      <h2 className="mb-2 text-[13px] text-ink-2">Códigos de acesso</h2>
      <div className="border-y border-line py-4">
        <p className="text-[15px] text-ink-2">Cada código libera uma conta, para sempre. Venda fora do site e envie o código para a pessoa digitar ao criar a conta.</p>
        <form onSubmit={generate} className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[15px]">
            Quantos
            <input className="field w-20" type="number" min={1} max={100} aria-label="Quantidade de códigos" value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
          </label>
          <input className="field min-w-0 flex-1" aria-label="Anotação" placeholder="Anotação (ex.: comprador, lote)" maxLength={200}
            value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" loading={busy}>Gerar</Button>
        </form>

        {fresh.length > 0 && (
          <div className="mt-4 rounded-md border border-line p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-ink-2">{fresh.length === 1 ? 'Código novo' : `${fresh.length} códigos novos`}</span>
              <Button variant="plain" size="sm" onClick={async () => setMsg(await copy(fresh.join('\n'))
                ? { tone: 'positive', text: 'Copiado.' } : { tone: 'negative', text: 'Não foi possível copiar; selecione e copie à mão.' })}>Copiar</Button>
            </div>
            <pre className="mt-2 font-mono text-[15px] leading-relaxed whitespace-pre-wrap select-all" data-testid="access-codes-new">{fresh.join('\n')}</pre>
          </div>
        )}
        {msg && <Note tone={msg.tone} className="mt-3">{msg.text}</Note>}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-[13px]">
        {([['free', `Livres (${free})`], ['used', `Usados (${used})`], ['all', 'Todos']] as const).map(([v, label]) => (
          <button key={v} onClick={() => { setFilter(v); setShown(PAGE); }} className={filter === v ? 'text-ink underline underline-offset-4' : 'text-ink-3 hover:text-ink'}>{label}</button>
        ))}
      </div>
      {list.isLoading ? null : list.error ? <Note tone="negative" className="mt-3">{errorMessage(list.error)}</Note> : (
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {rows.length === 0 && <li className="py-3 text-[15px] text-ink-3">Nenhum código aqui.</li>}
          {rows.slice(0, shown).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className={`font-mono text-[15px] ${c.revoked_at ? 'text-ink-3 line-through' : ''}`}>{formatCode(c.code)}</div>
                <div className="truncate text-[13px] text-ink-3">
                  {c.revoked_at ? `cancelado em ${dateBR(c.revoked_at)}`
                    : c.used_at ? `usado por ${c.used_by_name ?? ''}${c.used_by_email ? ` (${c.used_by_email})` : ''} em ${dateBR(c.used_at)}`
                    : `criado em ${dateBR(c.created_at)}`}
                  {c.note && ` · ${c.note}`}
                </div>
              </div>
              {!c.revoked_at && (
                <div className="flex shrink-0 gap-3">
                  {!c.used_at && <button className="text-[13px] text-ink-3 hover:text-ink" onClick={() => copy(formatCode(c.code))}>Copiar</button>}
                  <button className="text-[13px] text-ink-3 hover:text-negative" onClick={() => revoke(c)}>Cancelar</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown && (
        <Button variant="plain" size="sm" className="mt-3" onClick={() => setShown(shown + PAGE)}>Mostrar mais ({rows.length - shown})</Button>
      )}
    </section>
  );
}
