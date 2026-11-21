import { useEffect, useState } from 'react';

// Должно совпадать с media query в mobile.css.
export const MOBILE_QUERY = '(max-width: 900px), (max-width: 1000px) and (pointer: coarse)';
export function useMobileLayout() {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const sync = () => setMobile(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return mobile;
}
// Вертикальный жест не переключает категорию; короткие движения также игнорируются.
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  return Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.45 ? (dx < 0 ? 1 : -1) : 0;
}
