import { LogoMark } from '../components/Logo';

/** Mostrado quando config.json ainda não aponta para um projeto Supabase. */
export function SetupNeeded() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 animate-in">
      <LogoMark className="h-10 w-10" />
      <h1 className="mt-8 font-display text-[40px] leading-tight">Falta conectar o Supabase.</h1>
      <ol className="mt-8 list-decimal space-y-3 pl-5 text-[17px] text-ink-2">
        <li>No Supabase, rode <span className="text-ink">supabase/schema.sql</span> no SQL Editor.</li>
        <li>Copie a Project URL e a chave anon public em Project Settings → API.</li>
        <li>Coloque os dois valores em <span className="text-ink">web/public/config.json</span>.</li>
      </ol>
    </div>
  );
}
