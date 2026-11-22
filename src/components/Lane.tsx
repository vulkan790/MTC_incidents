import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap, Flip, reducedMotion } from '../lib/motion';
import type { DeadlineFilter, GroupKey } from '../lib/model';
import type { ColumnDnd } from '../lib/layout';
import { IncidentCard, type CardProps } from './IncidentCard';
import { CompactIncidentRow } from './CompactIncidentRow';
import type { IncidentViewMode } from '../lib/notification-settings';
import { Icon, type IconName } from './Icon';
import { boardStorageKey, PIN_LIMIT, pinnedFirst, prunePins, readPins, saveBoardValue, togglePin } from '../lib/personal-board';

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
  items: (Omit<CardProps, 'lane' | 'now' | 'operator' | 'teams' | 'pinned' | 'pinLimitReached' | 'onTogglePin'> & { criticalUnacked?: boolean })[];
  eligibleIds: ReadonlySet<string>;
  viewMode: IncidentViewMode;
  activeCount: number;
  kpi: LaneKpi;
  now: number;
  operator: string;
  teams: string[];
  note?: string;
  filtered?: boolean;
  filterKey?: DeadlineFilter;
  icon?: IconName;
  /** Перетаскивание колонки и её текущее место на доске. */
  dnd?: ColumnDnd;
  position?: number;
}

export function Lane({ group, items, eligibleIds, activeCount, kpi, now, operator, teams, note, dnd, position, viewMode, filtered, filterKey = 'all', icon }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const previousViewMode = useRef(viewMode);
  const previousFilterKey = useRef(filterKey);
  const filterChanged = previousFilterKey.current !== filterKey;
  const prevCount = useRef(activeCount);
  const storageKey = boardStorageKey(operator, `pins:${group.key}`);
  const [savedPins, setSavedPins] = useState(() => readPins(storageKey));
  // Фильтры не сбрасывают закрепления. Очищаем только инциденты, покинувшие категорию.
  const pins = prunePins(savedPins, eligibleIds);
  useEffect(() => {
    if (pins !== savedPins) setSavedPins(pins);
    saveBoardValue(storageKey, pins);
  }, [pins, savedPins, storageKey]);
  const orderedItems = pinnedFirst(items, pins, (x) => x.inc.id);
  const order = orderedItems.map((x) => x.inc.id).join('|');
  const pinProps = (id: string) => ({
    pinned: pins.includes(id),
    pinLimitReached: pins.length >= PIN_LIMIT,
    onTogglePin: () => setSavedPins((current) => togglePin(prunePins(current, eligibleIds), id)),
  });

  // Карточки плавно переезжают на новые места, новые — въезжают.
  useLayoutEffect(() => {
    if (!list.current) return;
    const els = list.current.querySelectorAll<HTMLElement>(':scope > [data-flip-id]');
    // При смене вида элементы пересоздаются: прежнее Flip-состояние использовать нельзя.
    const sameMode = previousViewMode.current === viewMode;
    previousViewMode.current = viewMode;
    previousFilterKey.current = filterKey;
    // Фильтр должен менять список сразу; анимация перестановки здесь только
    // создаёт ощущение задержки при переключении «Просрочено/Под угрозой».
    if (sameMode && !filterChanged && flipState.current && !filtered && !reducedMotion()) {
      Flip.from(flipState.current, {
        targets: els,
        duration: 0.6,
        ease: 'power3.out',
        onEnter: (entering) =>
          gsap.fromTo(entering, { opacity: 0, x: -28, scale: 0.97 }, { opacity: 1, x: 0, scale: 1, duration: 0.6, ease: 'power3.out' }),
      });
    }
    flipState.current = Flip.getState(els);
  }, [order, viewMode, filtered, filterKey]);

  // Колонку перетащили на другое место: запоминаем новые позиции карточек, чтобы они не прилетали со старого.
  useLayoutEffect(() => {
    if (list.current) flipState.current = Flip.getState(list.current.querySelectorAll(':scope > [data-flip-id]'));
  }, [position]);

  useLayoutEffect(() => {
    if (prevCount.current !== activeCount && count.current && !filtered && !filterChanged && !reducedMotion()) {
      gsap.fromTo(count.current, { scale: 1.3 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
    }
    prevCount.current = activeCount;
  }, [activeCount, filtered, filterKey]);

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
          <span className="kpi-icon"><Icon name={icon ?? group.key} /></span>
          <h2 className="kpi-label">{group.title}</h2>
        </div>
        {dnd && <span className="kpi-grip" aria-hidden>⠿</span>}
        <span className="kpi-value" ref={count}>{activeCount}</span>
        <span className={`kpi-sub ${kpi.warn ? 'is-warn' : ''}`}>{kpi.sub}</span>
      </header>
      <div className="lane-body">
        <p className="lane-hint">{group.hint}</p>
        {note && <p className="lane-note">{note}</p>}
        <div className={`lane-list ${viewMode === 'compact' ? 'is-compact-list' : ''}`} ref={list}>
          {orderedItems.map((x) => viewMode === 'compact'
            ? <CompactIncidentRow key={x.inc.id} {...x} {...pinProps(x.inc.id)} lane={group.key} now={now} operator={operator} teams={teams} />
            : <IncidentCard key={x.inc.id} {...x} {...pinProps(x.inc.id)} lane={group.key} now={now} operator={operator} teams={teams} />
          )}
          {!items.length && <p className="lane-empty">{filtered ? 'Нет инцидентов по выбранному фильтру' : EMPTY[group.key]}</p>}
        </div>
      </div>
    </section>
  );
}
