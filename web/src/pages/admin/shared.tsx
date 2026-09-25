import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Alert, Button, Card, Field, Modal, Spinner } from '../../components/ui';

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'url' | 'select' | 'checkbox' | 'textarea' | 'money';
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  span?: 2;
}

export function toPayload(fields: FieldDef[], values: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === 'checkbox') out[f.name] = !!v;
    else if (f.type === 'number' || f.type === 'money') out[f.name] = v === '' || v == null ? null : Number(v);
    else if (f.type === 'select') out[f.name] = v === '' || v == null ? null : v;
    else out[f.name] = v === '' || v == null ? null : String(v);
  }
  return out;
}

export function EntityForm({ fields, values, onChange }: { fields: FieldDef[]; values: Record<string, any>; onChange: (v: Record<string, any>) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const v = values[f.name] ?? '';
        const set = (x: any) => onChange({ ...values, [f.name]: x });
        const span = f.span === 2 || f.type === 'textarea' ? 'sm:col-span-2' : '';
        if (f.type === 'checkbox') return (
          <label key={f.name} className={`flex items-center gap-2 text-sm ${span}`}><input type="checkbox" className="accent-brand-600" checked={!!values[f.name]} onChange={(e) => set(e.target.checked)} /> {f.label}</label>
        );
        return (
          <Field key={f.name} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint} className={span}>
            {f.type === 'select' ? (
              <select className="input" value={v} required={f.required} onChange={(e) => set(e.target.value)} aria-label={f.label}>
                <option value="">—</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea className="input min-h-24" value={v} onChange={(e) => set(e.target.value)} aria-label={f.label} />
            ) : (
              <input className="input" aria-label={f.label} required={f.required}
                type={f.type === 'money' ? 'number' : f.type === 'url' ? 'url' : f.type ?? 'text'} step={f.type === 'money' ? '0.01' : undefined}
                value={v ?? ''} onChange={(e) => set(e.target.value)} />
            )}
          </Field>
        );
      })}
    </div>
  );
}

export function CrudPage({ title, subtitle, endpoint, queryKey, fields, columns, defaults = {}, extraActions }: {
  title: string; subtitle?: string; endpoint: string; queryKey: string; fields: FieldDef[];
  columns: { label: string; render: (row: any) => ReactNode; className?: string }[];
  defaults?: Record<string, any>; extraActions?: (row: any) => ReactNode;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [queryKey], queryFn: () => api.get<any[]>(endpoint) });
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: any) => (v.id ? api.put(`${endpoint}/${v.id}`, toPayload(fields, v)) : api.post(endpoint, toPayload(fields, v))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); setEditing(null); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Card title={title} subtitle={subtitle} action={<Button size="sm" onClick={() => { setError(null); setEditing({ active: true, ...defaults }); }}><Plus className="h-3.5 w-3.5" /> Novo</Button>}>
      {q.isLoading ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr>{columns.map((c) => <th key={c.label} className={c.className}>{c.label}</th>)}<th /></tr></thead>
            <tbody>
              {(q.data ?? []).map((row) => (
                <tr key={row.id} className={row.active === false ? 'opacity-50' : ''}>
                  {columns.map((c) => <td key={c.label} className={c.className}>{c.render(row)}</td>)}
                  <td className="text-right whitespace-nowrap">
                    {extraActions?.(row)}
                    <Button size="sm" variant="ghost" onClick={() => { setError(null); setEditing(row); }} aria-label="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
              {q.data?.length === 0 && <tr><td colSpan={columns.length + 1} className="py-8 text-center text-slate-400">Nenhum registro.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar' : 'Novo'} wide
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate(editing)}>Salvar</Button></>}>
        {editing && <EntityForm fields={fields} values={editing} onChange={setEditing} />}
        {error && <div className="mt-4"><Alert tone="late">{error}</Alert></div>}
        <p className="mt-4 text-xs text-slate-500">Registros não são apagados: desative-os para preservar o histórico. Toda alteração fica registrada nos logs.</p>
      </Modal>
    </Card>
  );
}

export const STATUS_LABEL: Record<string, string> = { draft: 'Rascunho', published: 'Publicada', archived: 'Arquivada' };
export const STATUS_TONE: Record<string, 'warn' | 'ok' | 'neutral'> = { draft: 'warn', published: 'ok', archived: 'neutral' };

export const EDITION_FIELDS = (exams?: { value: string; label: string }[]): FieldDef[] => [
  ...(exams ? [{ name: 'exam_id', label: 'Prova', type: 'select' as const, options: exams, required: true, span: 2 as const }] : []),
  { name: 'year', label: 'Ano / edição', type: 'number', required: true },
  { name: 'exam_date', label: 'Data da prova', type: 'date' },
  { name: 'registration_start', label: 'Início das inscrições', type: 'date' },
  { name: 'registration_end', label: 'Fim das inscrições', type: 'date' },
  { name: 'registration_fee', label: 'Valor da inscrição (R$)', type: 'money' },
  { name: 'number_of_vacancies', label: 'Número de vagas', type: 'number' },
  { name: 'total_questions', label: 'Total de questões', type: 'number', hint: 'Se vazio, usa o total da prova.' },
  { name: 'edital_url', label: 'Edital (URL)', type: 'url' },
  { name: 'answer_key_url', label: 'Gabarito (URL)', type: 'url' },
  { name: 'result_url', label: 'Resultado (URL)', type: 'url' },
  { name: 'source_name', label: 'Fonte dos dados', hint: 'Ex.: Edital oficial' },
  { name: 'source_url', label: 'URL da fonte', type: 'url' },
  { name: 'source_checked_at', label: 'Conferido em', type: 'date' },
  { name: 'notes', label: 'Observações', type: 'textarea' },
];
