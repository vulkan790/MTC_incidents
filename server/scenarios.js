// Сценарии изменений «со стороны ITSM» и почты.
// Используются демо-панелью (POST /api/demo/:name) и симулятором (npm run simulate).
// Каждый сценарий меняет файл data/incidents.json (или data/mail.json), а сервер подхватывает это как внешнее изменение.
import {
  COORD_GROUP, STATES, PRIORITY, URGENCY, IMPACT, SERVICE_TYPE, SLA_HOURS,
  isActive, isCritical, isCriticalActive, iso, hours, pick,
} from './model.js';
import { FILES, readJson, updateIncidents, updateMail } from './store.js';

const source = () => readJson(FILES.source, []);

const PEOPLE = [
  'Пятачок (piglet)', 'Кот Матроскин (matrosov_kot)', 'Кощей Бессмертный (koschei)', 'Буратино (buratino)',
  'Кеплер (kepler)', 'Змей Горыныч (zmej)', 'Карлсон (karlsson)', 'Муми-Тролль (mumitroll)',
  'Малыш Хоббит (hobbit)', 'Шарик (sharik_dog)', 'Лисичка-сестричка (lisichka)', 'Василиса Премудрая (vasilisa)',
  'Медведь Барсик (barsik)', 'Алиса в Стране Чудес (alice)', 'Винни Пух (winnie)', 'Голубая птица (bluebird)',
  'Красная Шапочка (redriding)', 'Синяя Борода (bluebeard)', 'Иван Царевич (ivan_carevich)',
];
const COORDINATORS = ['Дядя Фёдор (unclefedor)', 'Василиса Премудрая (vasilisa)', 'Иван Царевич (ivan_carevich)'];
const CHANNELS = ['Анонимное письмо', 'Жалоба от народа', 'Мониторинг 9го королевства'];

const loginOf = (person) => person?.match(/\(([^)]+)\)/)?.[1] ?? null;

export function teams(list = source()) {
  const all = new Set(list.map((i) => i.assignedGroupName));
  all.delete(COORD_GROUP);
  all.delete('AutoClosedMi');
  return [...all].sort((a, b) => a.localeCompare(b, 'ru'));
}

function nextId(list) {
  const max = list.reduce((m, i) => Math.max(m, Number(String(i.id).replace(/\D/g, '')) || 0), 0);
  return 'INC' + String(max + 1 + Math.floor(Math.random() * 40)).padStart(12, '0');
}

const CRITICAL_HEADERS = [
  (s) => `Полная недоступность: ${s.scenarioName}`,
  (s) => `Массовый отказ ${s.scenarioName} у клиентов`,
  (s) => `Авария: ${s.productName} не отвечает`,
];
const REGULAR_HEADERS = [
  (s) => `Неисправность: ${s.scenarioName}`,
  (s) => `Деградация ${s.scenarioName}`,
  (s) => `Отказ ${s.scenarioName} (${s.service.replace(/^\[[^\]]+\]\s*/, '')})`,
];

// Новый инцидент на основе реального продукта/сервиса из исходной выгрузки.
export function makeIncident(list, { priorityId = 2, group, now = Date.now() } = {}) {
  const tpl = pick(source());
  const critical = priorityId === 4;
  const header = pick(critical ? CRITICAL_HEADERS : REGULAR_HEADERS)(tpl);
  const initiator = pick(PEOPLE);
  const assignedGroupName = group ?? pick(teams());
  const employee = assignedGroupName === COORD_GROUP ? pick(COORDINATORS) : pick([null, pick(PEOPLE)]);
  const serviceTypeId = critical ? 10 : pick([10, 20, 30]);
  return {
    sysId: String(179400000000000000 + Math.floor(Math.random() * 1e14)),
    id: nextId(list),
    ...STATES[0],
    stateId: 0,
    stateReason: 'Нет',
    stateReasonId: '1',
    submitDate: iso(now),
    deadline: iso(now + hours(SLA_HOURS[priorityId])),
    completionDate: null,
    lastAssignmentToTeamDateTime: iso(now),
    header,
    description: critical
      ? `Массовые обращения клиентов: ${tpl.productName} — ${tpl.scenarioName} недоступен. Затронуты клиентские сценарии, требуется немедленная реакция.`
      : `Автоматический алерт: ${tpl.scenarioName} в продукте ${tpl.productName} показывает отклонения от нормы.`,
    shortDescription: critical ? `${tpl.scenarioName} недоступен для клиентов.` : `Отклонение в работе ${tpl.scenarioName}.`,
    assignedGroupName,
    assignedEmployee: employee,
    assignedEmployeeLogin: loginOf(employee),
    initiatorName: initiator,
    initiatorLogin: loginOf(initiator),
    isEffect: false,
    isReason: false,
    isDouble: false,
    isMaster: critical,
    incType: 'МИ',
    serviceTypeId,
    serviceType: SERVICE_TYPE[serviceTypeId],
    priorityId,
    priority: PRIORITY[priorityId],
    urgencyId: critical ? 4 : Math.min(priorityId + 1, 4),
    urgency: URGENCY[critical ? 4 : Math.min(priorityId + 1, 4)],
    impactId: critical ? 4 : 2,
    impact: IMPACT[critical ? 4 : 2],
    waitingExitDate: '0001-01-01T00:00:00',
    isRootIncident: true,
    productName: tpl.productName,
    productId: tpl.productId,
    productMasterId: tpl.productMasterId,
    productUrl: null,
    service: tpl.service,
    serviceId: tpl.serviceId,
    scenarioName: tpl.scenarioName,
    isNeedUp: null,
    eliminationType: null,
    eliminationTypeId: null,
    receivingChannel: critical ? 'Мониторинг 9го королевства' : pick(CHANNELS),
    solution: null,
  };
}

// Применение правки так, как это сделала бы ITSM: связанные поля обновляются вместе.
export function applyPatch(inc, patch, now = Date.now()) {
  if (patch.stateId !== undefined && Number(patch.stateId) !== Number(inc.stateId)) {
    const stateId = Number(patch.stateId);
    Object.assign(inc, STATES[stateId], { stateId });
    if ([7, 10, 20].includes(stateId)) {
      if (!inc.completionDate) inc.completionDate = iso(now);
      if (!inc.stateReason || inc.stateReason === 'Нет') {
        inc.stateReason = 'Постоянное решение';
        inc.stateReasonId = '430';
      }
    } else {
      inc.completionDate = null;
      inc.stateReason = 'Нет';
      inc.stateReasonId = '1';
    }
  }
  if (patch.priorityId !== undefined) {
    const p = Number(patch.priorityId);
    inc.priorityId = p;
    inc.priority = PRIORITY[p];
  }
  if (patch.assignedGroupName !== undefined && patch.assignedGroupName !== inc.assignedGroupName) {
    inc.assignedGroupName = patch.assignedGroupName;
    inc.lastAssignmentToTeamDateTime = iso(now);
    if (patch.assignedEmployee === undefined) {
      const emp = patch.assignedGroupName === COORD_GROUP ? pick(COORDINATORS) : null;
      inc.assignedEmployee = emp;
      inc.assignedEmployeeLogin = loginOf(emp);
    }
  }
  if (patch.assignedEmployee !== undefined) {
    inc.assignedEmployee = patch.assignedEmployee || null;
    inc.assignedEmployeeLogin = loginOf(patch.assignedEmployee);
  }
  if (patch.deadline !== undefined) inc.deadline = patch.deadline ? iso(patch.deadline) : null;
  if (patch.solution !== undefined) inc.solution = patch.solution;
  if (patch.isNeedUp !== undefined) inc.isNeedUp = patch.isNeedUp;
  return inc;
}

export function patchIncident(id, patch) {
  return updateIncidents((list) => {
    const inc = list.find((i) => i.id === id);
    if (!inc) return null;
    applyPatch(inc, patch);
    return inc;
  });
}

const notCoord = (i) => i.assignedGroupName !== COORD_GROUP;
const describe = (inc) => `${inc.id} · ${inc.productName}`;

// ---------- Сценарии ----------
export const SCENARIOS = {
  newCritical: {
    label: 'Новый критический инцидент',
    run() {
      return updateIncidents((list) => {
        const inc = makeIncident(list, { priorityId: 4 });
        list.unshift(inc);
        addMailSync({
          incidentId: inc.id,
          from: 'Мониторинг 9го королевства',
          subject: `[ALERT] ${inc.productName}: ${inc.scenarioName} недоступен`,
          body: `Сработали пороги доступности по сервису ${inc.service}. Зарегистрирован ${inc.id}.`,
          important: true,
        });
        return `создан ${describe(inc)}`;
      });
    },
  },
  escalateToCritical: {
    label: 'Высокий → критический',
    run() {
      return updateIncidents((list) => {
        const cand = list.filter((i) => isActive(i) && Number(i.priorityId) === 3);
        const inc = cand.length ? pick(cand) : pick(list.filter((i) => isActive(i) && !isCritical(i)));
        if (!inc) return 'нет подходящего инцидента';
        applyPatch(inc, { priorityId: 4 });
        inc.urgencyId = 4; inc.urgency = URGENCY[4]; inc.impactId = 4; inc.impact = IMPACT[4];
        return `${describe(inc)} стал критическим`;
      });
    },
  },
  assignToCoordinators: {
    label: 'Назначить на координаторов',
    run() {
      return updateIncidents((list) => {
        const cand = list.filter((i) => (isActive(i) || Number(i.stateId) === 20) && notCoord(i) && !isCriticalActive(i));
        const inc = pick(cand);
        if (!inc) return 'нет подходящего инцидента';
        applyPatch(inc, { assignedGroupName: COORD_GROUP });
        return `${describe(inc)} назначен на координаторов`;
      });
    },
  },
  handOff: {
    label: 'Координаторы передали в команду',
    run() {
      return updateIncidents((list) => {
        const inc = pick(list.filter((i) => i.assignedGroupName === COORD_GROUP && Number(i.stateId) !== 10));
        if (!inc) return 'на координаторах ничего нет';
        const group = pick(teams());
        applyPatch(inc, { assignedGroupName: group });
        return `${describe(inc)} передан в «${group}»`;
      });
    },
  },
  resolveCritical: {
    label: 'Решить критический',
    run() {
      return updateIncidents((list) => {
        const inc = pick(list.filter(isCriticalActive));
        if (!inc) return 'активных критических нет';
        applyPatch(inc, { stateId: 7, solution: 'Переключили трафик на резервный контур, сервис восстановлен. Идёт мониторинг.' });
        inc.isNeedUp = true;
        return `${describe(inc)} решён`;
      });
    },
  },
  raisePriority: {
    label: 'Повысить до высокого',
    run() {
      return updateIncidents((list) => {
        const inc = pick(list.filter((i) => isActive(i) && Number(i.priorityId) <= 2));
        if (!inc) return 'нет подходящего инцидента';
        applyPatch(inc, { priorityId: 3 });
        return `${describe(inc)}: приоритет повышен до высокого`;
      });
    },
  },
  shiftDeadline: {
    label: 'Сдвинуть срок',
    run() {
      return updateIncidents((list) => {
        const inc = pick(list.filter((i) => isActive(i) && i.deadline && Number(i.priorityId) >= 3))
          ?? pick(list.filter((i) => isActive(i) && i.deadline));
        if (!inc) return 'нет подходящего инцидента';
        const delta = pick([-1, 2, 3]);
        applyPatch(inc, { deadline: Date.parse(inc.deadline) + hours(delta) });
        return `${describe(inc)}: срок ${delta > 0 ? 'продлён' : 'сокращён'} на ${Math.abs(delta)} ч`;
      });
    },
  },
  startWork: {
    label: 'Взять в работу',
    run() {
      return updateIncidents((list) => {
        const inc = pick(list.filter((i) => Number(i.stateId) === 0 && notCoord(i)));
        if (!inc) return 'нет назначенных инцидентов';
        applyPatch(inc, { stateId: 2, assignedEmployee: inc.assignedEmployee ?? pick(PEOPLE) });
        return `${describe(inc)} взят в работу`;
      });
    },
  },
  resolveAny: {
    label: 'Решить обычный',
    run() {
      return updateIncidents((list) => {
        const inc = pick(list.filter((i) => isActive(i) && !isCritical(i) && notCoord(i)));
        if (!inc) return 'нет подходящего инцидента';
        applyPatch(inc, { stateId: 7, solution: 'Причина устранена, работоспособность подтверждена.' });
        return `${describe(inc)} решён`;
      });
    },
  },
  toResearch: {
    label: 'Перевести в исследование',
    run() {
      return updateIncidents((list) => {
        const inc = pick(list.filter((i) => Number(i.stateId) === 7));
        if (!inc) return 'нет решённых инцидентов';
        applyPatch(inc, { stateId: 20 });
        return `${describe(inc)}: начато исследование причин`;
      });
    },
  },
  closeResolved: {
    label: 'Закрыть решённый',
    run() {
      return updateIncidents((list) => {
        const inc = pick(list.filter((i) => Number(i.stateId) === 7));
        if (!inc) return 'нет решённых инцидентов';
        applyPatch(inc, { stateId: 10 });
        return `${describe(inc)} закрыт`;
      });
    },
  },
  newIncident: {
    label: 'Новый обычный инцидент',
    run() {
      return updateIncidents((list) => {
        const inc = makeIncident(list, { priorityId: pick([1, 2, 2, 3]) });
        list.unshift(inc);
        return `создан ${describe(inc)} (${inc.priority.toLowerCase()})`;
      });
    },
  },
  newMail: {
    label: 'Письмо по инциденту',
    run() {
      const list = readJson(FILES.incidents);
      const inc = pick(list.filter((i) => isActive(i) || Number(i.stateId) === 20));
      if (!inc) return 'нет активных инцидентов';
      const letter = addMailSync(randomLetter(inc));
      return `письмо «${letter.subject}»`;
    },
  },
};

// Веса для автосимуляции: критические случаются редко, мелкие изменения часто.
export const AUTO_WEIGHTS = {
  newCritical: 1, escalateToCritical: 1, assignToCoordinators: 3, handOff: 2, resolveCritical: 2,
  raisePriority: 2, shiftDeadline: 3, startWork: 3, resolveAny: 2, toResearch: 1, closeResolved: 2,
  newIncident: 2, newMail: 4,
};

export function runScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`Неизвестный сценарий: ${name}`);
  return sc.run();
}

export function runRandomScenario() {
  const entries = Object.entries(AUTO_WEIGHTS);
  // Не плодим критические: если уже есть два активных, вместо нового решаем один.
  const list = readJson(FILES.incidents, []);
  const activeCrit = list.filter(isCriticalActive).length;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  let name = entries[0][0];
  for (const [n, w] of entries) {
    r -= w;
    if (r <= 0) { name = n; break; }
  }
  if (activeCrit >= 2 && (name === 'newCritical' || name === 'escalateToCritical')) name = 'resolveCritical';
  return { name, result: runScenario(name) };
}

// ---------- Почта ----------
function mailAddress(person) {
  const login = loginOf(person);
  return login ? `${login}@corp.local` : 'monitoring@corp.local';
}

export function randomLetter(inc) {
  const variants = [
    {
      from: inc.initiatorName,
      subject: `Re: ${inc.id} ${inc.header}`,
      body: 'Проблема повторяется, пользователи продолжают жаловаться. Есть ли оценка сроков восстановления?',
    },
    {
      from: inc.assignedEmployee ?? pick(PEOPLE),
      subject: `${inc.id}: статус работ`,
      body: 'Взяли в работу, локализуем причину. Следующее обновление через 30 минут.',
    },
    {
      from: pick(PEOPLE),
      subject: `Вопрос по ${inc.id} (${inc.productName})`,
      body: `Подскажите, кто сейчас отвечает за ${inc.scenarioName}? Наши клиенты тоже затронуты.`,
    },
  ];
  if (Number(inc.stateId) === 20) {
    variants.push({
      from: inc.assignedEmployee ?? pick(PEOPLE),
      subject: `Разбор причин ${inc.id}`,
      body: 'Собираем таймлайн инцидента. Для разбора нужна информация от смежной команды, предлагаем передать через координаторов.',
    });
  }
  return { incidentId: inc.id, ...pick(variants), important: Number(inc.priorityId) >= 4 };
}

export function makeLetter({ incidentId = null, from, subject, body, important = false, receivedAt = Date.now() }) {
  return {
    id: 'MSG-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    receivedAt: iso(receivedAt),
    fromName: from,
    fromAddress: mailAddress(from),
    subject,
    body,
    incidentId,
    important,
  };
}

function addMailSync(letterInput) {
  const letter = makeLetter(letterInput);
  updateMail((mail) => {
    mail.unshift(letter);
    mail.splice(200);
  });
  return letter;
}
