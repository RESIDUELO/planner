import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getTheme, setTheme, type ThemePref } from '../lib/theme';
import { Button, Disclosure, Note, Segmented, Sheet, Title } from '../components/ui';
import { REVIEW_OPTIONS } from './Planner';

const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function Group({ label, children, footer }: { label?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="animate-in">
      {label && <h2 className="mb-2 text-[13px] text-ink-2">{label}</h2>}
      <div className="divide-y divide-line border-y border-line">{children}</div>
      {footer && <div className="mt-2 text-[13px] text-ink-3">{footer}</div>}
    </section>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-6 py-3.5 text-[17px]"><span>{label}</span><span className="truncate text-right text-ink-2">{value}</span></div>;
}

export function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const nav = useNavigate();
  const settings = useQuery({ queryKey: ['study-settings'], queryFn: () => api.get('/api/me/study-settings') });
  const algo = useQuery({ queryKey: ['algorithm'], queryFn: () => api.get('/api/algorithm') });
  const [name, setName] = useState(user?.name ?? '');
  const [upg, setUpg] = useState({ name: '', email: '', password: '' });
  const [theme, setThemeState] = useState<ThemePref>(getTheme());
  const [msg, setMsg] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(null);

  const qc = useQueryClient();
  const saveReviews = async (n: number) => {
    const s = settings.data;
    try {
      await api.put('/api/me/study-settings', {
        profile: { ...s.profile, reviews_per_day: n, preferred_start_time: s.profile.preferred_start_time?.slice(0, 5) || null, preferred_end_time: s.profile.preferred_end_time?.slice(0, 5) || null },
        methods: s.methods.map((m: any) => ({ id: m.id, enabled: m.enabled, minutes: m.estimated_minutes })),
      });
      for (const k of ['study-settings', 'today', 'week', 'calendar', 'planner']) qc.invalidateQueries({ queryKey: [k] });
      setMsg({ tone: 'positive', text: `Até ${n} ${n === 1 ? 'revisão' : 'revisões'} por dia.` });
    } catch (err) { setMsg({ tone: 'negative', text: errorMessage(err) }); }
  };

  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const resetProfile = async () => {
    setResetting(true);
    setResetError(null);
    try {
      await api.post('/api/me/reset');
      try { localStorage.removeItem('rp-pomodoro'); } catch { /* sem armazenamento */ }
      qc.clear();
      window.location.replace(`${import.meta.env.BASE_URL}planner`);
    } catch (err) {
      setResetError(errorMessage(err));
      setResetting(false);
    }
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.patch('/api/auth/profile', { name }); await refresh(); setMsg({ tone: 'positive', text: 'Nome atualizado.' }); } catch (err) { setMsg({ tone: 'negative', text: errorMessage(err) }); }
  };
  const upgrade = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post('/api/auth/upgrade', upg);
      await refresh();
      setMsg({ tone: 'positive', text: r.needsConfirmation ? 'Quase lá: confirme o e-mail que enviamos. Seu progresso já está mantido.' : 'Conta criada. Seu progresso foi mantido.' });
    } catch (err) { setMsg({ tone: 'negative', text: errorMessage(err) }); }
  };
  const s = settings.data;

  return (
    <div className="mx-auto max-w-xl">
      <Title>Configurações</Title>
      <div className="space-y-12">
        {user?.isGuest ? (
          <section className="animate-in">
            <h2 className="font-display text-[30px]">Criar conta</h2>
            <p className="mt-1 text-[15px] text-ink-2">Guarde seu progresso e acesse de qualquer dispositivo.</p>
            <form onSubmit={upgrade} className="mt-5 space-y-3">
              <input className="field" aria-label="Nome" placeholder="Nome" required value={upg.name} onChange={(e) => setUpg({ ...upg, name: e.target.value })} />
              <input className="field" aria-label="E-mail" placeholder="E-mail" type="email" required value={upg.email} onChange={(e) => setUpg({ ...upg, email: e.target.value })} />
              <input className="field" aria-label="Senha" placeholder="Senha (mínimo 8 caracteres)" type="password" minLength={8} required value={upg.password} onChange={(e) => setUpg({ ...upg, password: e.target.value })} />
              <Button type="submit" className="mt-2">Criar conta mantendo meu progresso</Button>
            </form>
          </section>
        ) : (
          <Group label="Conta">
            <form onSubmit={saveName} className="flex items-center justify-between gap-6 py-2">
              <label htmlFor="rp-name" className="text-[17px]">Nome</label>
              <input id="rp-name" className="min-w-0 flex-1 bg-transparent py-1.5 text-right text-[17px] text-ink-2 outline-none focus:text-ink"
                value={name} onChange={(e) => setName(e.target.value)} onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
            </form>
            <Item label="E-mail" value={user?.email} />
          </Group>
        )}
        {msg && <Note tone={msg.tone} className="-mt-8">{msg.text}</Note>}

        <Group label="Aparência">
          <div className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-[17px]">Tema</span>
            <Segmented value={theme} onChange={(v) => { setThemeState(v); setTheme(v); }}
              options={[{ value: 'system', label: 'Automático' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }]} />
          </div>
        </Group>

        <Group label="Estudo" footer={<Link to="/planner" className="text-ink underline underline-offset-4">Alterar no planner → Reconfigurar</Link>}>
          {!s?.profile.configured ? <Item label="Planner" value="não configurado" /> : <>
            <Item label="Horas por dia" value={`${s.profile.daily_hours} h`} />
            <Item label="Dias" value={s.weekdays.map((d: number) => WD[d]).join(', ')} />
            <Item label="Questões por dia" value={s.profile.questions_per_day} />
            <label className="flex items-center justify-between gap-6 py-3 text-[17px]">
              <span>Revisões por dia</span>
              <select aria-label="Revisões por dia" className="bg-transparent text-right text-[17px] text-ink-2 outline-none" value={s.profile.reviews_per_day ?? 2}
                onChange={(e) => saveReviews(Number(e.target.value))}>
                {REVIEW_OPTIONS.map((n) => <option key={n} value={n}>até {n}</option>)}
              </select>
            </label>
            <Item label="Como estudo" value={s.methods.filter((m: any) => m.enabled).map((m: any) => m.name).join(', ')} />
          </>}
        </Group>

        <section className="border-t border-line">
          <Disclosure summary="Como os cálculos funcionam" className="border-b border-line">
            <div className="space-y-4 text-[15px] leading-relaxed text-ink-2">
              <p><span className="text-ink">Ordem dos assuntos.</span> Primeiro a regularidade: os assuntos que caíram em todas as provas desde que apareceram (sempre olhando pelo menos as 3 últimas); depois a quantidade de questões. Com várias provas, a principal e a mais próxima pesam mais.</p>
              <p><span className="text-ink">Prioridade de hoje.</span> {algo.data && Object.entries(algo.data.priority.weights).map(([k, v]) => `${({ historical: 'histórico', proximity: 'proximidade da prova', forgetting: 'esquecimento', performance: 'desempenho' } as any)[k]} ${Math.round((v as number) * 100)}%`).join(', ')}.</p>
              <p><span className="text-ink">Revisões.</span> Modelo próprio inspirado no FSRS. Ficam mais frequentes conforme a prova se aproxima e nunca caem no dia da prova ou depois.</p>
              <p><span className="text-ink">Questões potencialmente dominadas.</span> Questões esperadas de cada assunto × seu domínio estimado. É uma estimativa, não uma promessa.</p>
              <p><span className="text-ink">Base de dados.</span> Somente provas e questões cadastradas pela administração. Nada é buscado na internet.</p>
            </div>
          </Disclosure>
        </section>

        <section className="animate-in">
          <h2 className="mb-2 text-[13px] text-ink-2">Recomeçar</h2>
          <div className="border-y border-line py-4">
            <p className="text-[15px] text-ink-2">Apaga provas escolhidas, planner, checklist, questões, revisões e observações, como se a conta fosse nova. Seu nome e e-mail continuam.</p>
            <Button variant="destructive" className="mt-3" onClick={() => setResetOpen(true)}>Zerar meu perfil</Button>
          </div>
        </section>

        <div className="pt-4 text-center">
          <Button variant="destructive" onClick={async () => { await logout(); nav('/login'); }}>Sair</Button>
        </div>
        {resetOpen && (
          <Sheet open onClose={() => !resetting && setResetOpen(false)} title="Zerar meu perfil?">
            <p className="text-[16px] text-ink-2">Isso apaga <span className="text-ink">tudo</span> o que você fez aqui e não pode ser desfeito:</p>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-[15px] text-ink-2">
              <li>provas escolhidas, datas, inscrição e valor</li>
              <li>planner, assuntos concluídos e atividades escolhidas</li>
              <li>questões registradas e desempenho</li>
              <li>revisões e observações da semana</li>
              <li>como você estuda e demais configurações de estudo</li>
            </ul>
            <p className="mt-4 text-[15px] text-ink-2">Sua conta (nome e e-mail) continua.</p>
            {resetError && <Note tone="negative" className="mt-4">{resetError}</Note>}
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button disabled={resetting} onClick={resetProfile}
                className="rounded-full bg-negative px-5 py-2 text-[15px] text-white transition hover:opacity-90 disabled:opacity-50">
                {resetting ? 'Apagando…' : 'Zerar tudo'}
              </button>
              <Button variant="plain" disabled={resetting} onClick={() => setResetOpen(false)}>Cancelar</Button>
            </div>
          </Sheet>
        )}
      </div>
    </div>
  );
}
