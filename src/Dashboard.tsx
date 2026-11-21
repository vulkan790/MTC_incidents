import { type CSSProperties, type TouchEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Incident } from './types';
import {
  GROUPS, GROUP_RULES, type GroupKey, COORD_GROUP, fmtClock, fmtAgo, groupsOf, isActive,
  isCritical, isCriticalActive, openItsm, resolutionStats, slaOf, STATE, dashboardDeadlineSummary, matchesDeadline, type DeadlineFilter,
} from './lib/model';
import { useConnection, useLiveState, useNow } from './lib/live';
import { unlockAudio } from './lib/sound';
import { gsap, reducedMotion } from './lib/motion';
import { DEFAULT_ORDER, useColumnLayout } from './lib/layout';
import { swipeDirection, useMobileLayout } from './lib/mobile';
import { Lane, type LaneKpi } from './components/Lane';
import { Sidebar } from './components/Sidebar';
import { DemoPanel } from './components/DemoPanel';
import { StartOverlay } from './components/StartOverlay';
import { Icon } from './components/Icon';
import { readNotificationSettings, useNotificationSettings } from './lib/notification-settings';
import { startShift } from './lib/operator-session';
import { CriticalStrips, useGlobalAlerts } from './lib/global-alerts';

const store = {
  get(key: string, fallback: string) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
  },
};

type Theme = 'light' | 'dark';
// Тему выставляет скрипт в index.html до первой отрисовки, чтобы экран не мигал.
const initialTheme = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

interface Filters {
  q: string;
  product: string;
  serviceType: string;
  deadline: DeadlineFilter;
}
const NO_FILTERS: Filters = { q: '', product: '', serviceType: '', deadline: 'all' };

function matches(i: Incident, f: Filters) {
  if (f.product && i.productName !== f.product) return false;
  if (f.serviceType && i.serviceType !== f.serviceType) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return [i.id, i.header, i.productName, i.service, i.assignedGroupName, i.assignedEmployee, i.initiatorName, i.description]
    .some((v) => v?.toLowerCase().includes(q));
}

export function Dashboard() {
  const { data, isError } = useLiveState();
  const connection = useConnection();
  const now = useNow(1000);
  const { operator, started, alarmOn, changes } = useGlobalAlerts();
  const { settings: preferences, update: updatePreferences } = useNotificationSettings(operator);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [demoOpen, setDemoOpen] = useState(() => new URLSearchParams(location.search).has('demo'));
  const board = useRef<HTMLDivElement>(null);
  const layout = useColumnLayout(board);
  const mobile = useMobileLayout();
  const [mobileGroup, setMobileGroup] = useState<GroupKey>('critical');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const mobileTabs = useRef<HTMLElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const mobileIndex = GROUPS.findIndex((group) => group.key === mobileGroup);

  function selectMobileGroup(key: GroupKey) {
    setMobileGroup(key);
    // При переключении после длинного списка возвращаемся к заголовку категории.
    if (mobileTabs.current && mobileTabs.current.getBoundingClientRect().top < 0) {
      mobileTabs.current.scrollIntoView({ block: 'start' });
    }
  }
  function beginSwipe(event: TouchEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const valid = mobile && event.touches.length === 1 && target.closest('.lane')
      && !target.closest('input, select, textarea, .handoff, .compact-handoff');
    touch.current = valid ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }
  function endSwipe(event: TouchEvent<HTMLElement>) {
    const start = touch.current;
    touch.current = null;
    if (!mobile || !start || event.changedTouches.length !== 1) return;
    const end = event.changedTouches[0];
    const direction = swipeDirection(end.clientX - start.x, end.clientY - start.y);
    const next = GROUPS[mobileIndex + direction];
    if (direction && next) selectMobileGroup(next.key);
  }

  const incidents = useMemo(() => data?.incidents ?? [], [data]);
  const acks = data?.acks ?? {};
  const stats = useMemo(() => resolutionStats(incidents), [incidents]);

  const mailCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of data?.mail ?? []) if (l.incidentId) m[l.incidentId] = (m[l.incidentId] ?? 0) + 1;
    return m;
  }, [data?.mail]);

  // ---------- Распределение по группам ----------
  const lanes = useMemo(() => {
    const out = {} as Record<GroupKey, { items: Parameters<typeof Lane>[0]['items']; active: number; eligibleIds: Set<string> }>;
    const deadlineFiltering = filters.deadline !== 'all';
    for (const g of GROUPS) {
      // Фильтры сроков не подменяют категории и не расширяют охват дашборда.
      const rule = GROUP_RULES[g.key];
      const eligible = incidents.filter((i) => rule(i, now));
      const rows = eligible
        .map((inc) => {
          const sla = slaOf(inc, now, stats);
          return {
            inc,
            sla,
            groups: groupsOf(inc, now),
            mailCount: mailCount[inc.id] ?? 0,
            unacked: inc.assignedGroupName === COORD_GROUP && !acks[`coord:${inc.id}`],
            criticalUnacked: isCriticalActive(inc) && !acks[`crit:${inc.id}`],
            changedAt: changes[inc.id],
          };
        })
        // Обычные фильтры не прячут критические. Явный фильтр срока
        // применяется ко всем категориям, включая критические.
        .filter((r) => matchesDeadline(r.inc, now, filters.deadline)
          && ((!deadlineFiltering && g.key === 'critical') || matches(r.inc, filters)));

      const left = (r: (typeof rows)[number]) => r.sla.left ?? Number.POSITIVE_INFINITY;
      rows.sort((a, b) => {
        if (g.key !== 'research') {
          if (a.unacked !== b.unacked) return a.unacked ? -1 : 1;
          const aa = isActive(a.inc), ba = isActive(b.inc);
          if (aa !== ba) return aa ? -1 : 1;
          if (aa) return left(a) - left(b);
          return Date.parse(b.inc.completionDate ?? '0') - Date.parse(a.inc.completionDate ?? '0');
        }
        // Исследование: сначала то, что лежит на координаторах, затем свежие.
        const ac = a.inc.assignedGroupName === COORD_GROUP, bc = b.inc.assignedGroupName === COORD_GROUP;
        if (ac !== bc) return ac ? -1 : 1;
        return Date.parse(b.inc.completionDate ?? b.inc.submitDate) - Date.parse(a.inc.completionDate ?? a.inc.submitDate);
      });
      const active = rows.length; // Во всех категориях решённые инциденты уже исключены правилами.
      out[g.key] = { items: rows, active, eligibleIds: new Set(eligible.map((i) => i.id)) };
    }
    return out;
  }, [incidents, now, stats, mailCount, acks, changes, filters]);

  const summary = useMemo(() => dashboardDeadlineSummary(incidents, now), [incidents, now]);

  const resolvedOpen = useMemo(
    () => incidents
      .filter((i) => i.stateId === STATE.resolved)
      .sort((a, b) => Date.parse(b.completionDate ?? '0') - Date.parse(a.completionDate ?? '0')),
    [incidents],
  );

  const products = useMemo(() => [...new Set(incidents.map((i) => i.productName))].sort(), [incidents]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const switchTheme = (t: Theme) => {
    setTheme(t);
    store.set('theme', t);
  };

  const start = (name: string) => {
    try { void unlockAudio().catch(() => {}); } catch { /* звук недоступен */ }
    startShift(name);
    try { if ('Notification' in window && (readNotificationSettings(name).criticalDesktop || readNotificationSettings(name).desktopOther) && Notification.permission === 'default') void Notification.requestPermission(); } catch { /* */ }
    if (board.current && !reducedMotion()) {
      gsap.fromTo(board.current.querySelectorAll('.lane'), { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.08, duration: 0.6, ease: 'power3.out' });
    }
  };

  if (!data) {
    return (
      <div className="boot">
        {isError ? 'Нет связи с сервером дашборда. Проверьте, что запущен npm run dev, повторяю попытку…' : 'Загружаю инциденты…'}
      </div>
    );
  }

  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  // Крупные числа над колонками: сколько и что важно прямо сейчас.
  const crit = lanes.critical, coord = lanes.coord, high = lanes.high, research = lanes.research;
  const deadlineFiltering = filters.deadline !== 'all';
  const visibleUnackedCritical = crit.items.filter((r) => r.criticalUnacked).length;
  const coordUnacked = coord.items.filter((r) => r.unacked).length;
  const highOverdue = high.items.filter((r) => r.sla.risk === 'overdue').length;
  const highRisk = high.items.filter((r) => r.sla.risk === 'risk').length;
  const researchOnCoord = research.items.filter((r) => r.inc.assignedGroupName === COORD_GROUP).length;
  const kpis: Record<GroupKey, LaneKpi> = {
    critical: {
      sub: visibleUnackedCritical
        ? `Ждут подтверждения: ${visibleUnackedCritical}`
        : crit.active ? 'Все на контроле' : 'Активных нет',
      alert: crit.active > 0,
    },
    coord: {
      sub: coordUnacked ? `Ждут «Принял»: ${coordUnacked}` : coord.active ? 'Передайте в профильные команды' : 'Очередь пуста',
      alert: coordUnacked > 0,
    },
    high: { sub: highOverdue || highRisk ? [highOverdue ? `Просрочено: ${highOverdue}` : '', highRisk ? `Под угрозой: ${highRisk}` : ''].filter(Boolean).join(' · ') : high.active ? 'Сроки в норме' : 'Нет активных', warn: highOverdue + highRisk > 0 },
    research: { sub: deadlineFiltering ? 'Нет активных сроков' : researchOnCoord ? `На координаторах: ${researchOnCoord}` : research.active ? 'Идёт разбор причин' : 'Нет разборов' },
  };

  return (
    <div className={`app ${mobile ? 'is-mobile-app' : ''} ${alarmOn ? 'has-alarm' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/mtc.png" alt="МТС" />
          <div>
            <b>Пульт МИ</b>
            <span>Координаторы массовых инцидентов</span>
          </div>
        </div>
        <div className={`conn conn-${connection}`}>
          <span className="conn-dot" />
          {connection === 'online' ? `Онлайн, данные от ${fmtClock(data.updatedAt)}` : connection === 'offline' ? 'Нет связи, переподключаюсь' : 'Подключаюсь'}
        </div>
        <div className="theme-switch" role="group" aria-label="Тема оформления">
          <button aria-pressed={theme === 'light'} onClick={() => switchTheme('light')}>Светлая</button>
          <button aria-pressed={theme === 'dark'} onClick={() => switchTheme('dark')}>Тёмная</button>
        </div>
        <div className="clock">{new Date(now).toLocaleTimeString('ru-RU')}</div>
        <a className="settings-link" href="/settings" title="Персональные настройки уведомлений">⚙ Настройки</a>
        <a className="profile-link" href="/cabinet" title="Личный кабинет и почта" aria-label="Личный кабинет и почта">
          <span className="profile-avatar">{(operator.trim()[0] || 'К').toUpperCase()}</span>
          <span className="profile-label">Кабинет</span>
        </a>
      </header>

      {mobile && <div className="mobile-toolbar-head">
        <button type="button" className="btn mobile-filter-toggle" aria-expanded={mobileFiltersOpen} aria-controls="dashboard-filters" onClick={() => setMobileFiltersOpen((v) => !v)}>
          {mobileFiltersOpen ? 'Скрыть фильтры' : 'Поиск и фильтры'}{filtering ? ' · активны' : ''}
        </button>
        <a className="btn mobile-side-link" href="#mobile-side">Сроки и события ↓</a>
      </div>}
      <div id="dashboard-filters" className={`toolbar ${mobile && !mobileFiltersOpen ? 'mobile-filters-closed' : ''}`}>
        <input
          className="search"
          type="search"
          placeholder="Поиск по номеру, продукту, команде"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <select value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })} aria-label="Продукт">
          <option value="">Все продукты</option>
          {products.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={filters.serviceType} onChange={(e) => setFilters({ ...filters, serviceType: e.target.value })} aria-label="Тип сервиса">
          <option value="">Любое влияние</option>
          <option value="Клиентский">Клиентский</option>
          <option value="Пользовательский">Пользовательский</option>
          <option value="Технологический">Технологический</option>
        </select>
        <select className={`deadline-select ${deadlineFiltering ? 'is-on' : ''}`} value={filters.deadline}
          onChange={(e) => setFilters((old) => ({ ...old, deadline: e.target.value as DeadlineFilter }))} aria-label="Фильтр по сроку">
          <option value="all">Все сроки</option>
          <option value="overdue">Только просроченные</option>
          <option value="risk">Под угрозой (до 2 ч)</option>
        </select>
        {filtering && <button className="btn btn-quiet" onClick={() => setFilters(NO_FILTERS)}>Сбросить фильтры</button>}
        {!mobile && !layout.isDefault && <button className="btn btn-quiet" onClick={layout.reset}>Вернуть колонки на место</button>}
        <span className="spacer" />
        <span className="operator">На смене: {operator || 'не указан'}</span>
        <button className={`btn btn-quiet ${preferences.soundEnabled ? '' : 'is-off'}`} onClick={() => updatePreferences({ soundEnabled: !preferences.soundEnabled })} aria-pressed={!preferences.soundEnabled}>
          {preferences.soundEnabled ? 'Звук включён' : 'Звук выключен'}
        </button>
        <button className="btn btn-quiet" onClick={() => setDemoOpen((v) => !v)} aria-pressed={demoOpen}>Имитация ITSM</button>
      </div>

      {data.error && (
        <div className="data-error">
          Файл с данными не читается ({data.error}). На экране последние корректные данные, исправьте файл, и дашборд обновится сам.
        </div>
      )}

      <CriticalStrips />

      <main className={`board ${preferences.incidentViewMode === 'compact' ? 'is-compact-board' : ''} ${mobile ? 'is-mobile-board' : ''}`} ref={board} style={{ '--cols': layout.columns } as CSSProperties}
        data-mobile-group={mobile ? mobileGroup : undefined} onTouchStart={beginSwipe} onTouchEnd={endSwipe} onTouchCancel={() => { touch.current = null; }}>
        {mobile && <nav className="mobile-category-nav" ref={mobileTabs} aria-label="Категории инцидентов">
          <div className="mobile-category-head"><b>Инциденты</b><span>{mobileIndex + 1} / {GROUPS.length} · свайп ← →</span></div>
          <div className="mobile-category-tabs">
            {GROUPS.map((group) => <button type="button" key={group.key} className={`mobile-category-tab tab-${group.key}`} aria-pressed={mobileGroup === group.key} onClick={() => selectMobileGroup(group.key)}>
              <Icon name={group.key} /><span>{group.title}</span><strong>{lanes[group.key].active}</strong>
            </button>)}
          </div>
        </nav>}
        {(mobile ? DEFAULT_ORDER : layout.order).map((key, position) => {
          if (key === 'side') {
            return <Sidebar key={`side:${operator}`} mobile={mobile} operator={operator} events={data.events} mail={data.mail} now={now} summary={summary} deadlineFilter={filters.deadline} onDeadlineFilter={(value) => {
              const next = filters.deadline === value ? 'all' : value;
              setFilters((old) => ({ ...old, deadline: next }));
              if (mobile) {
                const matching = GROUPS.find((g) => incidents.some((i) => GROUP_RULES[g.key](i, now) && matchesDeadline(i, now, next) && (g.key === 'critical' && next === 'all' || matches(i, filters))));
                if (matching) setMobileGroup(matching.key);
                mobileTabs.current?.scrollIntoView({ block: 'start' });
              }
            }} dnd={mobile ? undefined : layout.dnd('side')} />;
          }
          const g = GROUPS.find((x) => x.key === key)!;
          return (
            <Lane
              key={`${g.key}:${operator}`}
              group={g}
              items={lanes[g.key].items}
              eligibleIds={lanes[g.key].eligibleIds}
              activeCount={lanes[g.key].active}
              kpi={kpis[g.key]}
              now={now}
              operator={operator}
              teams={data.meta.teams}
              viewMode={preferences.incidentViewMode}
              note={g.key === 'critical' && filtering && !deadlineFiltering ? 'Фильтры не скрывают критические инциденты' : undefined}
              filtered={deadlineFiltering}
              dnd={mobile ? undefined : layout.dnd(g.key)}
              position={position}
            />
          );
        })}
      </main>

      {!deadlineFiltering && <footer className="resolved">
        <span className="resolved-title">
          <Icon name="check" />
          <b>{resolvedOpen.length}</b> решены, но не закрыты. К ним могут вернуться
        </span>
        <div className="resolved-list">
          {resolvedOpen.map((i) => (
            <button key={i.id} className={`resolved-chip ${isCritical(i) ? 'is-crit' : ''}`} onClick={() => openItsm(i.id)}>
              <b>{i.productName}</b>
              <span>{i.id}, решён {i.completionDate ? fmtAgo(i.completionDate, now) : ''}</span>
              {i.isNeedUp && <em>нужно устранить последствия</em>}
            </button>
          ))}
        </div>
      </footer>}

      {demoOpen && <DemoPanel auto={data.auto} onClose={() => setDemoOpen(false)} />}
      {!started && <StartOverlay name={operator} onStart={start} />}
    </div>
  );
}
