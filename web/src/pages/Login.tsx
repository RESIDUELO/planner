import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Note, Segmented } from '../components/ui';
import { LogoMark } from '../components/Logo';

export function LoginPage() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<'form' | 'guest' | null>(null);

  if (user) return <Navigate to={loc.state?.from ?? '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('form');
    setError(null);
    setInfo(null);
    try {
      if (mode === 'login') await api.post('/api/auth/login', { email: form.email, password: form.password });
      else {
        const r = await api.post('/api/auth/register', form);
        if (r.needsConfirmation) {
          setInfo('Conta criada. Confirme pelo link que enviamos ao seu e-mail e depois entre.');
          setMode('login');
          return;
        }
      }
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
    <div className="flex min-h-[var(--app-h,100vh)] flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-[340px] animate-in">
        <div className="flex justify-center"><LogoMark size={56} /></div>
        <h1 className="mt-8 text-center font-display text-[48px] leading-none">Planner</h1>
        <p className="mt-2 text-center text-[11px] tracking-[0.3em] text-ink-2 uppercase">Pablo e Samêla</p>
        <p className="mt-6 text-center text-[16px] text-ink-2">Planeje seus estudos com base no que realmente cai na sua prova.</p>

        <Segmented className="mt-10 flex w-full justify-center" value={mode} onChange={(m) => { setMode(m); setError(null); }}
          options={[{ value: 'login', label: 'Entrar' }, { value: 'register', label: 'Criar conta' }]} />

        <form onSubmit={submit} className="mt-6 space-y-3">
          {mode === 'register' && (
            <input className="field" aria-label="Nome" placeholder="Nome" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
          )}
          <input className="field" aria-label="E-mail" placeholder="E-mail" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
          <input className="field" aria-label="Senha" placeholder={mode === 'register' ? 'Senha (mínimo 8 caracteres)' : 'Senha'} type="password" required minLength={8}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {error && <Note tone="negative">{error}</Note>}
          {info && <Note tone="positive">{info}</Note>}
          <Button type="submit" size="lg" className="mt-2 w-full" loading={busy === 'form'}>{mode === 'login' ? 'Entrar' : 'Criar conta'}</Button>
        </form>

        <div className="mt-8 text-center">
          <Button variant="plain" onClick={guest} loading={busy === 'guest'}>Continuar como visitante</Button>
          <p className="mt-2 text-[13px] text-ink-3">Seu progresso fica neste navegador até você criar uma conta.</p>
        </div>
      </div>
    </div>
  );
}
