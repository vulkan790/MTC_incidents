import { useLayoutEffect, useRef } from 'react';
import { gsap, reducedMotion } from '../lib/motion';
import { openItsm } from '../lib/model';

export interface Toast {
  id: string;
  kind: 'resolved' | 'coord' | 'handoff' | 'mail' | 'info';
  title: string;
  text: string;
  incidentId: string | null;
  ttl: number;
}

function ToastItem({ t, onClose }: { t: Toast; onClose: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    if (!reducedMotion()) gsap.fromTo(ref.current, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: 'power3.out' });
    const bar = ref.current.querySelector('.toast-ttl');
    const tw = gsap.fromTo(bar, { scaleX: 1 }, { scaleX: 0, duration: t.ttl / 1000, ease: 'none', onComplete: () => onClose(t.id) });
    return () => { tw.kill(); };
  }, [t.id, t.ttl, onClose]);
  return (
    <div className={`toast toast-${t.kind}`} ref={ref} role="status">
      <button
        className="toast-body"
        onClick={() => t.incidentId && openItsm(t.incidentId)}
        disabled={!t.incidentId}
      >
        <b>{t.title}</b>
        <span>{t.text}</span>
      </button>
      <button className="toast-close" aria-label="Скрыть" onClick={() => onClose(t.id)}>×</button>
      <span className="toast-ttl" />
    </div>
  );
}

export function Toasts({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <ToastItem key={t.id} t={t} onClose={onClose} />)}
    </div>
  );
}
