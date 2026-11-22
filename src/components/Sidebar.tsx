import { type DragEvent, type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Letter, LiveEvent } from '../types';
import { fmtClock, fmtTime, openItsm, personName, type DeadlineFilter } from '../lib/model';
import type { ColumnDnd } from '../lib/layout';
import { Icon } from './Icon';
import { boardStorageKey, clampPanelScale, readPanelScales, saveBoardValue, type PanelScales } from '../lib/personal-board';

export interface DeadlineSummary {
  active: number;
  overdue: number;
  risk: number;
}

interface Props {
  events: LiveEvent[];
  mail: Letter[];
  now: number;
  summary: DeadlineSummary;
  deadlineFilter: DeadlineFilter;
  onDeadlineFilter: (value: Exclude<DeadlineFilter, 'all'>) => void;
  dnd?: ColumnDnd;
  operator: string;
  mobile?: boolean;
}

type SidePanel = 'events' | 'mail';
const SIDE_ORDER_DEFAULT: SidePanel[] = ['events', 'mail'];
const SIDE_LABEL: Record<SidePanel, string> = { events: 'События смены', mail: 'Почта по инцидентам' };
const SIDE_DRAG_TYPE = 'application/x-mi-sidebar-panel';

function readSideOrder(key: string): SidePanel[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (Array.isArray(value) && value.length === 2 && value.includes('events') && value.includes('mail')) {
      return value as SidePanel[];
    }
  } catch { /* Хранилище недоступно. */ }
  return [...SIDE_ORDER_DEFAULT];
}

export function Sidebar({ events, mail, now, summary, deadlineFilter, onDeadlineFilter, dnd, operator, mobile = false }: Props) {
  const storageKey = `mi:sidebar-order:v1:${operator.trim().toLocaleLowerCase('ru-RU') || 'координатор'}`;
  const [order, setOrder] = useState<SidePanel[]>(() => readSideOrder(storageKey));
  const [dragging, setDragging] = useState<SidePanel | null>(null);
  const [over, setOver] = useState<SidePanel | null>(null);
  const source = useRef<SidePanel | null>(null);

  const heightsKey = boardStorageKey(operator, 'sidebar-heights');
  const [scales, setScales] = useState<PanelScales>(() => readPanelScales(heightsKey));
  const [base, setBase] = useState<PanelScales | null>(null);
  const aside = useRef<HTMLElement>(null);
  const resize = useRef<{ panel: SidePanel; pointerId: number; y: number; scale: number; base: number } | null>(null);
  const [resizing, setResizing] = useState<SidePanel | null>(null);

  // 100% — исходная высота без пользовательской настройки. На широком экране
  // это половина свободного пространства после KPI; в сетке — исходная высота
  // строки, с прежним ограничением 22rem. Она не зависит от выбранного масштаба.
  useLayoutEffect(() => {
    if (mobile) return;
    const root = aside.current;
    if (!root) return;
    const kpi = root.querySelector<HTMLElement>('.kpi-sla');
    const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-side-panel]'));
    if (!kpi || panels.length !== 2) return;
    const px = (value: string) => parseFloat(value) || 0;
    const natural = (panel: HTMLElement) => {
      const head = panel.querySelector<HTMLElement>('.side-panel-head');
      const empty = panel.querySelector<HTMLElement>('.side-empty');
      const list = panel.querySelector<HTMLElement>('ol');
      const outerHeight = (el: HTMLElement) => {
        const style = getComputedStyle(el);
        return el.offsetHeight + px(style.marginTop) + px(style.marginBottom);
      };
      let height = (head ? outerHeight(head) : 0) + (empty ? outerHeight(empty) : 0);
      if (list) {
        const style = getComputedStyle(list);
        height += px(style.paddingTop) + px(style.paddingBottom);
        for (const child of Array.from(list.children)) if (child instanceof HTMLElement) height += outerHeight(child);
      }
      return height;
    };
    const measure = () => {
      const style = getComputedStyle(root);
      let next: PanelScales;
      if (style.display === 'grid') {
        const cap = 22 * px(getComputedStyle(document.documentElement).fontSize);
        const columns = style.gridTemplateColumns.trim().split(/\s+/).length;
        const intrinsic = Object.fromEntries(panels.map((panel) => [panel.dataset.sidePanel, Math.min(cap, natural(panel))])) as PanelScales;
        const common = Math.min(cap, Math.max(kpi.offsetHeight, intrinsic.events, intrinsic.mail));
        next = columns > 1 ? { events: common, mail: common } : intrinsic;
      } else {
        const available = Math.max(1, (root.clientHeight - kpi.offsetHeight - 2 * px(style.rowGap)) / 2);
        next = { events: available, mail: available };
      }
      // При очень маленькой высоте оставляем место хотя бы для ручки.
      next = { events: Math.max(44, next.events), mail: Math.max(44, next.mail) };
      setBase((old) => old && Math.abs(old.events - next.events) < .5 && Math.abs(old.mail - next.mail) < .5 ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(kpi);
    for (const panel of panels) {
      const head = panel.querySelector<HTMLElement>('.side-panel-head');
      const list = panel.querySelector<HTMLElement>('ol');
      if (head) observer.observe(head);
      if (list) observer.observe(list);
    }
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [events, mail, order, mobile]);

  useEffect(() => { saveBoardValue(heightsKey, scales); }, [heightsKey, scales]);

  function updateScale(panel: SidePanel, value: number) {
    const next = clampPanelScale(value);
    setScales((old) => old[panel] === next ? old : { ...old, [panel]: next });
  }
  function beginResize(event: PointerEvent<HTMLButtonElement>, panel: SidePanel) {
    if (mobile || event.button !== 0 || !base) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = { panel, pointerId: event.pointerId, y: event.clientY, scale: scales[panel], base: base[panel] };
    setResizing(panel);
  }
  function moveResize(event: PointerEvent<HTMLButtonElement>) {
    const active = resize.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    updateScale(active.panel, active.scale + (event.clientY - active.y) / active.base);
  }
  function endResize(event: PointerEvent<HTMLButtonElement>) {
    if (resize.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    resize.current = null;
    setResizing(null);
  }
  function resizeHandle(panel: SidePanel) {
    const percent = Math.round(scales[panel] * 100);
    return <div className="side-resize-bar">
      <button type="button" className="side-resize-step" title="Уменьшить высоту" aria-label={`Уменьшить высоту: ${SIDE_LABEL[panel]}`}
        disabled={scales[panel] <= .5} onClick={() => updateScale(panel, scales[panel] - .25)}>−</button>
      <button type="button" className="side-resize-handle" role="slider" aria-orientation="vertical"
      aria-label={`Высота: ${SIDE_LABEL[panel]}`} aria-valuemin={50} aria-valuemax={200} aria-valuenow={percent} aria-valuetext={`${percent}% от исходной высоты`}
      title={`Высота ${percent}% · потяните вверх/вниз · двойной щелчок — исходная высота`}
      onPointerDown={(event) => beginResize(event, panel)} onPointerMove={moveResize} onPointerUp={endResize}
      onPointerCancel={endResize} onLostPointerCapture={endResize}
      onDoubleClick={() => updateScale(panel, 1)}
      onKeyDown={(event) => {
        const delta = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? .1 : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -.1 : 0;
        if (!delta && !['Home', 'End', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        updateScale(panel, delta ? scales[panel] + delta : event.key === 'Home' ? .5 : event.key === 'End' ? 2 : 1);
      }}><span aria-hidden="true" /></button>
      <button type="button" className="side-resize-step" title="Увеличить высоту" aria-label={`Увеличить высоту: ${SIDE_LABEL[panel]}`}
        disabled={scales[panel] >= 2} onClick={() => updateScale(panel, scales[panel] + .25)}>+</button>
    </div>;
  }
  function panelStyle(panel: SidePanel) {
    return !mobile && base ? { height: `${base[panel] * scales[panel]}px` } : undefined;
  }

  function swap() {
    const next = [...order].reverse();
    setOrder(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Приватный режим. */ }
  }

  function finishDrag() {
    source.current = null;
    setDragging(null);
    setOver(null);
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, panel: SidePanel) {
    // Не запускаем параллельно перетаскивание всей колонки дашборда.
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(SIDE_DRAG_TYPE, panel);
    const section = event.currentTarget.closest('section');
    if (section) event.dataTransfer.setDragImage(section, 20, 20);
    source.current = panel;
    setDragging(panel);
  }

  function zone(panel: SidePanel) {
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!source.current) return;
        event.stopPropagation();
        if (source.current === panel) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(panel);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!source.current) return;
        event.stopPropagation();
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setOver((value) => value === panel ? null : value);
        }
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!source.current) return;
        event.stopPropagation();
        event.preventDefault();
        if (source.current !== panel) swap();
        finishDrag();
      },
    };
  }

  function handle(panel: SidePanel) {
    const hint = `Перетащить «${SIDE_LABEL[panel]}» или нажать, чтобы поменять блоки местами`;
    return (
      <button type="button" className="side-drag-handle" draggable title={hint} aria-label={hint}
        onDragStart={(event) => startDrag(event, panel)}
        onDragEnd={(event) => { event.stopPropagation(); finishDrag(); }}
        onClick={() => { if (!source.current) swap(); }}>
        <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">
          {[5, 10, 15].map((y) => <g key={y}><circle cx="7" cy={y} r="1.35" /><circle cx="13" cy={y} r="1.35" /></g>)}
        </svg>
      </button>
    );
  }

  function panelClass(panel: SidePanel) {
    return `side-block side-reorder-panel${dragging === panel ? ' side-panel-dragging' : over === panel ? ' side-panel-drop' : ''}${resizing === panel ? ' is-resizing' : ''}`;
  }

  // На дашборде показываем только новые потенциальные письма без уже созданной связи с ITSM.
  const candidates = mail.filter((m) => m.folder === 'inbox' && !m.incidentId && m.analysis?.isPotential)
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  return (
    <aside ref={aside} id={mobile ? 'mobile-side' : undefined} className={`sidebar ${mobile ? 'sidebar-mobile' : 'sidebar-resizable'} ${dnd?.className ?? ''}`} data-col="side" {...dnd?.zone}>
      <section className="kpi kpi-sla" aria-label="Контроль сроков">
        <div className="kpi-head" {...dnd?.handle}>
          <div className="kpi-title">
            <span className="kpi-icon"><Icon name="clock" /></span>
            <h2 className="kpi-label">Контроль сроков</h2>
          </div>
          <span className="kpi-sub" title="Активные карточки четырёх основных категорий, включая повторы">из {summary.active} карточек на доске</span>
          {dnd && <span className="kpi-grip" aria-hidden>⠿</span>}
        </div>
        <div className="kpi-pair" role="group" aria-label="Фильтры по дедлайну">
          <button type="button" className={`sla-filter ${summary.overdue ? 'is-bad' : ''}`}
            aria-pressed={deadlineFilter === 'overdue'}
            title="Показать только просроченные; повторное нажатие сбрасывает фильтр"
            onClick={() => onDeadlineFilter('overdue')}>
            <span className="kpi-value">{summary.overdue}</span>
            <span className="kpi-sub">просрочено</span>
          </button>
          <button type="button" className={`sla-filter ${summary.risk ? 'is-warn' : ''}`}
            aria-pressed={deadlineFilter === 'risk'}
            title="До дедлайна не более 2 часов; повторное нажатие сбрасывает фильтр"
            onClick={() => onDeadlineFilter('risk')}>
            <span className="kpi-value">{summary.risk}</span>
            <span className="kpi-sub">под угрозой</span>
          </button>
        </div>
      </section>
      {mobile && <a className="btn mobile-back-to-lanes" href="#dashboard-filters" onClick={(event) => { event.preventDefault(); document.querySelector('.mobile-category-nav')?.scrollIntoView({ block: 'start' }); }}>↑ К инцидентам</a>}
      {(mobile ? SIDE_ORDER_DEFAULT : order).map((panel) => panel === 'events' ? (
      <section key="events" data-side-panel="events" className={panelClass('events')} style={panelStyle('events')} {...(mobile ? {} : zone('events'))}>
        <div className="side-panel-content">
        <div className="side-panel-head">
          <h2><Icon name="activity" /><span>События смены</span></h2>
          {!mobile && handle('events')}
        </div>
        {!events.length && <p className="side-empty">Изменения из ITSM появятся здесь, как только придут</p>}
        <ol className="feed">
          {events.slice(0, 40).map((e) => (
            <li key={e.id} className={`feed-item lvl-${e.level}`}>
              <time>{fmtClock(e.at)}</time>
              <button disabled={!e.incidentId} onClick={() => e.incidentId && openItsm(e.incidentId)}>
                <span className="feed-text">{e.text}</span>
                {e.incidentId && <span className="feed-inc">{e.incidentId}{e.product ? `, ${e.product}` : ''}</span>}
              </button>
            </li>
          ))}
        </ol>
        </div>
        {!mobile && resizeHandle('events')}
      </section>
      ) : (
      <section key="mail" data-side-panel="mail" className={panelClass('mail')} style={panelStyle('mail')} {...(mobile ? {} : zone('mail'))}>
        <div className="side-panel-content">
        <div className="side-panel-head">
          <h2><Icon name="mail" /><span>Почта по инцидентам</span><a className="side-mail-all" href="/cabinet">Вся почта</a></h2>
          {!mobile && handle('mail')}
        </div>
        {!candidates.length && <p className="side-empty">Подозрительных писем пока нет. Анализ не создаёт инциденты.</p>}
        <ol className="mail">
          {candidates.slice(0, 30).map((m) => (
            <li key={m.id} className={m.important ? 'is-important' : ''}>
              <a href={`/cabinet/mail/${encodeURIComponent(m.id)}`} title="Открыть письмо в личном кабинете">
                <span className="mail-meta">
                  <b>{personName(m.fromName) || m.fromName}</b>
                  <time>{fmtTime(m.receivedAt, now)}</time>
                </span>
                <span className="mail-subject">{m.subject}</span>
                <span className="mail-body">{m.body}</span>
                <span className="mail-ai-tag">{m.analysis.source === 'ollama' ? 'ИИ' : m.analysis.source === 'manual' ? 'Отмечено' : 'Правила'}{m.incidentId ? ` · ${m.incidentId}` : ' · Без инцидента'}</span>
              </a>
            </li>
          ))}
        </ol>
        </div>
        {!mobile && resizeHandle('mail')}
      </section>
      ))}
    </aside>
  );
}
