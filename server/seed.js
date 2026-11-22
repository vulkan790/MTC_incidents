// Готовит рабочий файл data/incidents.json из исходной выгрузки ITSM.
// Исходные даты (8–10 ноября) сдвигаются так, чтобы последний инцидент был зарегистрирован ~20 минут назад:
// относительные интервалы (регистрация → срок → решение) сохраняются, поэтому таймеры на дашборде живые.
// Запуск: npm run seed  (перед демонстрацией, чтобы «оживить» сроки)
import { pathToFileURL } from 'node:url';
import { DATE_FIELDS, COORD_GROUP, iso, isActive } from './model.js';
import { FILES, readJson, writeJson } from './store.js';
import { makeLetter, randomLetter } from './scenarios.js';

export function seed({ quiet = false } = {}) {
  const src = readJson(FILES.source);
  const now = Date.now();
  const lastSubmit = Math.max(...src.map((i) => Date.parse(i.submitDate)));
  const shift = now - 20 * 60 * 1000 - lastSubmit;

  const incidents = src.map((inc) => {
    const copy = { ...inc };
    for (const f of DATE_FIELDS) if (copy[f]) copy[f] = iso(Date.parse(copy[f]) + shift);
    return copy;
  });
  incidents.sort((a, b) => Date.parse(b.submitDate) - Date.parse(a.submitDate));

  // Небольшая часть писем уже связана с ITSM, остальные остаются входящими
  // потенциальными инцидентами для ручной классификации координатором.
  const mail = [];
  const interesting = incidents.filter(
    (i) => isActive(i) || Number(i.stateId) === 20 || i.assignedGroupName === COORD_GROUP,
  );
  for (const inc of interesting.slice(0, 4)) {
    const from = Date.parse(inc.submitDate);
    const at = from + Math.random() * Math.max(0, Math.min(now, from + 6 * 3600e3) - from);
    mail.push(makeLetter({ ...randomLetter(inc), receivedAt: at }));
  }
  for (const inc of interesting.slice(4, 20)) {
    const from = inc.initiatorName || inc.assignedEmployee || 'Дежурная смена';
    const at = Date.parse(inc.submitDate) + Math.random() * 6 * 3600e3;
    mail.push(makeLetter({
      from,
      subject: `Требуется проверка: ${inc.productName} — ${inc.scenarioName}`,
      body: `Поступила жалоба на работу сервиса ${inc.productName}. Пользователи сообщают о сбое, нужна проверка и классификация координатором.`,
      incidentId: null,
      important: Number(inc.priorityId) >= 3,
      receivedAt: at,
    }));
  }
  mail.push(makeLetter({
    from: 'Мониторинг 9го королевства',
    subject: 'Плановые работы на сетевом ядре сегодня 23:00–01:00',
    body: 'Возможны кратковременные потери связности. Инциденты по этому окну просьба связывать с плановыми работами.',
    receivedAt: now - 45 * 60 * 1000,
  }));
  // Два письма без номера ITSM: одно — потенциальная авария, второе — обычная переписка.
  // Анализ только помечает их; инцидент создаётся исключительно по кнопке координатора.
  mail.push({
    id: 'MSG-DEMO-OUTAGE', receivedAt: iso(now - 8 * 60 * 1000),
    fromName: 'Дежурный инженер сети', fromAddress: 'noc@corp.local',
    subject: 'Авария: массовая недоступность личного кабинета',
    body: 'Пользователи не могут открыть личный кабинет. Ошибки 503 в нескольких регионах, обращения продолжают поступать.',
    incidentId: null, important: true,
  }, {
    id: 'MSG-DEMO-INFO', receivedAt: iso(now - 18 * 60 * 1000),
    fromName: 'Администрация', fromAddress: 'info@corp.local',
    subject: 'Информация о встрече команды', body: 'Напоминаем о еженедельной встрече координаторов в понедельник.',
    incidentId: null, important: false,
  });
  mail.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));

  // То, что уже лежит на координаторах до начала смены, считаем увиденным.
  const acks = {};
  for (const inc of incidents) {
    if (inc.assignedGroupName === COORD_GROUP) acks[`coord:${inc.id}`] = { by: 'предыдущая смена', at: iso(now) };
  }

  writeJson(FILES.incidents, incidents);
  writeJson(FILES.mail, mail);
  writeJson(FILES.dashboard, { acks });
  if (!quiet) {
    console.log(`Готово: ${incidents.length} инцидентов, ${mail.length} писем.`);
    console.log(`Даты сдвинуты на ${(shift / 3600e3 / 24).toFixed(1)} дн. Последняя регистрация: ${iso(lastSubmit + shift)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) seed();
