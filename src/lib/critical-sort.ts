// Персональная сортировка инцидентов во всех категориях.
// По умолчанию сначала непринятые, далее — самые давно поступившие.
// Закрепление действует внутри группы приоритета, но не поднимает
// принятый критический выше непринятого.
export type CriticalPriority = 'unassigned' | 'time';
export type CriticalTimeOrder = 'oldest' | 'newest';
export type CriticalSortSettings = { priority: CriticalPriority; timeOrder: CriticalTimeOrder };

export const DEFAULT_CRITICAL_SORT: CriticalSortSettings = { priority: 'unassigned', timeOrder: 'oldest' };

export function normalizeCriticalSort(value: unknown): CriticalSortSettings {
  if (!value || typeof value !== 'object') return DEFAULT_CRITICAL_SORT;
  const raw = value as Partial<CriticalSortSettings>;
  return {
    priority: raw.priority === 'time' ? 'time' : 'unassigned',
    timeOrder: raw.timeOrder === 'newest' ? 'newest' : 'oldest',
  };
}

interface CriticalRow {
  criticalUnacked?: boolean;
  unacked?: boolean;
  inc: { id: string; submitDate: string; assignedEmployee?: string | null };
}

export function sortCriticalRows<T extends CriticalRow>(
  rows: readonly T[],
  pinned: readonly string[],
  settings: CriticalSortSettings,
  group: string = 'critical',
): T[] {
  const rank = new Map(pinned.map((id, index) => [id, index]));
  const time = (row: T) => {
    const n = Date.parse(row.inc.submitDate);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };
  return [...rows].sort((a, b) => {
    // Отсутствие ответственного (нет серверного crit:INC) — выше принятого.
    const missing = (row: T) => group === 'critical'
      ? !!row.criticalUnacked
      : group === 'coord'
        ? !!row.unacked
        : !String(row.inc.assignedEmployee ?? '').trim();
    if (settings.priority === 'unassigned' && missing(a) !== missing(b)) {
      return missing(a) ? -1 : 1;
    }
    // Не ломаем закрепления: внутри одинакового приоритета они сверху.
    const aRank = rank.get(a.inc.id) ?? Infinity;
    const bRank = rank.get(b.inc.id) ?? Infinity;
    if (aRank !== bRank) return aRank - bRank;

    const difference = time(a) - time(b);
    if (difference) return settings.timeOrder === 'oldest' ? difference : -difference;
    return a.inc.id.localeCompare(b.inc.id);
  });
}
