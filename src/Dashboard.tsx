import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Incident, LiveEvent, LiveState } from './types';
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
import { matchesCriticalAlert, readNotificationSettings, useNotificationSettings } from './lib/notification-settings';

const store = {
  get(key: string, fallback: string) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
  },
};

// Отказ не является подтверждением и сохраняется только в текущей сессии браузера.
function readDeclinedCritical(operator: string): string[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(`mi:declined-critical:${operator}`) || '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

// Скрытие красной полосы — личное действие координатора, а НЕ подтверждение в ITSM.
// Запоминаем номера критических инцидентов на момент закрытия. Новый критический
// появится на полосе снова, даже если предыдущую координатор скрыл.
function criticalStripStorageKey(operator: string) {
  return `mi:hidden-critical-strip:${operator.trim().toLocaleLowerCase('ru-RU') || 'координатор'}`;
}
function readHiddenCriticalStrip(operator: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(criticalStripStorageKey(operator));
    if (raw === null) return null;
    const saved: unknown = JSON.parse(raw);
    return Array.isArray(saved) && saved.every((id) => typeof id === 'string') ? saved : null;
  } catch { return null; }
}

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
  const [declinedCritical, setDeclinedCritical] = useState<string[]>(() => readDeclinedCritical(store.get('operator', '')));
  const [hiddenCriticalStripIds, setHiddenCriticalStripIds] = useState<string[] | null>(() => readHiddenCriticalStrip(store.get('operator', '')));
  const { settings: preferences, update: updatePreferences } = useNotificationSettings(operator);
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
  const isCriticalStripHidden = hiddenCriticalStripIds !== null
    && activeCritical.length > 0
    && activeCritical.every((i) => hiddenCriticalStripIds.includes(i.id));

  const hideCriticalStrip = () => {
    const ids = activeCritical.map((i) => i.id);
    setHiddenCriticalStripIds(ids);
    try { sessionStorage.setItem(criticalStripStorageKey(operator), JSON.stringify(ids)); }
    catch { /* приватный режим: скрываем хотя бы до перезагрузки */ }
  };
  const showCriticalStrip = () => {
    setHiddenCriticalStripIds(null);
    try { sessionStorage.removeItem(criticalStripStorageKey(operator)); }
    catch { /* */ }
  };
  // При появлении нового критического снимаем локальное скрытие автоматически.
  // Если критических больше нет, сбрасываем скрытие, чтобы повторная авария снова показалась.
  useEffect(() => {
    if (!data || hiddenCriticalStripIds === null) return;
    if (activeCritical.length === 0 || activeCritical.some((i) => !hiddenCriticalStripIds.includes(i.id))) {
      showCriticalStrip();
    }
  }, [data, activeCritical, hiddenCriticalStripIds, operator]);
  // Критические группы остаются общими. Персональные настройки влияют только на тревогу.
  const eligibleUnacked = incidents.filter((i) => matchesCriticalAlert(i, preferences) && !acks[`crit:${i.id}`])
    .sort((a, b) => Date.parse(a.submitDate) - Date.parse(b.submitDate));
  const alarmCritical = eligibleUnacked.filter((i) => !declinedCritical.includes(i.id));
  const declinedUnacked = eligibleUnacked.filter((i) => declinedCritical.includes(i.id));

  // При решении или закрытии инцидента очищаем его личный отказ.
  // Если инцидент вновь станет критическим, оповещение появится снова.
  useEffect(() => {
    if (!data) return;
    const validIds = new Set(incidents.filter((i) => i.priorityId === 4 && i.stateId !== STATE.resolved && i.stateId !== STATE.closed).map((i) => i.id));
    setDeclinedCritical((old) => old.every((id) => validIds.has(id)) ? old : old.filter((id) => validIds.has(id)));
  }, [data, incidents]);

  useEffect(() => {
    try { sessionStorage.setItem(`mi:declined-critical:${operator}`, JSON.stringify(declinedCritical)); }
    catch { /* может быть запрещён доступ к хранилищу */ }
  }, [operator, declinedCritical]);

  const declineCritical = (id: string) => {
    setDeclinedCritical((old) => old.includes(id) ? old : [...old, id]);
  };
  const restoreCriticalAlarm = () => {
    setDeclinedCritical((old) => old.filter((id) => !declinedUnacked.some((i) => i.id === id)));
  };

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
      const active = rows.length; // Во всех категориях решённые инциденты уже исключены правилами.
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

  useEffect(() => onLiveEvents((events: LiveEvent[], incoming: LiveState) => {
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
        if (preferences.resolvedToasts) pushToast({ kind: 'resolved', title: 'Критический инцидент решён', text: where, incidentId: e.incidentId, ttl: 15000 });
        if (preferences.desktopOther) notify('Критический инцидент решён', where);
        if (preferences.resolvedToasts) sound = 'resolved';
      } else if (e.type === 'coord_assigned') {
        if (preferences.coordToasts) pushToast({ kind: 'coord', title: 'Назначен на координаторов', text: `${where}. Передайте в профильную команду`, incidentId: e.incidentId, ttl: 20000 });
        if (preferences.desktopOther) notify('Назначен на координаторов', where);
        if (preferences.coordToasts) sound ??= 'coord';
      } else if (e.type === 'critical_new') {
        // Фильтр работает для новых событий так же, как для модального окна.
        const incident = incoming.incidents.find((i) => i.id === e.incidentId);
        if (preferences.criticalDesktop && incident && matchesCriticalAlert(incident, preferences) && !declinedCritical.includes(incident.id)) {
          notify('КРИТИЧЕСКИЙ ИНЦИДЕНТ', where);
        }
      } else if (e.type === 'coord_handed_off') {
        pushToast({ kind: 'handoff', title: `Передан в «${e.to ?? 'команду'}»`, text: where, incidentId: e.incidentId, ttl: 7000 });
      } else if (e.type === 'mail' && e.level === 'warn') {
        if (preferences.mailToasts) {
          pushToast({ kind: 'mail', title: 'Важное письмо', text: e.text.replace(/^Письмо: /, ''), incidentId: e.incidentId, ttl: 9000 });
          sound ??= 'soft';
        }
      } else if (e.type === 'priority_changed' && e.level === 'warn') {
        sound ??= 'soft';
      }
    }
    if (preferences.secondarySounds && preferences.soundEnabled) {
      if (sound === 'resolved') playResolved();
      else if (sound === 'coord') playCoord();
      else if (sound === 'soft') playSoft();
    }
  }), [pushToast, preferences, declinedCritical]);

  // Применяем персональный общий выключатель ДО запуска эффекта сирены.
  useEffect(() => setMuted(!preferences.soundEnabled), [preferences.soundEnabled]);

  // Сирена повторяется лишь для критических, тревога по которым не закрыта лично координатором.
  const alarmOn = started && preferences.criticalModal && alarmCritical.length > 0;
  const alertIds = alarmCritical.map((i) => i.id).join(',');
  useEffect(() => {
    if (!alarmOn || !preferences.siren || !preferences.soundEnabled) return;
    playSiren();
    if (preferences.sirenRepeatSeconds === 0) return;
    const t = setInterval(playSiren, preferences.sirenRepeatSeconds * 1000);
    return () => clearInterval(t);
  }, [alarmOn, alertIds, preferences.siren, preferences.sirenRepeatSeconds, preferences.soundEnabled]);

  // Мигающий заголовок — только для тревог, которые этот координатор ещё не закрыл.
  useEffect(() => {
    if (!preferences.blinkTitle || !alarmCritical.length) {
      document.title = activeCritical.length ? `● Критических: ${activeCritical.length} · Пульт МИ` : 'Пульт МИ';
      return;
    }
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? '🔴 КРИТИЧЕСКИЙ ИНЦИДЕНТ' : `Пульт МИ (${alarmCritical.length})`;
    }, 800);
    return () => clearInterval(t);
  }, [alarmCritical.length, activeCritical.length, preferences.blinkTitle]);

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
    setDeclinedCritical(readDeclinedCritical(name));
    setHiddenCriticalStripIds(readHiddenCriticalStrip(name));
    store.set('operator', name);
    setStarted(true);
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
  const coordUnacked = coord.items.filter((r) => r.unacked).length;
  const highRisky = high.items.filter((r) => r.sla.risk === 'overdue' || r.sla.risk === 'risk').length;
  const researchOnCoord = research.items.filter((r) => r.inc.assignedGroupName === COORD_GROUP).length;
  const kpis: Record<GroupKey, LaneKpi> = {
    critical: {
      sub: unackedCritical.length
        ? `Ждут подтверждения: ${unackedCritical.length}`
        : crit.active ? 'Все на контроле' : 'Активных нет',
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
    <div className={`app ${alarmOn ? 'has-alarm' : ''}`}>
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
        {preferences.criticalBanner && isCriticalStripHidden && (
          <button className="btn btn-quiet crit-strip-restore" onClick={showCriticalStrip}>
            Показать критические ({activeCritical.length})
          </button>
        )}
        {!layout.isDefault && <button className="btn btn-quiet" onClick={layout.reset}>Вернуть колонки на место</button>}
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

      {preferences.criticalBanner && activeCritical.length > 0 && !isCriticalStripHidden && (
        <div className="crit-strip" role="alert" aria-label="Активные критические инциденты">
          {activeCritical.map((i) => {
            const left = i.deadline ? Date.parse(i.deadline) - now : null;
            return (
              <button className="crit-strip-incident" key={i.id} onClick={() => openItsm(i.id)}>
                <b>Критический</b>
                <span className="crit-text">
                  {i.productName}: {i.header}.{' '}
                  {left === null ? 'Срок не задан' : left > 0 ? `Осталось ${fmtDuration(left, true)}` : `Просрочен на ${fmtDuration(-left, true)}`}
                </span>
                {acks[`crit:${i.id}`] && <span className="crit-ack">на контроле: {acks[`crit:${i.id}`].by}</span>}
              </button>
            );
          })}
          <button
            type="button"
            className="crit-strip-close"
            onClick={hideCriticalStrip}
            aria-label="Скрыть красную полосу только у меня"
            title="Скрыть полосу у себя. Другие координаторы продолжат её видеть"
          >
            ×
          </button>
        </div>
      )}

      {preferences.criticalModal && declinedUnacked.length > 0 && (
        <div className="crit-declined" role="status">
          <span>Не взяты на контроль: {declinedUnacked.length}. Окно и сирена отключены только в этом браузере; другие координаторы продолжат получать тревогу.</span>
          <button className="btn btn-quiet" onClick={restoreCriticalAlarm}>Показать тревогу снова</button>
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
      {alarmOn && <CriticalAlarm incidents={alarmCritical} now={now} operator={operator} onDecline={declineCritical} />}
      {!started && <StartOverlay name={operator} onStart={start} />}
    </div>
  );
}
