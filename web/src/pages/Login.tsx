import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BookOpenCheck, CalendarCheck, LineChart } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Field } from '../components/ui';
import { Logo } from '../components/Logo';

export function LoginPage() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'form' | 'guest' | null>(null);

  if (user) return <Navigate to={loc.state?.from ?? '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('form');
    setError(null);
    try {
      if (mode === 'login') await api.post('/api/auth/login', { email: form.email, password: form.password });
      else await api.post('/api/auth/register', form);
      await refresh();
      nav(loc.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const guest = async () => {
    setBusy('guest');
    try {
      await api.post('/api/auth/guest');
      await refresh();
      nav('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-700 p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl" />
        <Logo light />
        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">Planeje seus estudos com base no que realmente cai na sua prova.</h2>
          <ul className="mt-8 space-y-4 text-sm text-brand-100">
            <li className="flex gap-3"><LineChart className="h-5 w-5 shrink-0 text-emerald-300" />Assuntos ordenados pela frequência histórica das provas cadastradas — com a explicação de cada posição.</li>
            <li className="flex gap-3"><BookOpenCheck className="h-5 w-5 shrink-0 text-emerald-300" />Planner que respeita suas horas, seus dias e seus métodos de estudo.</li>
            <li className="flex gap-3"><CalendarCheck className="h-5 w-5 shrink-0 text-emerald-300" />Revisões adaptativas que se intensificam conforme a prova se aproxima.</li>
          </ul>
        </div>
        <p className="relative text-xs text-brand-200">Base de provas curada exclusivamente pela administração da plataforma.</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Logo className="mb-8 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Residência Planner</h1>
          <p className="mt-1 text-sm text-slate-500">Planeje seus estudos com base no que realmente cai na sua prova.</p>

          <div className="mt-8 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm font-medium">
            <button className={`rounded-md py-1.5 ${mode === 'login' ? 'bg-white shadow-sm' : 'text-slate-500'}`} onClick={() => setMode('login')}>Entrar</button>
            <button className={`rounded-md py-1.5 ${mode === 'register' ? 'bg-white shadow-sm' : 'text-slate-500'}`} onClick={() => setMode('register')}>Criar conta</button>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === 'register' && (
              <Field label="Nome"><input className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></Field>
            )}
            <Field label="E-mail"><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></Field>
            <Field label="Senha" hint={mode === 'register' ? 'Mínimo de 8 caracteres.' : undefined}>
              <input className="input" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </Field>
            {error && <Alert tone="late">{error}</Alert>}
            <Button type="submit" className="w-full" loading={busy === 'form'}>{mode === 'login' ? 'Entrar' : 'Criar conta'}</Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-slate-400"><div className="h-px flex-1 bg-slate-200" />ou<div className="h-px flex-1 bg-slate-200" /></div>
          <Button variant="secondary" className="w-full" onClick={guest} loading={busy === 'guest'}>Continuar como visitante</Button>
          <p className="mt-3 text-center text-xs text-slate-500">No modo visitante, seu progresso fica vinculado a este navegador.</p>
        </div>
      </div>
    </div>
  );
}
