import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Alert, Button, Card, Field, PageHeader } from '../../components/ui';
import { EDITION_FIELDS, EntityForm, toPayload } from './shared';

const FLOW = ['Instituição', 'Banca', 'Nome', 'Edição', 'Data', 'Inscrição', 'Valor', 'Vagas', 'Edital', 'Questões', 'Classificação', 'Estatísticas', 'Revisão', 'Publicação'];

export function AdminNewExam() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const inst = useQuery({ queryKey: ['admin-institutions'], queryFn: () => api.get<any[]>('/api/admin/institutions') });
  const boards = useQuery({ queryKey: ['admin-boards'], queryFn: () => api.get<any[]>('/api/admin/boards') });
  const exams = useQuery({ queryKey: ['admin-exams'], queryFn: () => api.get<any[]>('/api/admin/exams') });
  const [step, setStep] = useState(0);
  const [instId, setInstId] = useState('');
  const [newInst, setNewInst] = useState({ name: '', abbreviation: '', state: '', city: '' });
  const [boardId, setBoardId] = useState('');
  const [newBoard, setNewBoard] = useState({ name: '', abbreviation: '' });
  const [examId, setExamId] = useState('');
  const [newExam, setNewExam] = useState({ name: 'R1 Acesso Direto', total_questions: '', duration_minutes: '' });
  const [edition, setEdition] = useState<any>({ year: new Date().getFullYear() + 1 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const instExams = (exams.data ?? []).filter((e) => e.institution_id === instId);
  const next = async () => {
    setError(null);
    setBusy(true);
    try {
      if (step === 0 && !instId) {
        const r = await api.post('/api/admin/institutions', { ...newInst, state: newInst.state || null });
        setInstId(r.id);
      }
      if (step === 1 && !boardId && newBoard.name) {
        const r = await api.post('/api/admin/boards', newBoard);
        setBoardId(r.id);
      }
      if (step === 2 && !examId) {
        const r = await api.post('/api/admin/exams', {
          institution_id: instId, board_id: boardId || null, name: newExam.name,
          total_questions: newExam.total_questions ? Number(newExam.total_questions) : null,
          duration_minutes: newExam.duration_minutes ? Number(newExam.duration_minutes) : null,
        });
        setExamId(r.id);
      }
      if (step === 3) {
        const r = await api.post('/api/admin/editions', { ...toPayload(EDITION_FIELDS(), edition), exam_id: examId });
        await qc.invalidateQueries();
        nav(`/admin/edicoes/${r.id}`);
        return;
      }
      await qc.invalidateQueries();
      setStep(step + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Nova prova" subtitle="A edição é salva como rascunho: só aparece para os usuários depois de revisada e publicada." />
      <ol className="mb-6 flex flex-wrap gap-1.5 text-xs">
        {FLOW.map((f, i) => {
          const s = i <= 2 ? i : i <= 8 ? 3 : 4;
          return <li key={f} className={`rounded-full px-2.5 py-1 font-medium ${s < step ? 'bg-ok-50 text-ok-700' : s === step ? 'bg-brand-600 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200'}`}>{i + 1}. {f}</li>;
        })}
      </ol>
      <Card>
        {step === 0 && (
          <div className="space-y-4">
            <Field label="Instituição existente">
              <select className="input" value={instId} onChange={(e) => setInstId(e.target.value)} aria-label="Instituição existente">
                <option value="">— Cadastrar nova —</option>
                {(inst.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.abbreviation} — {i.name}</option>)}
              </select>
            </Field>
            {!instId && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome *"><input className="input" aria-label="Nome da instituição" value={newInst.name} onChange={(e) => setNewInst({ ...newInst, name: e.target.value })} /></Field>
                <Field label="Sigla *"><input className="input" aria-label="Sigla da instituição" value={newInst.abbreviation} onChange={(e) => setNewInst({ ...newInst, abbreviation: e.target.value })} /></Field>
                <Field label="UF"><input className="input" maxLength={2} value={newInst.state} onChange={(e) => setNewInst({ ...newInst, state: e.target.value })} /></Field>
                <Field label="Cidade"><input className="input" value={newInst.city} onChange={(e) => setNewInst({ ...newInst, city: e.target.value })} /></Field>
              </div>
            )}
          </div>
        )}
        {step === 1 && (
          <div className="space-y-4">
            <Field label="Banca examinadora" hint="Opcional.">
              <select className="input" value={boardId} onChange={(e) => setBoardId(e.target.value)} aria-label="Banca">
                <option value="">— Nenhuma / cadastrar nova —</option>
                {(boards.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.abbreviation} — {b.name}</option>)}
              </select>
            </Field>
            {!boardId && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome da nova banca"><input className="input" value={newBoard.name} onChange={(e) => setNewBoard({ ...newBoard, name: e.target.value })} /></Field>
                <Field label="Sigla"><input className="input" value={newBoard.abbreviation} onChange={(e) => setNewBoard({ ...newBoard, abbreviation: e.target.value })} /></Field>
              </div>
            )}
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            {instExams.length > 0 && (
              <Field label="Prova existente desta instituição">
                <select className="input" value={examId} onChange={(e) => setExamId(e.target.value)} aria-label="Prova existente">
                  <option value="">— Cadastrar nova —</option>
                  {instExams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </Field>
            )}
            {!examId && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Nome da prova *"><input className="input" aria-label="Nome da prova" value={newExam.name} onChange={(e) => setNewExam({ ...newExam, name: e.target.value })} /></Field>
                <Field label="Nº de questões"><input type="number" className="input" aria-label="Número de questões" value={newExam.total_questions} onChange={(e) => setNewExam({ ...newExam, total_questions: e.target.value })} /></Field>
                <Field label="Duração (min)"><input type="number" className="input" value={newExam.duration_minutes} onChange={(e) => setNewExam({ ...newExam, duration_minutes: e.target.value })} /></Field>
              </div>
            )}
          </div>
        )}
        {step === 3 && <EntityForm fields={EDITION_FIELDS()} values={edition} onChange={setEdition} />}
        {error && <div className="mt-4"><Alert tone="late">{error}</Alert></div>}
        <div className="mt-6 flex justify-between border-t border-slate-100 pt-4">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Voltar</Button>
          <Button loading={busy} onClick={next}>{step === 3 ? 'Salvar edição como rascunho' : 'Continuar'}</Button>
        </div>
      </Card>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500"><CheckCircle2 className="h-3.5 w-3.5" /> Depois de salvar, você segue para a edição: questões (manual ou <Link className="text-brand-600" to="/admin/importacao">importação</Link>), classificação, estatísticas, revisão e publicação.</p>
    </>
  );
}
