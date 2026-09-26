import { useEffect, useState } from 'react';

/** true quando a media query casa (ex.: '(min-width: 1024px)'). */
export function useMedia(query: string) {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setM(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return m;
}

/** Desktop: o workspace cabe inteiro na tela. */
export const DESKTOP = '(min-width: 1024px) and (min-height: 600px)';
