// Раскладка колонок: координатор перетаскивает блоки с крупными числами, порядок запоминается в браузере.
import { type HTMLAttributes, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { Flip, reducedMotion } from './motion';
import type { GroupKey } from './model';

export type ColKey = GroupKey | 'side' | 'resolved';

export const DEFAULT_ORDER: ColKey[] = ['critical', 'coord', 'high', 'research', 'side'];

// Ширина колонки идёт вместе с ней, куда бы её ни перетащили.
const WIDTH: Record<ColKey, string> = {
  critical: 'minmax(0, 1.12fr)',
  coord: 'minmax(0, 1fr)',
  high: 'minmax(0, 1fr)',
  research: 'minmax(0, 1fr)',
  side: 'minmax(var(--side-min), 0.85fr)',
  resolved: 'minmax(18rem, 1fr)',
};

const STORAGE_KEY = 'layout';

function load(): ColKey[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(v) && v.length === DEFAULT_ORDER.length && DEFAULT_ORDER.every((k) => v.includes(k))) return v as ColKey[];
  } catch { /* приватный режим или мусор в хранилище */ }
  return DEFAULT_ORDER;
}

function save(order: ColKey[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)); } catch { /* приватный режим */ }
}

export interface ColumnDnd {
  /** Ручка: блок с крупным числом. */
  handle: HTMLAttributes<HTMLElement> & { draggable: true };
  /** Вся колонка принимает сброс. */
  zone: HTMLAttributes<HTMLElement>;
  className: string;
}

export function useColumnLayout(board: RefObject<HTMLElement | null>) {
  const [order, setOrder] = useState<ColKey[]>(load);
  const [dragging, setDragging] = useState<ColKey | null>(null);
  const [over, setOver] = useState<ColKey | null>(null);
  const flip = useRef<Flip.FlipState | null>(null);

  // Колонки плавно переезжают на новые места.
  useLayoutEffect(() => {
    if (flip.current && !reducedMotion()) Flip.from(flip.current, { duration: 0.45, ease: 'power3.out' });
    flip.current = null;
  }, [order]);

  const apply = (next: ColKey[]) => {
    if (board.current) flip.current = Flip.getState(board.current.querySelectorAll(':scope > [data-col]'));
    setOrder(next);
    save(next);
  };

  const move = (from: ColKey, to: ColKey) => {
    if (from === to) return;
    const fi = order.indexOf(from);
    const ti = order.indexOf(to);
    const next = order.filter((k) => k !== from);
    next.splice(next.indexOf(to) + (fi < ti ? 1 : 0), 0, from);
    apply(next);
  };

  const dnd = (key: ColKey): ColumnDnd => ({
    handle: {
      draggable: true,
      title: 'Перетащите, чтобы поменять колонки местами',
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
        setDragging(key);
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
    },
    zone: {
      onDragOver: (e) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (over !== key) setOver(key);
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
      },
      onDrop: (e) => {
        e.preventDefault();
        if (dragging) move(dragging, key);
        setDragging(null);
        setOver(null);
      },
    },
    className: dragging === key ? 'is-dragging' : over === key && dragging ? 'is-drop' : '',
  });

  return {
    order,
    columns: order.map((k) => WIDTH[k]).join(' '),
    dnd,
    add: (key: ColKey) => { if (!order.includes(key)) apply([...order, key]); },
    remove: (key: ColKey) => { if (order.includes(key)) apply(order.filter((item) => item !== key)); },
    reset: () => apply(DEFAULT_ORDER),
    isDefault: order.join() === DEFAULT_ORDER.join(),
  };
}
