// Симулятор ITSM: вносит изменения прямо в data/incidents.json (и data/mail.json),
// как будто их прислала ITSM. Сервер дашборда подхватывает изменения файла сам.
//
//   npm run simulate                 — случайные изменения каждые 6 секунд
//   npm run simulate -- 3            — каждые 3 секунды
//   npm run simulate -- newCritical  — один конкретный сценарий и выход
//   npm run simulate -- list         — список сценариев
import { SCENARIOS, runScenario, runRandomScenario } from './scenarios.js';

const arg = process.argv[2];
const time = () => new Date().toLocaleTimeString('ru-RU');

if (arg === 'list') {
  for (const [name, s] of Object.entries(SCENARIOS)) console.log(`${name.padEnd(22)} ${s.label}`);
} else if (arg && SCENARIOS[arg]) {
  console.log(`${SCENARIOS[arg].label}: ${runScenario(arg)}`);
} else {
  const seconds = Number(arg) || 6;
  console.log(`Симуляция ITSM: изменение каждые ${seconds} с. Остановить: Ctrl+C`);
  const tick = () => {
    const { name, result } = runRandomScenario();
    console.log(`${time()}  ${SCENARIOS[name].label}: ${result}`);
  };
  tick();
  setInterval(tick, seconds * 1000);
}
