// Единый центр оповещений: работает на всех страницах приложения.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Incident, Ack } from '../types';
import { CriticalAlarm } from '../components/CriticalAlarm';
import { Toasts, type Toast } from '../components/Toasts';
import { useLiveState, useNow } from './live';
import { fmtDuration, openItsm, STATE, isCriticalActive } from './model';
import { matchesCriticalAlert, useNotificationSettings } from './notification-settings';
import { isShiftStarted, readOperator, SHIFT_CHANGED_EVENT } from './operator-session';
import { audioReady, playCoord, playResolved, playSiren, playSoft, setMuted, unlockAudio } from './sound';

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* только локальные настройки */ }
}
function readIds(key: string): string[] {
  const value = load<unknown>(key, []);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}
function desktop(title: string, body: string, href?: string) {
  try {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, requireInteraction: true, tag: `${title}:${href || body}` });
    n.onclick = () => { window.focus(); if (href) location.assign(href); n.close(); };
  } catch { /* разрешение или поддержка браузера отсутствуют */ }
}
const incidentHref = (id: string | null) => id ? `/itsm/${encodeURIComponent(id)}` : undefined;
const EMPTY_INCIDENTS: Incident[] = [];
const EMPTY_ACKS: Record<string, Ack> = {};
interface AlertContext {
  operator: string; started: boolean; alarmOn: boolean;
  changes: Record<string, number>; strips: Incident[];
  acks: Record<string, Ack>; hideStrip: (id: string) => void;
}
const Context = createContext<AlertContext | null>(null);
export function useGlobalAlerts() {
  const value = useContext(Context);
  if (!value) throw new Error('GlobalAlertsProvider is missing');
  return value;
}

export function CriticalStrips() {
  const { strips, acks, hideStrip } = useGlobalAlerts();
  const now = useNow(1000);
  if (!strips.length) return null;
  return <div className="crit-strips" aria-label="Активные критические инциденты">
    {strips.map((i) => {
      const left = i.deadline ? Date.parse(i.deadline) - now : null;
      return <div className="crit-strip" role="alert" key={i.id}>
        <button type="button" className="crit-strip-incident" onClick={() => openItsm(i.id)}>
          <b>Критический · {i.id}</b>
          <span className="crit-text">{i.productName}: {i.header}.{' '}
            {left === null ? 'Срок не задан' : left > 0 ? `Осталось ${fmtDuration(left, true)}` : `Просрочен на ${fmtDuration(-left, true)}`}
          </span>
          {acks[`crit:${i.id}`] && <span className="crit-ack">на контроле: {acks[`crit:${i.id}`].by}</span>}
        </button>
        <button type="button" className="crit-strip-close" onClick={() => hideStrip(i.id)} aria-label={`Скрыть полосу ${i.id}`} title="Скрыть только у себя">×</button>
      </div>;
    })}
  </div>;
}

type Props = { children: ReactNode; outsideDashboard: boolean; baseTitle: string };
export function GlobalAlertsProvider(props: Props) {
  const [session, setSession] = useState(() => ({ operator: readOperator(), started: isShiftStarted() }));
  useEffect(() => {
    const sync = () => setSession({ operator: readOperator(), started: isShiftStarted() });
    window.addEventListener(SHIFT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SHIFT_CHANGED_EVENT, sync);
  }, []);
  // При смене координатора состояние отказов и уведомлений не переносится к другому имени.
  return <AlertRuntime key={`${session.operator}:${session.started}`} {...props} {...session} />;
}

function AlertRuntime({ children, outsideDashboard, baseTitle, operator, started }: Props & { operator: string; started: boolean }) {
  const { data } = useLiveState();
  const now = useNow(1000);
  const { settings: preferences } = useNotificationSettings(operator);
  const incidents = data?.incidents ?? EMPTY_INCIDENTS;
  const acks = data?.acks ?? EMPTY_ACKS;
  const suffix = operator.trim().toLocaleLowerCase('ru-RU') || 'координатор';
  // Сохраняем совместимость с предыдущими версиями приложения.
  const declinedKey = `mi:declined-critical:${operator}`;
  const stripKey = `mi:hidden-critical-strip:${suffix}`;
  const eventsKey = `mi:global-events:${suffix}`;
  const pendingKey = `mi:global-pending:${suffix}`;
  const toastsKey = `mi:global-toasts:${suffix}`;
  const [declined, setDeclined] = useState(() => readIds(declinedKey));
  const [hidden, setHidden] = useState(() => readIds(stripKey));
  const [toasts, setToasts] = useState<Toast[]>(() => {
    const old = load<Toast[]>(toastsKey, []);
    return started && Array.isArray(old) ? old.filter(t => (t.expiresAt ?? 0) > Date.now()).map(t => ({ ...t, ttl: (t.expiresAt ?? 0) - Date.now() })) : [];
  });
  const [changes, setChanges] = useState<Record<string, number>>({});
  const seen = useRef<string[] | null>(load<string[] | null>(eventsKey, null));
  const priorPending = useRef(readIds(pendingKey));
  const audioUnlocked = useRef(false);
  const lastSirenAt = useRef(0);
  const sirenOnceKey = useRef<string | null>(null);
  const activeCritical = useMemo(() => incidents.filter(isCriticalActive), [incidents]);
  const pending = useMemo(() => incidents.filter(i => matchesCriticalAlert(i, preferences) && !acks[`crit:${i.id}`] && !declined.includes(i.id))
    .sort((a,b) => Date.parse(a.submitDate) - Date.parse(b.submitDate)), [incidents, preferences, acks, declined]);
  const pendingIds = pending.map(i => i.id).join(',');
  const alarmOn = started && preferences.criticalModal && pending.length > 0;
  const sirenOn = started && preferences.siren && preferences.soundEnabled && pending.length > 0;
  const soundCurrentSiren = useCallback(() => {
    if (!audioReady() || Date.now() - lastSirenAt.current < 1000) return;
    lastSirenAt.current = Date.now();
    playSiren();
  }, []);
  const playSirenOnce = useCallback(() => {
    if (!audioReady() || !pendingIds || sirenOnceKey.current === pendingIds) return true;
    sirenOnceKey.current = pendingIds;
    soundCurrentSiren();
    return true;
  }, [pendingIds, soundCurrentSiren]);
  useEffect(() => {
    if (!sirenOn || !pending.length) sirenOnceKey.current = null;
  }, [sirenOn, pending.length]);
  const strips = started && preferences.criticalBanner ? activeCritical.filter(i => !hidden.includes(i.id)) : [];

  const closeToast = useCallback((id: string) => {
    setToasts(old => old.filter(t => t.id !== id));
  }, []);
  // Скрываем только текущие всплывающие сообщения, не подтверждая инциденты.
  // Сохранение сразу исключает восстановление закрытой стопки при смене страницы.
  const closeAllToasts = useCallback(() => {
    save(toastsKey, []);
    setToasts([]);
  }, [toastsKey]);
  const hideStrip = (id: string) => {
    const next = [...new Set([...hidden, id])];
    save(stripKey, next); setHidden(next);
  };
  const decline = (id: string) => {
    const next = [...new Set([...declined, id])];
    save(declinedKey, next); setDeclined(next);
    setToasts(old => old.filter(t => t.kind !== 'critical' || t.incidentId !== id));
  };
  useEffect(() => { save(toastsKey, toasts); }, [toastsKey, toasts]);

  // Решение, удаление или понижение приоритета сбрасывает личный отказ/скрытие.
  useEffect(() => {
    if (!data) return;
    const ids = new Set(incidents.filter(i => i.priorityId === 4 && i.stateId !== STATE.resolved && i.stateId !== STATE.closed).map(i => i.id));
    const a = declined.filter(id => ids.has(id));
    const b = hidden.filter(id => ids.has(id));
    if (a.length !== declined.length) { save(declinedKey, a); setDeclined(a); }
    if (b.length !== hidden.length) { save(stripKey, b); setHidden(b); }
    setToasts(old => {
      const next = old.filter(t => t.kind !== 'critical' || pending.some(i => i.id === t.incidentId));
      return next.length === old.length ? old : next;
    });
  }, [data, incidents, declined, hidden, declinedKey, stripKey, pending]);

  // Обрабатываем ленту из общего кэша: и WebSocket, и резервный HTTP-опрос.
  // При переходе на другую страницу cursor и ещё живые toast остаются в sessionStorage.
  useEffect(() => {
    if (!data || !started) return;
    const old = seen.current;
    const fresh = old === null ? [] : data.events.filter(e => !old.includes(e.id)).reverse();
    seen.current = [...new Set([...data.events.map(e => e.id), ...(old ?? [])])].slice(0, 300);
    save(eventsKey, seen.current);
    const added: Toast[] = [];
    const stamp = Date.now();
    const push = (t: Omit<Toast, 'expiresAt'>) => added.push({ ...t, expiresAt: stamp + t.ttl });
    let sound: 'resolved' | 'coord' | 'soft' | null = null;
    if (fresh.length) setChanges(old => {
      const next = { ...old };
      for (const e of fresh) if (e.incidentId && e.type !== 'mail') next[e.incidentId] = stamp;
      return next;
    });
    for (const e of fresh) {
      const where = `${e.incidentId ?? ''}${e.product ? `, ${e.product}` : ''}`;
      const href = incidentHref(e.incidentId);
      const common = { id: e.id, incidentId: e.incidentId };
      if (e.type === 'critical_resolved') {
        if (preferences.resolvedToasts) { push({ ...common, kind: 'resolved', title: 'Критический инцидент решён', text: where, ttl: 15000 }); sound = 'resolved'; }
        if (preferences.desktopOther) desktop('Критический инцидент решён', where, href);
      } else if (e.type === 'coord_assigned') {
        if (preferences.coordToasts) { push({ ...common, kind: 'coord', title: 'Назначен на координаторов', text: `${where}. Передайте в профильную команду`, ttl: 20000 }); sound ??= 'coord'; }
        if (preferences.desktopOther) desktop('Назначен на координаторов', where, href);
      } else if (e.type === 'coord_handed_off') {
        push({ ...common, kind: 'handoff', title: `Передан в «${e.to ?? 'команду'}»`, text: where, ttl: 7000 });
      } else if (e.type === 'mail') {
        const mail = data.mail.find(m => m.id === e.mailId);
        const potential = Boolean(mail?.analysis?.isPotential && !mail?.incidentId);
        if (mail?.folder === 'spam' || (e.level !== 'warn' && !potential)) continue;
        const mailHref = e.mailId ? `/cabinet/mail/${encodeURIComponent(e.mailId)}` : href;
        const title = potential ? 'Потенциальный инцидент в почте' : 'Важное письмо';
        if (preferences.mailToasts) { push({ ...common, kind: 'mail', title, text: e.text.replace(/^Письмо: /, ''), mailId: e.mailId, ttl: 10000 }); sound ??= 'soft'; }
        if (preferences.desktopOther && preferences.mailToasts) desktop(title, e.text, mailHref);
      } else if (e.type === 'priority_changed' && e.level === 'warn') sound ??= 'soft';
    }
    // Срабатывает также при входе в выбранный статус/команду (не только critical_new).
    for (const i of pending) {
      if (priorPending.current.includes(i.id)) continue;
      const text = `${i.id} · ${i.productName}: ${i.header}`;
      if (preferences.criticalToasts) push({ id: `critical:${i.id}:${stamp}`, kind: 'critical', title: 'Критический инцидент', text, incidentId: i.id, ttl: 20000 });
      if (preferences.criticalDesktop) desktop('КРИТИЧЕСКИЙ ИНЦИДЕНТ', text, incidentHref(i.id));
    }
    priorPending.current = pending.map(i => i.id);
    save(pendingKey, priorPending.current);
    if (added.length) setToasts(old => [...added.reverse(), ...old].slice(0, 5));
    if (preferences.secondarySounds && preferences.soundEnabled) {
      if (sound === 'resolved') playResolved(); else if (sound === 'coord') playCoord(); else if (sound === 'soft') playSoft();
    }
  }, [data, started, preferences, pending, eventsKey, pendingKey]);

  useEffect(() => setMuted(!preferences.soundEnabled), [preferences.soundEnabled]);
  useEffect(() => {
    if (!started) return;
    let active = true;
    const resume = () => {
      if (audioUnlocked.current) return;
      try {
        void unlockAudio().then(() => {
          if (!active || !audioReady()) return;
          audioUnlocked.current = true;
          if (sirenOn) {
            if (preferences.sirenRepeatSeconds === 0) playSirenOnce();
            else soundCurrentSiren();
          }
        }).catch(() => {});
      } catch { /* браузер блокирует звук */ }
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    return () => { active = false; window.removeEventListener('pointerdown', resume); window.removeEventListener('keydown', resume); };
  }, [started, sirenOn, preferences.sirenRepeatSeconds, playSirenOnce, soundCurrentSiren]);
  useEffect(() => {
    if (!sirenOn) return;
    // После «Начать смену» AudioContext может асинхронно перейти в running.
    // Даже при режиме без повторов ждём этого перехода, но не создаём звук без жеста.
    const repeatSeconds = preferences.sirenRepeatSeconds;
    const initial = () => {
      if (!audioReady()) return false;
      audioUnlocked.current = true;
      if (repeatSeconds === 0) playSirenOnce(); else soundCurrentSiren();
      return true;
    };
    let firstTimer: ReturnType<typeof setInterval> | undefined;
    if (!initial()) firstTimer = setInterval(() => { if (initial()) clearInterval(firstTimer); }, 250);
    const timer = repeatSeconds > 0 ? setInterval(soundCurrentSiren, repeatSeconds * 1000) : undefined;
    return () => { clearInterval(firstTimer); clearInterval(timer); };
  }, [sirenOn, pendingIds, preferences.sirenRepeatSeconds, playSirenOnce, soundCurrentSiren]);
  useEffect(() => {
    document.title = baseTitle;
    if (!started || !preferences.blinkTitle || !pending.length) return;
    let red = true;
    document.title = `🔴 КРИТИЧЕСКИЙ (${pending.length}) · ${baseTitle}`;
    const timer = setInterval(() => { red = !red; document.title = red ? `🔴 КРИТИЧЕСКИЙ (${pending.length}) · ${baseTitle}` : baseTitle; }, 800);
    return () => { clearInterval(timer); document.title = baseTitle; };
  }, [baseTitle, started, preferences.blinkTitle, pending.length]);

  return <Context.Provider value={{ operator, started, alarmOn, changes, strips, acks, hideStrip }}>
    {outsideDashboard && strips.length > 0 && <div className="global-critical-strips"><CriticalStrips /></div>}
    {children}
    {started && <Toasts toasts={toasts} onClose={closeToast} onCloseAll={closeAllToasts} />}
    {alarmOn && <CriticalAlarm incidents={pending} now={now} operator={operator} onDecline={decline} />}
  </Context.Provider>;
}
