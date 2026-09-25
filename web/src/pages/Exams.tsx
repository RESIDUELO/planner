import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, Check, ClipboardList, FileText, Star } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { REG_STATUS, WINDOW_LABEL } from '../lib/format';
import { Alert, Badge, Button, Empty, Modal, PageHeader, Spinner, MiniBars } from '../components/ui';

export function ExamsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exams'], queryFn: () => api.get<any[]>('/api/exams') });
  const [filter, setFilter] = useState<'all' | 'selected' | 'upcoming'>('all');
  const [historyOf, setHistoryOf] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.put(`/api/me/editions/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exams'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (e) => setErr(errorMessage(e)),
  });

  const list = useMemo(() => (q.data ?? []).filter((e) =>
    filter === 'selected' ? e.selected : filter === 'upcoming' ? e.days_left == null || e.days_left >= 0 : true), [q.data, filter]);

  if (q.isLoading) return <Spinner />;
  const selected = (q.data ?? []).filter((e) => e.selected);
  return (
    <>
      <PageHeader title="Provas" subtitle="Escolha entre as provas com análise de questões cadastrada. A data, a inscrição e o valor você mesmo informa."
        action={selected.length > 0 && <Link to="/planner"><Button>Montar planner com {selected.length} {selected.length === 1 ? 'prova' : 'provas'}</Button></Link>} />
      {err && <div className="mb-4"><Alert tone="late">{err}</Alert></div>}
      <div className="mb-4 flex gap-2 text-sm">
        {([['all', 'Todas'], ['upcoming', 'Próximas'], ['selected', 'Selecionadas']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 font-medium ${filter === k ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{l}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={<ClipboardList className="h-10 w-10" />} title="Nenhuma prova disponível">
          {filter === 'all' ? 'Ainda não há provas com análise de questões cadastrada.' : 'Nenhuma prova neste filtro.'}
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => {
            const w = WINDOW_LABEL[e.registration_window];
            return (
              <article key={e.edition_id} data-testid={`exam-${e.institution}-${e.year}`}
                className={`flex flex-col rounded-xl border bg-white p-5 shadow-sm ${e.selected ? 'border-brand-400 ring-2 ring-brand-100' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold tracking-wide text-brand-600 uppercase">{e.institution}{e.board ? ` · ${e.board}` : ''}</div>
                    <h3 className="mt-0.5 font-semibold text-slate-900">{e.exam_name}</h3>
                    <div className="truncate text-xs text-slate-500">{e.institution_name}{e.city ? ` — ${e.city}/${e.state}` : ''}</div>
                  </div>
                  {e.is_primary && <Badge tone="brand"><Star className="h-3 w-3" /> Principal</Badge>}
                </div>

                <ExamDetails exam={e} onSave={(body) => m.mutate({ id: e.edition_id, body })} />

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={w.tone}>{w.label}</Badge>
                  {e.total_questions && <Badge>{e.total_questions} questões</Badge>}
                </div>

                <button onClick={() => setHistoryOf(e)} className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-100">
                  <span className="font-medium text-slate-800">Histórico: </span>{e.history.message}
                  {e.history.editionsAnalyzed > 0 && <span className="text-brand-600"> Ver assuntos →</span>}
                </button>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <select aria-label="Status pessoal" className="input w-auto flex-1 py-1.5" value={e.registration_status ?? ''}
                    onChange={(ev) => m.mutate({ id: e.edition_id, body: { status: ev.target.value || null } })}>
                    <option value="">Status pessoal…</option>
                    {Object.entries(REG_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {e.edital_url && <a href={e.edital_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"><FileText className="h-3.5 w-3.5" /> Edital</a>}
                </div>

                <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
                  <Button size="sm" variant={e.selected ? 'secondary' : 'primary'} className="flex-1"
                    onClick={() => m.mutate({ id: e.edition_id, body: { selected: !e.selected } })}>
                    {e.selected ? 'Remover da seleção' : 'Selecionar'}
                  </Button>
                  {e.selected && !e.is_primary && (
                    <Button size="sm" variant="ghost" onClick={() => m.mutate({ id: e.edition_id, body: { isPrimary: true } })}><Star className="h-3.5 w-3.5" /> Tornar principal</Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {historyOf && <HistoryModal exam={historyOf} onClose={() => setHistoryOf(null)} />}
    </>
  );
}

function HistoryModal({ exam, onClose }: { exam: any; onClose: () => void }) {
  const q = useQuery({ queryKey: ['history', exam.exam_id], queryFn: () => api.get(`/api/exams/${exam.exam_id}/history`) });
  const [showAll, setShowAll] = useState(false);
  const h = q.data;
  return (
    <Modal open onClose={onClose} wide title={`${exam.institution} — ${exam.exam_name}: assuntos mais cobrados`}>
      {q.isLoading ? <Spinner /> : !h ? null : (
        <>
          <Alert tone={h.sufficiency === 'insufficient' || h.sufficiency === 'none' ? 'warn' : 'info'}>
            {h.message} {h.editionsAnalyzed > 0 && <>Edições: {h.years.join(', ')} · {h.totalQuestions} questões.</>}
          </Alert>
          <div className="mt-4 overflow-x-auto">
            <table className="table">
              <thead><tr><th>#</th><th>Assunto</th><th className="text-right">Questões</th><th className="text-right">% da prova</th><th className="text-right">Edições</th><th className="text-right">Média/ano</th><th className="hidden sm:table-cell">Por ano</th></tr></thead>
              <tbody>
                {(showAll ? h.subjects : h.subjects.slice(0, 20)).map((s: any) => (
                  <tr key={s.subjectId}>
                    <td className="tabular text-slate-400">{s.rank}</td>
                    <td><div className="font-medium text-slate-900">{s.name}</div><div className="text-xs text-slate-500">{s.area}</div></td>
                    <td className="tabular text-right">{s.questions}</td>
                    <td className="tabular text-right">{(s.percentage * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</td>
                    <td className="tabular text-right">{s.editionsPresent}/{s.editionsAnalyzed}</td>
                    <td className="tabular text-right">{s.annualAverage.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                    <td className="hidden w-40 sm:table-cell"><MiniBars height={22} data={s.byYear.map((y: any) => ({ label: String(y.year).slice(2), value: y.questions, title: `${y.year}: ${y.questions} questões` }))} max={Math.max(...h.subjects[0].byYear.map((y: any) => y.questions), 1)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {h.subjects.length > 20 && <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar menos' : `Mostrar todos (${h.subjects.length})`}</Button>}
          <p className="mt-3 flex items-center gap-1 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5" /> Números calculados exclusivamente a partir das questões cadastradas no banco.</p>
        </>
      )}
    </Modal>
  );
}

/** Data da prova, inscrição e valor: informados pelo próprio aluno (salvos ao sair do campo). */
function ExamDetails({ exam, onSave }: { exam: any; onSave: (body: any) => void }) {
  const initial = () => ({
    examDate: exam.exam_date ?? '', registrationStart: exam.registration_start ?? '',
    registrationEnd: exam.registration_end ?? '', registrationFee: exam.registration_fee != null ? String(exam.registration_fee) : '',
  });
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(initial()), [exam.exam_date, exam.registration_start, exam.registration_end, exam.registration_fee]);
  const save = (key: keyof typeof v, value: string) => {
    const current = initial()[key];
    if (value === current) return;
    onSave({ [key]: key === 'registrationFee' ? (value === '' ? null : Number(value)) : value || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const field = (key: keyof typeof v, label: string, type: string, extra: any = {}) => (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input type={type} className="input mt-0.5 py-1.5" aria-label={`${label} — ${exam.institution}`} value={v[key]} {...extra}
        onChange={(ev) => setV({ ...v, [key]: ev.target.value })} onBlur={(ev) => save(key, ev.target.value)} />
    </label>
  );
  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-600">
        <span>Seus dados desta prova</span>
        {saved ? <span className="flex items-center gap-1 text-ok-700"><Check className="h-3.5 w-3.5" /> salvo</span>
          : exam.days_left != null && exam.days_left >= 0 ? <span className="text-brand-700">{exam.days_left} dias</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {field('examDate', 'Data da prova', 'date')}
        {field('registrationFee', 'Valor (R$)', 'number', { min: 0, step: '0.01', placeholder: '0,00' })}
        {field('registrationStart', 'Inscrição: início', 'date')}
        {field('registrationEnd', 'Inscrição: fim', 'date')}
      </div>
      {!exam.exam_date && <p className="mt-2 text-xs text-warn-700">Informe a data da prova para o planner calcular o tempo até ela.</p>}
    </div>
  );
}
