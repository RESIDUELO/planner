import { Logo } from '../components/Logo';

/** Mostrado quando config.json ainda não aponta para um projeto Supabase. */
export function SetupNeeded() {
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <Logo />
      <h1 className="mt-8 text-xl font-semibold text-slate-900">Falta conectar o Supabase</h1>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>No Supabase, abra <b>SQL Editor</b>, cole o conteúdo de <code>supabase/schema.sql</code> e clique em <b>Run</b>.</li>
        <li>Em <b>Project Settings → API</b>, copie a <b>Project URL</b> e a chave <b>anon public</b>.</li>
        <li>No GitHub, edite <code>web/public/config.json</code> com esses dois valores e faça o commit. O site é republicado sozinho.</li>
      </ol>
      <p className="mt-6 text-xs text-slate-500">O passo a passo completo está no README do repositório.</p>
    </div>
  );
}
