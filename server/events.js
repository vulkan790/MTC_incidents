// Сравнение двух снимков JSON и формирование ленты событий.
import { COORD_GROUP, isActive, isCritical, isCriticalActive } from './model.js';

let seq = 0;
const ev = (type, inc, text, level, extra = {}) => ({
  id: `${Date.now().toString(36)}-${(seq++).toString(36)}`,
  at: new Date().toISOString(),
  type,
  incidentId: inc.id,
  product: inc.productName,
  text,
  level, // critical | warn | ok | info
  ...extra,
});

const fmtDelta = (ms) => {
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return [d && `${d} дн`, h && `${h} ч`, mm && `${mm} мин`].filter(Boolean).join(' ') || 'меньше минуты';
};

export function diffIncidents(prev, next) {
  const events = [];
  const before = new Map(prev.map((i) => [i.id, i]));
  const after = new Map(next.map((i) => [i.id, i]));

  for (const n of next) {
    const p = before.get(n.id);
    if (!p) {
      if (isCriticalActive(n)) events.push(ev('critical_new', n, 'Новый критический инцидент', 'critical'));
      else events.push(ev('created', n, `Новый инцидент, приоритет «${n.priority}»`, 'info'));
      if (n.assignedGroupName === COORD_GROUP) events.push(ev('coord_assigned', n, 'Назначен на координаторов', 'warn'));
      continue;
    }

    if (isCriticalActive(n) && !isCriticalActive(p)) {
      events.push(ev('critical_new', n,
        isCritical(p) ? 'Критический инцидент снова в работе' : `Приоритет повышен до критического (был «${p.priority}»)`,
        'critical'));
    } else if (isCritical(p) && isActive(p) && !isCriticalActive(n)) {
      if (!isActive(n)) events.push(ev('critical_resolved', n, `Критический инцидент решён, статус «${n.state}»`, 'ok'));
      else events.push(ev('priority_changed', n, `Приоритет понижен: «${p.priority}» → «${n.priority}»`, 'info'));
    } else if (Number(p.priorityId) !== Number(n.priorityId)) {
      const up = Number(n.priorityId) > Number(p.priorityId);
      events.push(ev('priority_changed', n, `Приоритет: «${p.priority}» → «${n.priority}»`, up ? 'warn' : 'info'));
    }

    if (p.assignedGroupName !== n.assignedGroupName) {
      if (n.assignedGroupName === COORD_GROUP) {
        events.push(ev('coord_assigned', n, `Назначен на координаторов (из «${p.assignedGroupName}»)`, 'warn'));
      } else if (p.assignedGroupName === COORD_GROUP) {
        events.push(ev('coord_handed_off', n, `Координаторы передали в «${n.assignedGroupName}»`, 'ok', { to: n.assignedGroupName }));
      } else {
        events.push(ev('reassigned', n, `Переназначен: «${p.assignedGroupName}» → «${n.assignedGroupName}»`, 'info'));
      }
    } else if (p.assignedEmployee !== n.assignedEmployee && n.assignedEmployee) {
      events.push(ev('employee_changed', n, `Исполнитель: ${n.assignedEmployee}`, 'info'));
    }

    const stateHandled = isCritical(p) && isActive(p) && !isActive(n);
    if (Number(p.stateId) !== Number(n.stateId) && !stateHandled && !(isCriticalActive(n) && !isCriticalActive(p))) {
      const level = Number(n.stateId) === 7 || Number(n.stateId) === 10 ? 'ok' : 'info';
      events.push(ev('state_changed', n, `Статус: «${p.state}» → «${n.state}»`, level));
    }

    if (p.deadline !== n.deadline) {
      const delta = Date.parse(n.deadline) - Date.parse(p.deadline);
      const text = !n.deadline ? 'Срок решения снят'
        : !p.deadline ? 'Назначен срок решения'
        : `Срок решения ${delta > 0 ? 'продлён' : 'сокращён'} на ${fmtDelta(Math.abs(delta))}`;
      events.push(ev('deadline_changed', n, text, delta > 0 ? 'info' : 'warn', { from: p.deadline, to: n.deadline }));
    }
  }

  for (const p of prev) {
    if (!after.has(p.id)) events.push(ev('removed', p, 'Инцидент удалён из выгрузки', 'info'));
  }
  return events;
}

export function diffMail(prev, next) {
  const known = new Set(prev.map((m) => m.id));
  return next
    .filter((m) => !known.has(m.id))
    .map((m) => ({
      id: `${Date.now().toString(36)}-${(seq++).toString(36)}`,
      at: new Date().toISOString(),
      type: 'mail',
      incidentId: m.incidentId,
      product: null,
      text: `Письмо: ${m.subject}`,
      level: m.important ? 'warn' : 'info',
      mailId: m.id,
    }));
}
