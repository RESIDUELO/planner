/** "Personalizar Planner": o que aparece e a paleta. Muda na hora; "Concluído" só fecha. */
import { useState } from 'react';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { getPalette, PALETTES, setPalette, type Palette } from '../lib/theme';
import { setWidget, useWidgets, WIDGETS } from '../lib/widgets';
import { Button, Sheet, Toggle } from './ui';

export function PalettePicker() {
  const [p, set] = useState<Palette>(getPalette());
  return (
    <div role="radiogroup" aria-label="Paleta" className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
      {PALETTES.map((x) => (
        <button key={x.id} role="radio" aria-checked={p === x.id} onClick={() => { set(x.id); setPalette(x.id); }}
          className={clsx('group flex flex-col items-center gap-2 rounded-[14px] border px-2 pt-3 pb-2 transition active:scale-[0.98]',
            p === x.id ? 'border-ink' : 'border-line hover:border-ink-3')}>
          <span className="relative flex h-9 w-9 overflow-hidden rounded-full border border-black/10" aria-hidden>
            <span className="h-full w-1/3" style={{ background: x.swatch[0] }} />
            <span className="h-full w-1/3" style={{ background: x.swatch[1] }} />
            <span className="h-full w-1/3" style={{ background: x.swatch[2] }} />
            {p === x.id && <span className="absolute inset-0 flex items-center justify-center"><Check className="h-4 w-4 text-white mix-blend-difference" strokeWidth={2.5} /></span>}
          </span>
          <span className="text-[12px] text-ink-2 group-aria-checked:text-ink">{x.name}</span>
        </button>
      ))}
    </div>
  );
}

export function CustomizeSheet({ onClose }: { onClose: () => void }) {
  const w = useWidgets();
  return (
    <Sheet open onClose={onClose} title="Personalizar Planner" footer={<Button onClick={onClose}>Concluído</Button>}>
      <h3 className="text-[13px] text-ink-2">Mostrar</h3>
      <ul className="mt-2 divide-y divide-line border-y border-line">
        {WIDGETS.map((x) => (
          <li key={x.key} className="flex items-center justify-between gap-4 py-2.5">
            <span className="min-w-0"><span className="block text-[16px]">{x.label}</span><span className="block text-[12px] text-ink-3">{x.hint}</span></span>
            <Toggle label={`Mostrar ${x.label}`} checked={w[x.key]} onChange={(v) => setWidget(x.key, v)} />
          </li>
        ))}
      </ul>
      <h3 className="mt-8 mb-3 text-[13px] text-ink-2">Design</h3>
      <PalettePicker />
      <p className="mt-3 text-[12px] text-ink-3">Claro, escuro ou automático: Configurações → Aparência.</p>
    </Sheet>
  );
}
