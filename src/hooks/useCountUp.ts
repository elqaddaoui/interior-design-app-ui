import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

const reduced = () => Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

/** 0 -> 1 (eased) every time `key` changes; instantly 1 when the visitor asked for reduced motion. */
export function useProgress(key: string, ms = 700): number {
  const [s, setS] = useState({ key: '', p: 0 });
  const skip = reduced();
  useEffect(() => {
    if (skip) return;
    let raf = 0;
    const t0 = Date.now();
    const tick = () => {
      const x = Math.min(1, (Date.now() - t0) / ms);
      setS({ key, p: ease(x) });
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, ms, skip]);
  return skip ? 1 : s.key === key ? s.p : 0;
}

/** A number that rolls up to `target` (integers; keeps the final value exact). */
export function useCountUp(target: number, ms = 800): number {
  const p = useProgress(String(target), ms);
  return Math.round(target * p);
}
