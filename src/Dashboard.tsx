import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Incident, LiveEvent } from './types';
import {
  GROUPS, GROUP_RULES, type GroupKey, COORD_GROUP, fmtClock, fmtDuration, fmtAgo, groupsOf, isActive,
  isCritical, isCriticalActive, openItsm, resolutionStats, slaOf, STATE,
} from './lib/model';
import { onLiveEvents, useConnection, useLiveState, useNow } from './lib/live';
import { playCoord, playResolved, playSiren, playSoft, setMuted, unlockAudio } from './lib/sound';
import { gsap, reducedMotion } from './lib/motion';
import { useColumnLayout } from './lib/layout';
import { Lane, type LaneKpi } from './components/Lane';
import { CriticalAlarm } from './components/CriticalAlarm';
import { Toasts, type Toast } from './components/Toasts';
import { Sidebar } from './components/Sidebar';
import { DemoPanel } from './components/DemoPanel';
import { StartOverlay } from './components/StartOverlay';
import { Icon } from './components/Icon';

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
  riskOnly: boolean;
}
const NO_FILTERS: Filters = { q: '', product: '', serviceType: '', riskOnly: false };

function matches(i: Incident, f: Filters, risky: boolean) {
  if (f.product && i.productName !== f.product) return false;
  if (f.serviceType && i.serviceType !== f.serviceType) return false;
  if (f.riskOnly && !risky) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return [i.id, i.header, i.productName, i.service, i.assignedGroupName, i.assignedEmployee, i.initiatorName, i.description]
    .some((v) => v?.toLowerCase().includes(q));
}

function notify(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body, requireInteraction: true, tag: title + body });
    }
  } catch { /* уведомления недоступны */ }
}

export function Dashboard() {
  const { data, isError } = useLiveState();
  const connection = useConnection();
  const now = useNow(1000);
  const [operator, setOperator] = useState(() => store.get('operator', ''));
  const [started, setStarted] = useState(false);
  const [sound, setSound] = useState(true);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [demoOpen, setDemoOpen] = useState(() => new URLSearchParams(location.search).has('demo'));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [changes, setChanges] = useState<Record<string, number>>({});
  const board = useRef<HTMLDivElement>(null);
  const layout = useColumnLayout(board);

  const incidents = useMemo(() => data?.incidents ?? [], [data]);
  const acks = data?.acks ?? {};
  const stats = useMemo(() => resolutionStats(incidents), [incidents]);

  const mailCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of data?.mail ?? []) if (l.incidentId) m[l.incidentId] = (m[l.incidentId] ?? 0) + 1;
    return m;
  }, [data?.mail]);

  const unackedCritical = incidents
    .filter((i) => isCriticalActive(i) && !acks[`crit:${i.id}`])
    .sort((a, b) => Date.parse(a.submitDate) - Date.parse(b.submitDate));
  const activeCritical = incidents.filter(isCriticalActive);

  // ---------- Распределение по группам ----------
  const lanes = useMemo(() => {
    const out = {} as Record<GroupKey, { items: Parameters<typeof Lane>[0]['items']; active: number }>;
    const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
    for (const g of GROUPS) {
      const rule = GROUP_RULES[g.key];
      const rows = incidents
        .filter((i) => rule(i, now))
        .map((inc) => {
          const sla = slaOf(inc, now, stats);
          return {
            inc,
            sla,
            groups: groupsOf(inc, now),
            mailCount: mailCount[inc.id] ?? 0,
            unacked: g.key === 'coord' && !acks[`coord:${inc.id}`],
            changedAt: changes[inc.id],
          };
        })
        // Фильтры никогда не прячут критические инциденты.
        .filter((r) => g.key === 'critical' || !filtering || matches(r.inc, filters, r.sla.risk === 'overdue' || r.sla.risk === 'risk'));

      const left = (r: (typeof rows)[number]) => r.sla.left ?? Number.POSITIVE_INFINITY;
      rows.sort((a, b) => {
        if (g.key === 'critical' || g.key === 'coord' || g.key === 'high') {
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
      const active = g.key === 'critical' ? rows.filter((r) => isActive(r.inc)).length : rows.length;
      out[g.key] = { items: rows, active };
    }
    return out;
  }, [incidents, now, stats, mailCount, acks, changes, filters]);

  const summary = useMemo(() => {
    let active = 0, overdue = 0, risk = 0;
    for (const i of incidents) {
      if (!isActive(i)) continue;
      active++;
      const s = slaOf(i, now, stats);
      if (s.risk === 'overdue') overdue++;
      else if (s.risk === 'risk') risk++;
    }
    return { active, overdue, risk };
  }, [incidents, now, stats]);

  const resolvedOpen = useMemo(
    () => incidents
      .filter((i) => i.stateId === STATE.resolved)
      .sort((a, b) => Date.parse(b.completionDate ?? '0') - Date.parse(a.completionDate ?? '0')),
    [incidents],
  );

  const products = useMemo(() => [...new Set(incidents.map((i) => i.productName))].sort(), [incidents]);

  // ---------- Оповещения ----------
  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    setToasts((list) => [{ ...t, id: Math.random().toString(36).slice(2) }, ...list].slice(0, 5));
  }, []);
  const closeToast = useCallback((id: string) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  useEffect(() => onLiveEvents((events: LiveEvent[]) => {
    const stamp = Date.now();
    setChanges((c) => {
      const next = { ...c };
      for (const e of events) if (e.incidentId && e.type !== 'mail') next[e.incidentId] = stamp;
      return next;
    });
    let sound: 'resolved' | 'coord' | 'soft' | null = null;
    for (const e of events) {
      const where = `${e.incidentId ?? ''}${e.product ? `, ${e.product}` : ''}`;
      if (e.type === 'critical_resolved') {
        pushToast({ kind: 'resolved', title: 'Критический инцидент решён', text: where, incidentId: e.incidentId, ttl: 15000 });
        notify('Критический инцидент решён', where);
        sound = 'resolved';
      } else if (e.type === 'coord_assigned') {
        pushToast({ kind: 'coord', title: 'Назначен на координаторов', text: `${where}. Передайте в профильную команду`, incidentId: e.incidentId, ttl: 20000 });
        notify('Назначен на координаторов', where);
        sound ??= 'coord';
      } else if (e.type === 'critical_new') {
        notify('КРИТИЧЕСКИЙ ИНЦИДЕНТ', where);
      } else if (e.type === 'coord_handed_off') {
        pushToast({ kind: 'handoff', title: `Передан в «${e.to ?? 'команду'}»`, text: where, incidentId: e.incidentId, ttl: 7000 });
      } else if (e.type === 'mail' && e.level === 'warn') {
        pushToast({ kind: 'mail', title: 'Важное письмо', text: e.text.replace(/^Письмо: /, ''), incidentId: e.incidentId, ttl: 9000 });
        sound ??= 'soft';
      } else if (e.type === 'priority_changed' && e.level === 'warn') {
        sound ??= 'soft';
      }
    }
    if (sound === 'resolved') playResolved();
    else if (sound === 'coord') playCoord();
    else if (sound === 'soft') playSoft();
  }), [pushToast]);

  // Сирена повторяется, пока есть неподтверждённые критические.
  const alarmOn = started && unackedCritical.length > 0;
  useEffect(() => {
    if (!alarmOn) return;
    playSiren();
    const t = setInterval(playSiren, 3500);
    return () => clearInterval(t);
  }, [alarmOn]);

  // Мигающий заголовок вкладки, если координатор смотрит в другое окно.
  useEffect(() => {
    if (!unackedCritical.length) {
      document.title = activeCritical.length ? `● Критических: ${activeCritical.length} · Пульт МИ` : 'Пульт МИ';
      return;
    }
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? '🔴 КРИТИЧЕСКИЙ ИНЦИДЕНТ' : `Пульт МИ (${unackedCritical.length})`;
    }, 800);
    return () => clearInterval(t);
  }, [unackedCritical.length, activeCritical.length]);

  useEffect(() => setMuted(!sound), [sound]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const switchTheme = (t: Theme) => {
    setTheme(t);
    store.set('theme', t);
  };

  const start = (name: string) => {
    unlockAudio();
    setOperator(name);
    store.set('operator', name);
    setStarted(true);
    try { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission(); } catch { /* */ }
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
  const coordUnacked = coord.items.filter((r) => r.unacked).length;
  const highRisky = high.items.filter((r) => r.sla.risk === 'overdue' || r.sla.risk === 'risk').length;
  const researchOnCoord = research.items.filter((r) => r.inc.assignedGroupName === COORD_GROUP).length;
  const critResolved = crit.items.length - crit.active;
  const kpis: Record<GroupKey, LaneKpi> = {
    critical: {
      sub: unackedCritical.length
        ? `Ждут подтверждения: ${unackedCritical.length}`
        : crit.active ? 'Все на контроле' : critResolved ? `Решено за 12 ч: ${critResolved}` : 'Активных нет',
      alert: crit.active > 0,
    },
    coord: {
      sub: coordUnacked ? `Ждут «Принял»: ${coordUnacked}` : coord.active ? 'Передайте в профильные команды' : 'Очередь пуста',
      alert: coordUnacked > 0,
    },
    high: { sub: highRisky ? `Под угрозой срока: ${highRisky}` : high.active ? 'Сроки в норме' : 'Нет активных', warn: highRisky > 0 },
    research: { sub: researchOnCoord ? `На координаторах: ${researchOnCoord}` : research.active ? 'Идёт разбор причин' : 'Нет разборов' },
  };

  return (
    <div className={`app ${unackedCritical.length ? 'has-alarm' : ''}`}>
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
      </header>

      <div className="toolbar">
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
        <label className={`toggle ${filters.riskOnly ? 'is-on' : ''}`}>
          <input type="checkbox" checked={filters.riskOnly} onChange={(e) => setFilters({ ...filters, riskOnly: e.target.checked })} />
          Только со сроком под угрозой
        </label>
        {filtering && <button className="btn btn-quiet" onClick={() => setFilters(NO_FILTERS)}>Сбросить фильтры</button>}
        {!layout.isDefault && <button className="btn btn-quiet" onClick={layout.reset}>Вернуть колонки на место</button>}
        <span className="spacer" />
        <span className="operator">На смене: {operator || 'не указан'}</span>
        <button className={`btn btn-quiet ${sound ? '' : 'is-off'}`} onClick={() => setSound((s) => !s)} aria-pressed={!sound}>
          {sound ? 'Звук включён' : 'Звук выключен'}
        </button>
        <button className="btn btn-quiet" onClick={() => setDemoOpen((v) => !v)} aria-pressed={demoOpen}>Имитация ITSM</button>
      </div>

      {data.error && (
        <div className="data-error">
          Файл с данными не читается ({data.error}). На экране последние корректные данные, исправьте файл, и дашборд обновится сам.
        </div>
      )}

      {activeCritical.length > 0 && (
        <div className="crit-strip" role="alert">
          {activeCritical.map((i) => {
            const left = i.deadline ? Date.parse(i.deadline) - now : null;
            return (
              <button key={i.id} onClick={() => openItsm(i.id)}>
                <b>Критический</b>
                <span className="crit-text">
                  {i.productName}: {i.header}.{' '}
                  {left === null ? 'Срок не задан' : left > 0 ? `Осталось ${fmtDuration(left, true)}` : `Просрочен на ${fmtDuration(-left, true)}`}
                </span>
                {acks[`crit:${i.id}`] && <span className="crit-ack">на контроле: {acks[`crit:${i.id}`].by}</span>}
              </button>
            );
          })}
        </div>
      )}

      <main className="board" ref={board} style={{ '--cols': layout.columns } as CSSProperties}>
        {layout.order.map((key, position) => {
          if (key === 'side') {
            return <Sidebar key="side" events={data.events} mail={data.mail} now={now} summary={summary} dnd={layout.dnd('side')} />;
          }
          const g = GROUPS.find((x) => x.key === key)!;
          return (
            <Lane
              key={g.key}
              group={g}
              items={lanes[g.key].items}
              activeCount={lanes[g.key].active}
              kpi={kpis[g.key]}
              now={now}
              operator={operator}
              teams={data.meta.teams}
              note={g.key === 'critical' && filtering ? 'Фильтры не скрывают критические инциденты' : undefined}
              dnd={layout.dnd(g.key)}
              position={position}
            />
          );
        })}
      </main>

      <footer className="resolved">
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
      </footer>

      <Toasts toasts={toasts} onClose={closeToast} />
      {demoOpen && <DemoPanel auto={data.auto} onClose={() => setDemoOpen(false)} />}
      {started && <CriticalAlarm incidents={unackedCritical} now={now} operator={operator} />}
      {!started && <StartOverlay name={operator} onStart={start} />}
    </div>
  );
}
