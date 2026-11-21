import { useLayoutEffect, useRef } from 'react';
import { gsap, Flip, reducedMotion } from '../lib/motion';
import type { GroupKey } from '../lib/model';
import type { ColumnDnd } from '../lib/layout';
import { IncidentCard, type CardProps } from './IncidentCard';
import { Icon } from './Icon';

const EMPTY: Record<GroupKey, string> = {
  critical: 'Активных критических инцидентов нет',
  coord: 'На координаторах ничего не висит',
  high: 'Активных инцидентов с высоким приоритетом нет',
  research: 'Разборов причин сейчас не идёт',
};

export interface LaneKpi {
  /** Короткая строка под числом: что важно прямо сейчас. */
  sub: string;
  /** Требует действия координатора: блок выделяется сильнее. */
  alert?: boolean;
  /** Подсветить строку под числом жёлтым: есть угроза сроку. */
  warn?: boolean;
}

interface Props {
  group: { key: GroupKey; title: string; hint: string };
  items: Omit<CardProps, 'lane' | 'now' | 'operator' | 'teams'>[];
  activeCount: number;
  kpi: LaneKpi;
  now: number;
  operator: string;
  teams: string[];
  note?: string;
  /** Перетаскивание колонки и её текущее место на доске. */
  dnd?: ColumnDnd;
  position?: number;
}

export function Lane({ group, items, activeCount, kpi, now, operator, teams, note, dnd, position }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const prevCount = useRef(activeCount);
  const order = items.map((x) => x.inc.id).join('|');

  // Карточки плавно переезжают на новые места, новые — въезжают.
  useLayoutEffect(() => {
    if (!list.current) return;
    const els = list.current.querySelectorAll<HTMLElement>(':scope > [data-flip-id]');
    if (flipState.current && !reducedMotion()) {
      Flip.from(flipState.current, {
        targets: els,
        duration: 0.6,
        ease: 'power3.out',
        onEnter: (entering) =>
          gsap.fromTo(entering, { opacity: 0, x: -28, scale: 0.97 }, { opacity: 1, x: 0, scale: 1, duration: 0.6, ease: 'power3.out' }),
      });
    }
    flipState.current = Flip.getState(els);
  }, [order]);

  // Колонку перетащили на другое место: запоминаем новые позиции карточек, чтобы они не прилетали со старого.
  useLayoutEffect(() => {
    if (list.current) flipState.current = Flip.getState(list.current.querySelectorAll(':scope > [data-flip-id]'));
  }, [position]);

  useLayoutEffect(() => {
    if (prevCount.current !== activeCount && count.current && !reducedMotion()) {
      gsap.fromTo(count.current, { scale: 1.3 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
    }
    prevCount.current = activeCount;
  }, [activeCount]);

  const calm = activeCount === 0;
  return (
    <section
      className={`lane lane-${group.key} ${calm ? 'is-calm' : ''} ${kpi.alert ? 'is-alert' : ''} ${dnd?.className ?? ''}`}
      aria-label={group.title}
      data-col={group.key}
      {...dnd?.zone}
    >
      <header className="kpi" {...dnd?.handle}>
        <div className="kpi-title">
          <span className="kpi-icon"><Icon name={group.key} /></span>
          <h2 className="kpi-label">{group.title}</h2>
        </div>
        {dnd && <span className="kpi-grip" aria-hidden>⠿</span>}
        <span className="kpi-value" ref={count}>{activeCount}</span>
        <span className={`kpi-sub ${kpi.warn ? 'is-warn' : ''}`}>{kpi.sub}</span>
      </header>
      <div className="lane-body">
        <p className="lane-hint">{group.hint}</p>
        {note && <p className="lane-note">{note}</p>}
        <div className="lane-list" ref={list}>
          {items.map((x) => (
            <IncidentCard key={x.inc.id} {...x} lane={group.key} now={now} operator={operator} teams={teams} />
          ))}
          {!items.length && <p className="lane-empty">{EMPTY[group.key]}</p>}
        </div>
      </div>
    </section>
  );
}
