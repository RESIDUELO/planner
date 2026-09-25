import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, CircleAlert, Pencil, Plus, Tag, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { dateBR, dateTimeBR, money } from '../../lib/format';
import { Alert, Badge, Button, Card, Modal, PageHeader, Spinner } from '../../components/ui';
import { CrudPage, EDITION_FIELDS, EntityForm, STATUS_LABEL, STATUS_TONE, toPayload, type FieldDef } from './shared';
import { StatsView } from './AdminStats';

export function AdminEditions() {
  const [params] = useSearchParams();
  const exams = useQuery({ queryKey: ['admin-exams'], queryFn: () => api.get<any[]>('/api/admin/exams') });
  const examId = params.get('exam');
  const opts = (exams.data ?? []).map((e) => ({ value: e.id, label: `${e.institution} — ${e.name}` }));
  return (
    <CrudPage title="Edições" subtitle="Toda edição nasce como rascunho e só aparece para os usuários depois de publicada."
      endpoint={`/api/admin/editions${examId ? `?examId=${examId}` : ''}`} queryKey={`admin-editions-${examId ?? 'all'}`}
      defaults={examId ? { exam_id: examId } : {}}
      fields={EDITION_FIELDS(opts)}
      columns={[
        { label: 'Prova', render: (r) => <Link to={`/admin/edicoes/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.institution} {r.year} — {r.exam_name}</Link> },
        { label: 'Data', render: (r) => dateBR(r.exam_date) },
        { label: 'Inscrição', render: (r) => r.registration_end ? `até ${dateBR(r.registration_end)}` : '—' },
        { label: 'Valor', render: (r) => money(r.registration_fee) },
        { label: 'Questões', render: (r) => `${r.classified}/${r.questions}`, className: 'text-right' },
        { label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
      ]} />
  );
}

export function AdminEditionDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-edition', id], queryFn: () => api.get(`/api/admin/editions/${id}`) });
  const [tab, setTab] = useState<'data' | 'questions' | 'stats' | 'publish'>('publish');
  const [err, setErr] = useState<string | null>(null);
  const status = useMutation({
    mutationFn: (s: string) => api.post(`/api/admin/editions/${id}/status`, { status: s }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => setErr(errorMessage(e)),
  });
  if (q.isLoading) return <Spinner />;
  const { edition: ed, counts, checks } = q.data;
  return (
    <>
      <PageHeader title={`${ed.institution} ${ed.year} — ${ed.exam_name}`}
        subtitle={<>Cadastrada por {ed.registered_by_name ?? '—'} em {dateTimeBR(ed.created_at)}{ed.published_at && ` · publicada em ${dateTimeBR(ed.published_at)}`}</>}
        action={<Badge tone={STATUS_TONE[ed.status]} className="text-sm">{STATUS_LABEL[ed.status]}</Badge>} />
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {([['publish', 'Revisão e publicação'], ['data', 'Dados'], ['questions', `Questões (${counts.questions})`], ['stats', 'Estatísticas']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'}`}>{l}</button>
        ))}
      </div>
      {err && <div className="mb-4"><Alert tone="late">{err}</Alert></div>}
      {tab === 'publish' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Checklist de revisão">
            <ul className="space-y-2 text-sm">
              {checks.map((c: any) => (
                <li key={c.key} className="flex items-center gap-2">
                  {c.ok ? <CheckCircle2 className="h-4 w-4 text-ok-600" /> : <CircleAlert className="h-4 w-4 text-warn-500" />}
                  <span className={c.ok ? '' : 'text-slate-600'}>{c.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-slate-500">{counts.questions} questões · {counts.classified} classificadas · {counts.annulled} anuladas · {counts.with_statement} com enunciado.</p>
          </Card>
          <Card title="Publicação">
            <p className="text-sm text-slate-600">
              {ed.status === 'draft' && 'Rascunho: invisível para os usuários e fora das análises do planner.'}
              {ed.status === 'published' && 'Publicada: visível na página Provas e usada nas análises históricas do planner.'}
              {ed.status === 'archived' && 'Arquivada: preservada no banco, mas fora da área dos usuários.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {ed.status !== 'published' && <Button variant="success" loading={status.isPending} onClick={() => status.mutate('published')}>Publicar</Button>}
              {ed.status === 'published' && <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate('draft')}>Despublicar (voltar a rascunho)</Button>}
              {ed.status !== 'archived' && <Button variant="ghost" onClick={() => status.mutate('archived')}>Arquivar</Button>}
            </div>
          </Card>
        </div>
      )}
      {tab === 'data' && <EditionData edition={ed} />}
      {tab === 'questions' && <QuestionsTab editionId={id!} />}
      {tab === 'stats' && <StatsView examId={ed.exam_id} />}
    </>
  );
}

function EditionData({ edition }: { edition: any }) {
  const qc = useQueryClient();
  const fields = EDITION_FIELDS();
  const [v, setV] = useState<any>(edition);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'late'; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => api.put(`/api/admin/editions/${edition.id}`, toPayload(fields, v)),
    onSuccess: () => { qc.invalidateQueries(); setMsg({ tone: 'ok', text: 'Salvo. A alteração foi registrada nos logs.' }); },
    onError: (e) => setMsg({ tone: 'late', text: errorMessage(e) }),
  });
  return (
    <Card>
      <EntityForm fields={fields} values={v} onChange={setV} />
      {msg && <div className="mt-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="mt-4 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></div>
    </Card>
  );
}

const QUESTION_FIELDS: FieldDef[] = [
  { name: 'question_number', label: 'Número', type: 'number', required: true },
  { name: 'correct_answer', label: 'Gabarito', type: 'select', options: ['A', 'B', 'C', 'D', 'E'].map((x) => ({ value: x, label: x })) },
  { name: 'annulled', label: 'Anulada', type: 'checkbox' },
  { name: 'difficulty', label: 'Dificuldade', type: 'select', options: [{ value: 'easy', label: 'Fácil' }, { value: 'medium', label: 'Média' }, { value: 'hard', label: 'Difícil' }] },
  { name: 'summary', label: 'Resumo (o que a questão cobra)', type: 'textarea' },
  { name: 'statement', label: 'Enunciado', type: 'textarea' },
  { name: 'alternative_a', label: 'Alternativa A', span: 2 },
  { name: 'alternative_b', label: 'Alternativa B', span: 2 },
  { name: 'alternative_c', label: 'Alternativa C', span: 2 },
  { name: 'alternative_d', label: 'Alternativa D', span: 2 },
  { name: 'alternative_e', label: 'Alternativa E', span: 2 },
  { name: 'explanation', label: 'Comentário / explicação', type: 'textarea' },
  { name: 'question_type', label: 'Tipo de cobrança' },
  { name: 'guideline', label: 'Diretriz' },
  { name: 'source', label: 'Fonte' },
  { name: 'active', label: 'Ativa', type: 'checkbox' },
];

export function useSubjectOptions() {
  return useQuery({
    queryKey: ['admin-subjects'],
    queryFn: () => api.get<any[]>('/api/admin/subjects'),
    select: (rows) => rows.filter((s) => s.active).map((s) => ({
      id: s.id,
      label: [s.parent_area_name ?? s.area_name, s.parent_area_name ? s.area_name : null, s.parent_name, s.name].filter(Boolean).join(' › '),
    })).sort((a, b) => a.label.localeCompare(b.label)),
  });
}

function QuestionsTab({ editionId }: { editionId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-questions', editionId], queryFn: () => api.get<any[]>(`/api/admin/editions/${editionId}/questions`) });
  const [edit, setEdit] = useState<any | null>(null);
  const [classify, setClassify] = useState<any | null>(null);
  const [filter, setFilter] = useState<'all' | 'unclassified'>('all');
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: any) => {
      const body = toPayload(QUESTION_FIELDS, v);
      return v.id ? api.put(`/api/admin/questions/${v.id}`, body) : api.post('/api/admin/questions', { ...body, exam_edition_id: editionId });
    },
    onSuccess: () => { qc.invalidateQueries(); setEdit(null); },
    onError: (e) => setErr(errorMessage(e)),
  });
  const list = (q.data ?? []).filter((x) => filter === 'all' || x.subjects.length === 0);
  const next = Math.max(0, ...(q.data ?? []).map((x) => x.question_number)) + 1;
  return (
    <Card title="Questões e classificação" action={<div className="flex gap-2">
      <select className="input w-auto py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as any)} aria-label="Filtro"><option value="all">Todas</option><option value="unclassified">Sem classificação</option></select>
      <Button size="sm" onClick={() => { setErr(null); setEdit({ question_number: next, active: true }); }}><Plus className="h-3.5 w-3.5" /> Questão</Button>
    </div>}>
      {q.isLoading ? <Spinner /> : list.length === 0 ? <p className="text-sm text-slate-500">Nenhuma questão. Cadastre manualmente ou use a <Link className="text-brand-600" to="/admin/importacao">importação</Link>.</p> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Nº</th><th>Conteúdo</th><th>Gab.</th><th>Assuntos</th><th /></tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id} className={x.active ? '' : 'opacity-50'}>
                  <td className="tabular">{x.question_number}</td>
                  <td className="max-w-md"><div className="line-clamp-2 text-slate-700">{x.statement ?? x.summary}</div>{x.guideline && <div className="text-xs text-slate-400">{x.guideline}</div>}</td>
                  <td>{x.annulled ? <Badge tone="warn">Anulada</Badge> : x.correct_answer}</td>
                  <td className="min-w-48">
                    {x.subjects.length === 0 ? <Badge tone="late">Sem classificação</Badge> : x.subjects.map((s: any) => (
                      <div key={s.subject_id} className="text-xs">{s.is_primary ? <b>{s.parent ? `${s.parent} › ` : ''}{s.name}</b> : <span className="text-slate-500">{s.parent ? `${s.parent} › ` : ''}{s.name} ({s.weight})</span>}</div>
                    ))}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setClassify(x)} aria-label="Classificar"><Tag className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => { setErr(null); setEdit(x); }} aria-label="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} wide title={edit?.id ? `Questão ${edit.question_number}` : 'Nova questão'}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate(edit)}>Salvar</Button></>}>
        {edit && <EntityForm fields={QUESTION_FIELDS} values={edit} onChange={setEdit} />}
        {err && <div className="mt-4"><Alert tone="late">{err}</Alert></div>}
      </Modal>
      {classify && <ClassifyModal question={classify} onClose={() => setClassify(null)} />}
    </Card>
  );
}

function ClassifyModal({ question, onClose }: { question: any; onClose: () => void }) {
  const qc = useQueryClient();
  const subjects = useSubjectOptions();
  const [links, setLinks] = useState<{ subjectId: string; weight: number; isPrimary: boolean }[]>(
    question.subjects.map((s: any) => ({ subjectId: s.subject_id, weight: Number(s.weight), isPrimary: s.is_primary })));
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const byId = useMemo(() => new Map((subjects.data ?? []).map((s) => [s.id, s.label])), [subjects.data]);
  const matches = (subjects.data ?? []).filter((s) => search.length >= 2 && s.label.toLowerCase().includes(search.toLowerCase())).slice(0, 12);
  const save = useMutation({
    mutationFn: () => api.put(`/api/admin/questions/${question.id}/subjects`, links),
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
    onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} wide title={`Classificar questão ${question.question_number}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar classificação</Button></>}>
      <p className="mb-3 text-sm text-slate-600">{question.statement ?? question.summary}</p>
      <div className="space-y-2">
        {links.map((l, i) => (
          <div key={l.subjectId} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
            <span className="flex-1">{byId.get(l.subjectId) ?? l.subjectId}</span>
            <label className="flex items-center gap-1 text-xs"><input type="radio" checked={l.isPrimary} onChange={() => setLinks(links.map((x, j) => ({ ...x, isPrimary: j === i })))} /> Principal</label>
            <input type="number" min={0.1} max={1} step={0.1} className="input w-20 py-1" value={l.weight} aria-label="Peso"
              onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} />
            <button onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label="Remover"><X className="h-4 w-4 text-slate-400" /></button>
          </div>
        ))}
      </div>
      <input className="input mt-3" placeholder="Buscar assunto para adicionar…" value={search} onChange={(e) => setSearch(e.target.value)} />
      {matches.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 text-sm">
          {matches.map((m) => (
            <li key={m.id}><button className="w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => {
              if (!links.some((l) => l.subjectId === m.id)) setLinks([...links, { subjectId: m.id, weight: 1, isPrimary: links.length === 0 }]);
              setSearch('');
            }}>{m.label}</button></li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">Uma questão pode ter mais de um assunto; o peso define como ela é dividida entre eles nas estatísticas. Não existe assunto? Crie em <Link className="text-brand-600" to="/admin/assuntos">Assuntos</Link>.</p>
      {err && <div className="mt-3"><Alert tone="late">{err}</Alert></div>}
    </Modal>
  );
}
