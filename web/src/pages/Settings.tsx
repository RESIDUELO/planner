import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getTheme, setTheme, type ThemePref } from '../lib/theme';
import { Button, Disclosure, Note, Segmented, Title } from '../components/ui';

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
            <h2 className="text-[21px] font-semibold tracking-[-0.02em]">Criar conta</h2>
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

        <Group label="Estudo" footer={<Link to="/planner" className="text-accent hover:underline">Alterar no planner → Reconfigurar</Link>}>
          {!s?.profile.configured ? <Item label="Planner" value="não configurado" /> : <>
            <Item label="Horas por dia" value={`${s.profile.daily_hours} h`} />
            <Item label="Dias" value={s.weekdays.map((d: number) => WD[d]).join(', ')} />
            <Item label="Questões por dia" value={s.profile.questions_per_day} />
            <Item label="Métodos" value={s.methods.filter((m: any) => m.enabled).map((m: any) => m.name).join(', ')} />
          </>}
        </Group>

        <section className="border-t border-line">
          <Disclosure summary="Como os cálculos funcionam" className="border-b border-line">
            <div className="space-y-4 text-[15px] leading-relaxed text-ink-2">
              <p><span className="text-ink">Ordem dos assuntos.</span> Pela fração das questões que cada assunto representou nas edições cadastradas das provas escolhidas. Com várias provas, a principal e a mais próxima pesam mais.</p>
              <p><span className="text-ink">Prioridade de hoje.</span> {algo.data && Object.entries(algo.data.priority.weights).map(([k, v]) => `${({ historical: 'histórico', proximity: 'proximidade da prova', forgetting: 'esquecimento', performance: 'desempenho' } as any)[k]} ${Math.round((v as number) * 100)}%`).join(', ')}.</p>
              <p><span className="text-ink">Revisões.</span> Modelo próprio inspirado no FSRS. Ficam mais frequentes conforme a prova se aproxima e nunca caem no dia da prova ou depois.</p>
              <p><span className="text-ink">Questões potencialmente dominadas.</span> Questões esperadas de cada assunto × seu domínio estimado. É uma estimativa, não uma promessa.</p>
              <p><span className="text-ink">Base de dados.</span> Somente provas e questões cadastradas pela administração. Nada é buscado na internet.</p>
            </div>
          </Disclosure>
        </section>

        <div className="pt-4 text-center">
          <Button variant="destructive" onClick={async () => { await logout(); nav('/login'); }}>Sair</Button>
        </div>
      </div>
    </div>
  );
}
