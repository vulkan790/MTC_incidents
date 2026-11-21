// Состояние выбранного координатора и начатой смены.
// sessionStorage фиксирует координатора внутри вкладки: две вкладки с разными
// координаторами не подменяют друг другу имя после навигации по страницам.
// localStorage позволяет восстановить смену после перезагрузки и в новой вкладке.
// Это локальная демо-сессия, а НЕ серверная авторизация.
const SHARED_OPERATOR_KEY = 'operator'; // обратная совместимость с существующим проектом
const SHARED_ACTIVE_KEY = 'mi:shift:active:v1';
const TAB_OPERATOR_KEY = 'mi:shift:operator:v1';
const TAB_ACTIVE_KEY = 'mi:shift:started:v1';
export const SHIFT_CHANGED_EVENT = 'mi:shift-changed';
const announceShift = () => window.dispatchEvent(new Event(SHIFT_CHANGED_EVENT));

type StorageName = 'local' | 'session';

function storageOf(kind: StorageName): Storage | null {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage; }
  catch { return null; }
}
function read(kind: StorageName, key: string): string | null {
  try { return storageOf(kind)?.getItem(key) ?? null; }
  catch { return null; }
}
function write(kind: StorageName, key: string, value: string): void {
  try { storageOf(kind)?.setItem(key, value); }
  catch { /* Хранилище недоступно — остаётся состояние React. */ }
}

/** Имя текущего координатора; после первого чтения закрепляется за вкладкой. */
export function readOperator(): string {
  const tabOperator = read('session', TAB_OPERATOR_KEY);
  if (tabOperator !== null) return tabOperator;

  const saved = read('local', SHARED_OPERATOR_KEY) || '';
  if (saved) write('session', TAB_OPERATOR_KEY, saved);
  return saved;
}

/** Восстановить вход на дашборд без повторного экрана «Начать смену». */
export function isShiftStarted(): boolean {
  const operator = readOperator();
  if (!operator) return false;

  const tabState = read('session', TAB_ACTIVE_KEY);
  if (tabState !== null) return tabState === 'yes';

  const commonState = read('local', SHARED_ACTIVE_KEY);
  // Миграция с предыдущих сборок: там записывали только имя оператора.
  const started = commonState === 'yes' || (commonState === null && !!operator);
  write('session', TAB_ACTIVE_KEY, started ? 'yes' : 'no');
  return started;
}

/** Обновить имя только в текущей вкладке и значение по умолчанию для новых вкладок. */
function storeOperator(name: string): void {
  const value = name.trim().slice(0, 60) || 'Координатор';
  write('session', TAB_OPERATOR_KEY, value);
  write('local', SHARED_OPERATOR_KEY, value);
}

export function rememberOperator(name: string): void {
  storeOperator(name);
  announceShift();
}

/** Начало смены — только после явного нажатия «Начать смену». */
export function startShift(name: string): void {
  storeOperator(name);
  write('session', TAB_ACTIVE_KEY, 'yes');
  write('local', SHARED_ACTIVE_KEY, 'yes');
  announceShift();
}

/** Имя перед настройкой уведомлений, если смена ещё не была начата. */
export function rememberOperatorBeforeStart(name: string): void {
  storeOperator(name);
  if (read('session', TAB_ACTIVE_KEY) !== 'yes') write('session', TAB_ACTIVE_KEY, 'no');
  announceShift();
}
