import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Pencil, Plus } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Alert, Badge, Button, Card, Modal, PageHeader, Spinner } from '../../components/ui';
import { EntityForm, toPayload, type FieldDef } from './shared';

export function AdminSubjects() {
  const qc = useQueryClient();
  const areas = useQuery({ queryKey: ['admin-areas'], queryFn: () => api.get<any[]>('/api/admin/areas') });
  const subjects = useQuery({ queryKey: ['admin-subjects'], queryFn: () => api.get<any[]>('/api/admin/subjects') });
  const [search, setSearch] = useState('');
  const [editArea, setEditArea] = useState<any | null>(null);
  const [editSubj, setEditSubj] = useState<any | null>(null);
  const [merge, setMerge] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const areaOpts = (areas.data ?? []).map((a) => ({ value: a.id, label: a.parent_id ? `${areas.data!.find((p) => p.id === a.parent_id)?.name} › ${a.name}` : a.name }));
  const rootSubjectOpts = (subjects.data ?? []).filter((s) => !s.parent_subject_id && s.active).map((s) => ({ value: s.id, label: s.name })).sort((a, b) => a.label.localeCompare(b.label));
  const AREA_FIELDS: FieldDef[] = [
    { name: 'name', label: 'Nome', required: true },
    { name: 'parent_id', label: 'Grande área (se for especialidade)', type: 'select', options: (areas.data ?? []).filter((a) => !a.parent_id).map((a) => ({ value: a.id, label: a.name })) },
    { name: 'sort_order', label: 'Ordem', type: 'number' },
    { name: 'active', label: 'Ativa', type: 'checkbox' },
  ];
  const SUBJ_FIELDS: FieldDef[] = [
    { name: 'name', label: 'Nome', required: true, span: 2 },
    { name: 'medical_area_id', label: 'Área', type: 'select', required: true, options: areaOpts },
    { name: 'parent_subject_id', label: 'Assunto-pai (se for subassunto)', type: 'select', options: rootSubjectOpts, hint: 'Sem pai = unidade do planner.' },
    { name: 'description', label: 'Descrição', type: 'textarea' },
    { name: 'active', label: 'Ativo', type: 'checkbox' },
  ];
  const save = useMutation({
    mutationFn: ({ kind, v }: { kind: 'area' | 'subject'; v: any }) => {
      const url = kind === 'area' ? '/api/admin/areas' : '/api/admin/subjects';
      const body = toPayload(kind === 'area' ? AREA_FIELDS : SUBJ_FIELDS, v);
      return v.id ? api.put(`${url}/${v.id}`, body) : api.post(url, body);
    },
    onSuccess: () => { qc.invalidateQueries(); setEditArea(null); setEditSubj(null); },
    onError: (e) => setErr(errorMessage(e)),
  });
  const doMerge = useMutation({
    mutationFn: ({ id, targetId }: any) => api.post(`/api/admin/subjects/${id}/merge`, { targetId }),
    onSuccess: () => { qc.invalidateQueries(); setMerge(null); },
    onError: (e) => setErr(errorMessage(e)),
  });

  const tree = useMemo(() => {
    const all = subjects.data ?? [];
    const f = search.toLowerCase();
    const roots = all.filter((s) => !s.parent_subject_id);
    return roots
      .map((r) => ({ ...r, children: all.filter((c) => c.parent_subject_id === r.id) }))
      .filter((r) => !f || r.name.toLowerCase().includes(f) || r.children.some((c: any) => c.name.toLowerCase().includes(f)) || r.aliases.some((a: string) => a.toLowerCase().includes(f)));
  }, [subjects.data, search]);
  const byArea = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of tree) {
      const k = r.parent_area_name ? `${r.parent_area_name} › ${r.area_name}` : r.area_name;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tree]);

  if (areas.isLoading || subjects.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="Assuntos" subtitle="Hierarquia: grande área → especialidade → assunto (unidade do planner) → subassunto."
        action={<><Button variant="secondary" onClick={() => { setErr(null); setEditArea({ active: true }); }}><Plus className="h-4 w-4" /> Área</Button><Button onClick={() => { setErr(null); setEditSubj({ active: true }); }}><Plus className="h-4 w-4" /> Assunto</Button></>} />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Áreas" className="lg:col-span-1">
          <ul className="space-y-1 text-sm">
            {(areas.data ?? []).filter((a) => !a.parent_id).map((a) => (
              <li key={a.id}>
                <button onClick={() => setEditArea(a)} className={`font-medium hover:text-brand-700 ${a.active ? '' : 'opacity-50'}`}>{a.name}</button> <span className="text-xs text-slate-400">{a.subjects}</span>
                <ul className="ml-3 border-l border-slate-200 pl-2">
                  {(areas.data ?? []).filter((c) => c.parent_id === a.id).map((c) => (
                    <li key={c.id}><button onClick={() => setEditArea(c)} className="text-slate-600 hover:text-brand-700">{c.name}</button> <span className="text-xs text-slate-400">{c.subjects}</span></li>
                  ))}
                </ul>
              </li>
            ))}
            {areas.data?.length === 0 && <li className="text-slate-400">Nenhuma área. Crie manualmente ou confirme na importação.</li>}
          </ul>
        </Card>
        <Card title={`Assuntos (${tree.length})`} className="lg:col-span-3" action={<input className="input w-56 py-1" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />}>
          <div className="space-y-5">
            {byArea.map(([area, list]) => (
              <div key={area}>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{area}</h3>
                <ul className="divide-y divide-slate-100">
                  {list.map((s: any) => (
                    <li key={s.id} className={`py-2 ${s.active ? '' : 'opacity-50'}`}>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-sm font-medium">{s.name} {!s.active && <Badge>inativo</Badge>}</span>
                        <span className="tabular text-xs text-slate-500">{s.questions} q</span>
                        <Button size="sm" variant="ghost" title="Mesclar em outro assunto" onClick={() => { setErr(null); setMerge(s); }}><GitMerge className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" aria-label="Editar" onClick={() => { setErr(null); setEditSubj(s); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      </div>
                      {s.aliases.length > 0 && <div className="text-xs text-slate-400">Também reconhecido como: {s.aliases.join(', ')}</div>}
                      {s.children.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {s.children.map((c: any) => <button key={c.id} onClick={() => setEditSubj(c)} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-200">{c.name} <span className="text-slate-400">{c.questions}</span></button>)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Modal open={!!editArea} onClose={() => setEditArea(null)} title={editArea?.id ? 'Editar área' : 'Nova área'}
        footer={<Button loading={save.isPending} onClick={() => save.mutate({ kind: 'area', v: editArea })}>Salvar</Button>}>
        {editArea && <EntityForm fields={AREA_FIELDS} values={editArea} onChange={setEditArea} />}
        {err && <div className="mt-3"><Alert tone="late">{err}</Alert></div>}
      </Modal>
      <Modal open={!!editSubj} onClose={() => setEditSubj(null)} wide title={editSubj?.id ? 'Editar assunto' : 'Novo assunto'}
        footer={<Button loading={save.isPending} onClick={() => save.mutate({ kind: 'subject', v: editSubj })}>Salvar</Button>}>
        {editSubj && <EntityForm fields={SUBJ_FIELDS} values={editSubj} onChange={setEditSubj} />}
        {err && <div className="mt-3"><Alert tone="late">{err}</Alert></div>}
      </Modal>
      <Modal open={!!merge} onClose={() => setMerge(null)} title={`Mesclar "${merge?.name}"`}
        footer={<Button loading={doMerge.isPending} disabled={!merge?.targetId} onClick={() => doMerge.mutate({ id: merge.id, targetId: merge.targetId })}>Mesclar</Button>}>
        <p className="text-sm text-slate-600">As questões e subassuntos passam para o assunto escolhido. "{merge?.name}" vira um nome alternativo reconhecido nas próximas importações e é desativado (não apagado).</p>
        <select className="input mt-3" value={merge?.targetId ?? ''} onChange={(e) => setMerge({ ...merge, targetId: e.target.value })} aria-label="Assunto de destino">
          <option value="">Escolha o assunto de destino…</option>
          {rootSubjectOpts.filter((o) => o.value !== merge?.id).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {err && <div className="mt-3"><Alert tone="late">{err}</Alert></div>}
      </Modal>
    </>
  );
}
