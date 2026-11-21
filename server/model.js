// Справочники и правила, общие для сервера, сида и симулятора.

export const COORD_GROUP = 'КЦ ИТ Координаторы Массовых Инцидентов';

// В данных ITSM: 7 = Завершен (Resolved), 10 = Закрыт (Closed), 20 = Исследование ситуации.
// (В incidents_attributes.json 7 и 10 перепутаны, ориентируемся на stateEnum в самих данных.)
export const STATES = {
  0: { state: 'Назначен', stateEnum: 'Assigned' },
  2: { state: 'Выполняется', stateEnum: 'WorkInProgress' },
  7: { state: 'Завершен', stateEnum: 'Resolved' },
  10: { state: 'Закрыт', stateEnum: 'Closed' },
  20: { state: 'Исследование ситуации', stateEnum: 'Research' },
};

export const ACTIVE_STATES = new Set([0, 2]);

export const PRIORITY = { 1: 'Низкий', 2: 'Средний', 3: 'Высокий', 4: 'Наивысший' };
export const URGENCY = { 1: 'Низкая', 2: 'Средняя', 3: 'Высокая', 4: 'Наивысшая' };
export const IMPACT = { 1: 'Низкое', 2: 'Среднее', 3: 'Высокое', 4: 'Наивысшее' };
export const SERVICE_TYPE = { 10: 'Клиентский', 20: 'Пользовательский', 30: 'Технологический' };

// Время на решение по приоритету (как в исходных данных: высокий 6 ч, средний 12 ч, низкий 14 дней).
export const SLA_HOURS = { 4: 3, 3: 6, 2: 12, 1: 24 * 14 };

export const DATE_FIELDS = ['submitDate', 'deadline', 'completionDate', 'lastAssignmentToTeamDateTime'];

export const isActive = (inc) => ACTIVE_STATES.has(Number(inc.stateId));
export const isCritical = (inc) => Number(inc.priorityId) === 4;
export const isCriticalActive = (inc) => isCritical(inc) && isActive(inc);
// Согласовано с категориями дашборда: завершённые (7) и закрытые (10) не требуют подтверждения.
export const isOnCoordinators = (inc) =>
  inc.assignedGroupName === COORD_GROUP && (isActive(inc) || Number(inc.stateId) === 20);

export const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const hours = (h) => h * 3600 * 1000;

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
