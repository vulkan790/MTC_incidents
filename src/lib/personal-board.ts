// Локальные настройки рабочего экрана, независимые для каждого координатора.
export const PIN_LIMIT = 3;
export const MIN_PANEL_SCALE = .5;
export const MAX_PANEL_SCALE = 2;
export const clampPanelScale = (value: number) => Math.min(MAX_PANEL_SCALE, Math.max(MIN_PANEL_SCALE, value));

export function boardStorageKey(operator: string, name: string) {
  return `mi:${name}:v1:${operator.trim().toLocaleLowerCase('ru-RU') || 'координатор'}`;
}
export function readBoardValue(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
export function saveBoardValue(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Приватный режим. */ }
}
export function readPins(key: string): string[] {
  const value = readBoardValue(key);
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))].slice(0, PIN_LIMIT) : [];
}
export function togglePin(pins: string[], id: string): string[] {
  if (pins.includes(id)) return pins.filter((pin) => pin !== id);
  return pins.length < PIN_LIMIT ? [...pins, id] : pins;
}
export function prunePins(pins: string[], eligible: ReadonlySet<string>): string[] {
  const next = pins.filter((id) => eligible.has(id));
  return next.length === pins.length ? pins : next;
}
export function pinnedFirst<T>(items: readonly T[], pins: readonly string[], getId: (item: T) => string): T[] {
  const rank = new Map(pins.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(getId(a)) ?? PIN_LIMIT) - (rank.get(getId(b)) ?? PIN_LIMIT));
}
export type ResizablePanel = 'events' | 'mail';
export type PanelScales = Record<ResizablePanel, number>;
export function readPanelScales(key: string): PanelScales {
  const raw = readBoardValue(key) as Partial<PanelScales> | null;
  const safe = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? clampPanelScale(v) : 1;
  return { events: safe(raw?.events), mail: safe(raw?.mail) };
}
