// Правила распределения по группам, сроки и форматирование.
import type { Incident } from '../types';

export const COORD_GROUP = 'КЦ ИТ Координаторы Массовых Инцидентов';

export const STATE = { assigned: 0, inProgress: 2, resolved: 7, closed: 10, research: 20 } as const;

export const isActive = (i: Incident) => i.stateId === STATE.assigned || i.stateId === STATE.inProgress;
export const isCritical = (i: Incident) => i.priorityId === 4;
export const isCriticalActive = (i: Incident) => isCritical(i) && isActive(i);

export type GroupKey = 'critical' | 'coord' | 'high' | 'research';

// Один инцидент может входить сразу в несколько групп.
export const GROUP_RULES: Record<GroupKey, (i: Incident, now: number) => boolean> = {
  // Критические — только активные. Решённые (stateId = 7) здесь больше не показываются.
  critical: (i) => isCritical(i) && isActive(i),
  // На координаторах: активные и исследования. Решённые и закрытые исключены.
  coord: (i) => i.assignedGroupName === COORD_GROUP && (isActive(i) || i.stateId === STATE.research),
  // Активные с высоким приоритетом: каждый может перерасти в критический.
  high: (i) => i.priorityId === 3 && isActive(i),
  // Решены, идёт разбор причин.
  research: (i) => i.stateId === STATE.research,
};

export const GROUPS: { key: GroupKey; title: string; hint: string }[] = [
  { key: 'critical', title: 'Критические', hint: 'Только активные инциденты с приоритетом «Наивысший»' },
  { key: 'coord', title: 'На координаторах', hint: 'Передайте в профильную команду' },
  { key: 'high', title: 'Высокий приоритет', hint: 'Могут перерасти в критические' },
  { key: 'research', title: 'Исследование ситуации', hint: 'Решены, идёт разбор причин' },
];

export function groupsOf(i: Incident, now: number): GroupKey[] {
  return (Object.keys(GROUP_RULES) as GroupKey[]).filter((k) => GROUP_RULES[k](i, now));
}

// ---------- Сроки и прогноз ----------
export type Risk = 'overdue' | 'risk' | 'ok' | 'none';
export type DeadlineFilter = 'all' | 'overdue' | 'risk';
export const DEADLINE_RISK_MS = 2 * 60 * 60 * 1000;

// Один критерий для счётчиков, карточек и фильтра. Прогноз — отдельно.
export function deadlineRisk(i: Incident, now: number): Risk {
  if (!isActive(i) || !i.deadline) return 'none';
  const left = Date.parse(i.deadline) - now;
  if (!Number.isFinite(left)) return 'none';
  if (left <= 0) return 'overdue';
  return left <= DEADLINE_RISK_MS ? 'risk' : 'ok';
}

export function matchesDeadline(i: Incident, now: number, filter: DeadlineFilter): boolean {
  return filter === 'all' || deadlineRisk(i, now) === filter;
}

// Контроль сроков охватывает активные карточки основных категорий.
// Если инцидент входит в несколько категорий, он учитывается в каждой из них,
// так же как отображается на доске.
export function dashboardDeadlineSummary(incidents: Incident[], now: number) {
  let active = 0, overdue = 0, risk = 0;
  for (const i of incidents) {
    if (!isActive(i)) continue;
    for (const _group of groupsOf(i, now)) {
      active++;
      const state = deadlineRisk(i, now);
      if (state === 'overdue') overdue++;
      else if (state === 'risk') risk++;
    }
  }
  return { active, overdue, risk };
}

export interface Sla {
  risk: Risk;
  left: number | null; // мс до срока (отрицательное — просрочен)
  fraction: number | null; // доля израсходованного времени
  typical: number | null; // типичное время решения для такого приоритета
  forecast: boolean; // прогноз нарушения срока
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Типичная длительность решения по приоритетам — по истории решённых инцидентов в той же выгрузке.
export function resolutionStats(list: Incident[]) {
  const by: Record<number, number[]> = {};
  const all: number[] = [];
  for (const i of list) {
    if (!i.completionDate) continue;
    const d = Date.parse(i.completionDate) - Date.parse(i.submitDate);
    if (d <= 0) continue;
    (by[i.priorityId] ??= []).push(d);
    all.push(d);
  }
  const overall = median(all) ?? 2 * 3600e3;
  const res: Record<number, number> = {};
  for (const p of [1, 2, 3, 4]) res[p] = median(by[p] ?? []) ?? median(by[p - 1] ?? []) ?? overall;
  return res;
}

export function slaOf(i: Incident, now: number, stats: Record<number, number>): Sla {
  const risk = deadlineRisk(i, now);
  if (risk === 'none' || !i.deadline) return { risk: 'none', left: null, fraction: null, typical: null, forecast: false };
  const end = Date.parse(i.deadline);
  const parsedStart = Date.parse(i.submitDate);
  const start = Number.isFinite(parsedStart) ? parsedStart : now;
  const total = Math.max(end - start, 60e3);
  const left = end - now;
  const fraction = Math.min(Math.max((now - start) / total, 0), 1.5);
  const typical = Math.min(stats[i.priorityId] ?? total / 2, total / 2);
  // Прогноз: оставшегося времени меньше, чем обычно уходит на решение,
  // или инцидент до сих пор никто не взял в работу, а половина срока уже прошла.
  const forecast = left > 0 && (left < typical || (i.stateId === STATE.assigned && fraction > 0.5));
  return { risk, left, fraction, typical, forecast };
}

// ---------- Форматирование ----------
export function fmtDuration(ms: number, withSeconds = false): string {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  let out: string;
  if (withSeconds && d === 0) out = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  else if (d > 0) out = `${d} дн ${h} ч`;
  else if (h > 0) out = `${h} ч ${m} мин`;
  else out = `${m} мин`;
  return neg ? `−${out}` : out;
}

export const fmtAgo = (iso: string, now: number) => {
  const ms = now - Date.parse(iso);
  if (ms < 60e3) return 'только что';
  return `${fmtDuration(ms)} назад`;
};

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function fmtTime(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, new Date(now))) return `сегодня ${t}`;
  if (sameDay(d, new Date(now - 86400e3))) return `вчера ${t}`;
  if (sameDay(d, new Date(now + 86400e3))) return `завтра ${t}`;
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${t}`;
}

export const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// «Алиса в Стране Чудес (alice)» → «Алиса в Стране Чудес»
export const personName = (p: string | null | undefined) => (p ? p.replace(/\s*\([^)]*\)\s*$/, '') : '');

export const serviceShort = (i: Incident) => i.service.replace(/^\[[^\]]+\]\s*/, '');

export const itsmUrl = (id: string) => `/itsm/${encodeURIComponent(id)}`;

export function openItsm(id: string) {
  // Одна вкладка ITSM на все переходы, чтобы не плодить вкладки.
  const w = window.open(itsmUrl(id), 'itsm');
  w?.focus();
}
