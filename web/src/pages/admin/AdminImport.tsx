import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { dateTimeBR } from '../../lib/format';
import { Alert, Badge, Button, Card, Field, PageHeader, Stat } from '../../components/ui';
import { useSubjectOptions } from './AdminEditions';

type Decision = { action: 'map'; id: string } | { action: 'create' } | { action: 'ignore' } | undefined;
const KIND: Record<string, string> = { area: 'Grande área', specialty: 'Especialidade', subject: 'Assunto', subsubject: 'Subassunto' };

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function AdminImport() {
  const qc = useQueryClient();
  const exams = useQuery({ queryKey: ['admin-exams'], queryFn: () => api.get<any[]>('/api/admin/exams') });
  const areas = useQuery({ queryKey: ['admin-areas'], queryFn: () => api.get<any[]>('/api/admin/areas') });
  const subjects = useSubjectOptions();
  const batches = useQuery({ queryKey: ['admin-batches'], queryFn: () => api.get<any[]>('/api/admin/import/batches') });
  const [examId, setExamId] = useState('');
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<any | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [reviewed, setReviewed] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runPreview = useMutation({
    mutationFn: () => api.post('/api/admin/import/preview', { examId, filename: file!.name, content: file!.content }),
    onSuccess: (p) => { setPreview(p); setDecisions({}); setReviewed(false); setResult(null); if (p.source && !source) setSource(p.source); },
    onError: (e) => setError(errorMessage(e)),
  });
  const commit = useMutation({
    mutationFn: () => api.post('/api/admin/import/commit', { examId, filename: file!.name, content: file!.content, resolutions: decisions, source: source || null }),
    onSuccess: (r) => { setResult(r); setPreview(null); qc.invalidateQueries(); },
    onError: (e) => setError(errorMessage(e)),
  });

  const pending = preview?.unknown.filter((u: any) => !decisions[u.key]).length ?? 0;
  const optionsFor = (u: any) => {
    if (u.kind === 'area' || u.kind === 'specialty') return (areas.data ?? []).filter((a) => (u.kind === 'area' ? !a.parent_id : !!a.parent_id)).map((a) => ({ id: a.id, label: a.name }));
    return subjects.data ?? [];
  };
  const setAll = (action: 'create' | 'ignore') => setDecisions(Object.fromEntries(preview.unknown.map((u: any) => [u.key, decisions[u.key] ?? { action }])));
  const byKind = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const u of preview?.unknown ?? []) (m[u.kind] ??= []).push(u);
    return m;
  }, [preview]);

  return (
    <>
      <PageHeader title="Importação de questões" subtitle="CSV, XLSX ou JSON. Nada é gravado antes da sua confirmação, e nenhum assunto é criado automaticamente." />
      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Prova de destino *">
            <select className="input" value={examId} onChange={(e) => { setExamId(e.target.value); setPreview(null); }} aria-label="Prova de destino">
              <option value="">Selecione…</option>
              {(exams.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.institution} — {e.name}</option>)}
            </select>
          </Field>
          <Field label="Arquivo *" hint="Colunas: year, question_number, area, specialty, subject, subsubject, summary/statement, alternative_a…e, correct_answer, annulled, difficulty…">
            <input type="file" accept=".csv,.xlsx,.json" className="input py-1.5" aria-label="Arquivo"
              onChange={async (e) => { const f = e.target.files?.[0]; setPreview(null); setFile(f ? { name: f.name, content: await readBase64(f) } : null); }} />
          </Field>
          <Field label="Fonte (registrada nas questões e edições)"><input className="input" value={source} onChange={(e) => setSource(e.target.value)} /></Field>
        </div>
        {!exams.data?.length && <p className="mt-3 text-sm text-slate-500">Cadastre a prova antes em <Link className="text-brand-600" to="/admin/nova-prova">Nova prova</Link>.</p>}
        <div className="mt-4 flex justify-end">
          <Button disabled={!examId || !file} loading={runPreview.isPending} onClick={() => { setError(null); runPreview.mutate(); }}><FileUp className="h-4 w-4" /> Gerar prévia</Button>
        </div>
      </Card>

      {error && <div className="mt-4"><Alert tone="late">{error}</Alert></div>}
      {result && (
        <div className="mt-4"><Alert tone="ok" title="Importação concluída">
          {result.inserted} questões inseridas ({result.classified} classificadas, {result.unclassified} sem classificação), {result.skipped} ignoradas.
          {result.editionsCreated.length > 0 && <> Edições criadas como <b>rascunho</b>: {result.editionsCreated.join(', ')}. <Link className="underline" to="/admin/edicoes">Revise e publique</Link>.</>}
        </Alert></div>
      )}

      {preview && (
        <div className="mt-4 space-y-4">
          <div className="text-lg font-semibold text-slate-900">{preview.total} questões encontradas.</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Válidas" value={preview.valid} tone="ok" />
            <Stat label="Inválidas" value={preview.invalid.length} tone={preview.invalid.length ? 'late' : undefined} />
            <Stat label="Duplicadas" value={preview.duplicates.length} tone={preview.duplicates.length ? 'warn' : undefined} />
            <Stat label="Anuladas" value={preview.annulled} />
            <Stat label="Não encontrados" value={preview.unknown.length} hint="áreas/assuntos" tone={preview.unknown.length ? 'warn' : undefined} />
          </div>
          {preview.examHint && <Alert tone="info">O arquivo indica: {preview.examHint.institution} — {preview.examHint.exam}. Destino escolhido: {preview.exam.abbreviation} — {preview.exam.name}.</Alert>}

          <Card title="Edições">
            <div className="flex flex-wrap gap-2">
              {preview.years.map((y: any) => (
                <Badge key={y.year} tone={y.edition ? 'info' : 'warn'}>{y.year}: {y.questions} questões · {y.edition ? `edição existente (${y.edition})` : 'será criada como rascunho'}</Badge>
              ))}
            </div>
          </Card>

          {(preview.invalid.length > 0 || preview.duplicates.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              {preview.invalid.length > 0 && (
                <Card title={`Inválidas (${preview.invalid.length}) — não serão importadas`}>
                  <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">{preview.invalid.map((r: any) => <li key={r.line}>Linha {r.line}{r.year ? ` (${r.year} Q${r.question_number ?? '?'})` : ''}: {r.errors.join('; ')}</li>)}</ul>
                </Card>
              )}
              {preview.duplicates.length > 0 && (
                <Card title={`Duplicadas (${preview.duplicates.length}) — não serão importadas`}>
                  <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">{preview.duplicates.map((r: any) => <li key={r.line}>Linha {r.line}: {r.year} Q{r.question_number} — {r.duplicateOf === 'database' ? 'já cadastrada' : 'repetida no arquivo'}</li>)}</ul>
                </Card>
              )}
            </div>
          )}

          {preview.unknown.length > 0 && (
            <Card title="Não encontrados no cadastro" subtitle="Para cada item, associe a um existente, crie um novo ou ignore (a questão entra sem essa classificação). Associações viram nomes alternativos reconhecidos nas próximas importações."
              action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setAll('create')}>Criar restantes</Button><Button size="sm" variant="ghost" onClick={() => setAll('ignore')}>Ignorar restantes</Button></div>}>
              {Object.entries(byKind).map(([kind, items]) => (
                <div key={kind} className="mb-4">
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{KIND[kind]} ({items.length})</h3>
                  <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="table">
                      <tbody>
                        {items.map((u: any) => {
                          const d = decisions[u.key];
                          return (
                            <tr key={u.key}>
                              <td><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{u.parentName ? `em ${u.parentName} · ` : ''}{u.rows} questão(ões)</div></td>
                              <td className="w-72">
                                <select className="input py-1 text-xs" aria-label={`Decisão para ${u.name}`}
                                  value={d ? (d.action === 'map' ? `map:${d.id}` : d.action) : ''}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setDecisions({ ...decisions, [u.key]: !v ? undefined : v.startsWith('map:') ? { action: 'map', id: v.slice(4) } : { action: v as 'create' | 'ignore' } });
                                  }}>
                                  <option value="">Decidir…</option>
                                  <option value="create">Criar novo</option>
                                  <option value="ignore">Ignorar</option>
                                  {u.suggestions.length > 0 && <optgroup label="Sugestões">{u.suggestions.map((s: any) => <option key={s.id} value={`map:${s.id}`}>Associar: {s.path}</option>)}</optgroup>}
                                  <optgroup label="Associar a existente">{optionsFor(u).slice(0, 400).map((s: any) => <option key={s.id} value={`map:${s.id}`}>{s.label}</option>)}</optgroup>
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {preview.sample.length > 0 && (
            <Card title="Amostra das questões válidas">
              <div className="overflow-x-auto">
                <table className="table text-xs">
                  <thead><tr><th>Ano</th><th>Nº</th><th>Área</th><th>Assunto</th><th>Subassunto</th><th>Resumo</th><th>Gab.</th></tr></thead>
                  <tbody>{preview.sample.map((r: any) => (
                    <tr key={r.line}><td>{r.year}</td><td>{r.question_number}</td><td>{r.area}</td><td>{r.specialty ? `${r.specialty} › ` : ''}{r.subject}</td><td>{r.subsubject}</td><td className="max-w-xs truncate">{r.statement ?? r.summary}</td><td>{r.annulled ? 'Anulada' : r.correct_answer}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> Revisei a prévia e confirmo a inserção de {preview.valid} questões em {preview.exam.abbreviation} — {preview.exam.name}.</label>
            {pending > 0 && <p className="mt-2 text-sm text-warn-700">Faltam decisões para {pending} item(ns) não encontrados.</p>}
            <div className="mt-4 flex justify-end">
              <Button variant="success" disabled={!reviewed || pending > 0 || preview.valid === 0} loading={commit.isPending} onClick={() => { setError(null); commit.mutate(); }}>Confirmar importação</Button>
            </div>
          </Card>
        </div>
      )}

      <Card className="mt-6" title="Importações anteriores">
        <table className="table">
          <thead><tr><th>Quando</th><th>Prova</th><th>Arquivo</th><th className="text-right">Inseridas</th><th className="text-right">Ignoradas</th><th>Por</th></tr></thead>
          <tbody>
            {(batches.data ?? []).map((b) => <tr key={b.id}><td>{dateTimeBR(b.created_at)}</td><td>{b.institution} — {b.exam_name}</td><td className="text-xs">{b.filename}</td><td className="tabular text-right">{b.inserted_rows}</td><td className="tabular text-right">{b.skipped_rows}</td><td>{b.created_by_name}</td></tr>)}
            {batches.data?.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Nenhuma importação.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
