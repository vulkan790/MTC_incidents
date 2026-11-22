// Бэкенд пульта координатора.
// ITSM для нас — чёрный ящик, его эмулирует файл data/incidents.json.
// Сервер следит за файлом (и за почтой data/mail.json), при любом изменении сравнивает снимки,
// формирует события и рассылает актуальное состояние всем дашбордам по WebSocket.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { DATA_DIR, FILES, readJson, writeJson, updateIncidents, updateMail } from './store.js';
import { setMailUpdateListener, syncMailMetadata, decorateMail, patchMailMetadata, analyzeMail, analyzeInbox, aiStatus, probeOllama, resetMailMetadata } from './mail-service.js';
import { COORD_GROUP, STATES, PRIORITY, isCriticalActive, isOnCoordinators, iso } from './model.js';
import { diffIncidents, diffMail } from './events.js';
import { SCENARIOS, patchIncident, runScenario, runRandomScenario, teams, makeIncident } from './scenarios.js';
import { seed } from './seed.js';

const PORT = Number(process.env.PORT) || 3001;
const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '..', 'dist');

if (!fs.existsSync(FILES.incidents)) {
  console.log('data/incidents.json не найден — создаю из исходной выгрузки.');
  seed();
}

// ---------- Состояние ----------
const state = {
  version: 0,
  updatedAt: iso(Date.now()),
  incidents: [],
  mail: [],
  acks: readJson(FILES.dashboard, { acks: {} }).acks ?? {},
  events: [],
  error: null,
};
const raw = { incidents: null, mail: null };
const auto = { enabled: false, intervalMs: 8000, timer: null, last: null };

function snapshot() {
  return {
    version: state.version,
    updatedAt: state.updatedAt,
    serverTime: new Date().toISOString(),
    incidents: state.incidents,
    mail: decorateMail(state.mail),
    acks: state.acks,
    events: state.events.slice(0, 80),
    error: state.error,
    auto: { enabled: auto.enabled, intervalMs: auto.intervalMs, last: auto.last },
    meta: { coordGroup: COORD_GROUP, teams: teams(state.incidents), ai: aiStatus() },
  };
}

function saveAcks() {
  writeJson(FILES.dashboard, { acks: state.acks });
}

// Подтверждения теряют силу, когда инцидент выходит из группы: при повторном попадании тревога сработает снова.
function cleanupAcks() {
  const byId = new Map(state.incidents.map((i) => [i.id, i]));
  let changed = false;
  for (const key of Object.keys(state.acks)) {
    const [kind, id] = key.split(':');
    const inc = byId.get(id);
    const valid = kind === 'crit' ? inc && isCriticalActive(inc) : kind === 'coord' ? inc && isOnCoordinators(inc) : true;
    if (!valid) {
      delete state.acks[key];
      changed = true;
    }
  }
  if (changed) saveAcks();
}

// При ручной правке файла обычно меняют только числовое поле (stateId, priorityId).
// Текстовые поля приводим в соответствие в памяти, файл не трогаем.
function normalize(list, prev) {
  const before = new Map(prev.map((i) => [i.id, i]));
  for (const inc of list) {
    const st = STATES[Number(inc.stateId)];
    if (st) Object.assign(inc, st, { stateId: Number(inc.stateId) });
    if (PRIORITY[Number(inc.priorityId)]) {
      inc.priorityId = Number(inc.priorityId);
      inc.priority = PRIORITY[inc.priorityId];
    }
    if ([7, 10, 20].includes(inc.stateId) && !inc.completionDate) {
      inc.completionDate = before.get(inc.id)?.completionDate ?? iso(Date.now());
    }
  }
  return list;
}

function load(kind, { initial = false } = {}) {
  const file = FILES[kind];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (text === raw[kind]) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('ожидается массив инцидентов');
  } catch (err) {
    // Файл правят руками и он временно невалиден — показываем предупреждение, данные не теряем.
    raw[kind] = text;
    state.error = `${path.basename(file)}: ${err.message}`;
    return null;
  }
  raw[kind] = text;
  if (state.error?.startsWith(path.basename(file))) state.error = null;
  const prev = state[kind];
  state[kind] = kind === 'incidents' ? normalize(parsed, prev) : parsed;
  if (kind === 'mail') syncMailMetadata(parsed);
  if (initial) return [];
  return kind === 'incidents' ? diffIncidents(prev, parsed) : diffMail(prev, parsed);
}

function refresh(kinds = ['incidents', 'mail']) {
  const before = state.error;
  const results = kinds.map((k) => load(k));
  const changed = results.some((r) => r !== null);
  const events = results.flatMap((r) => r ?? []);
  if (kinds.includes('mail') && results[kinds.indexOf('mail')] !== null) void analyzeInbox(state.mail);
  if (!changed && before === state.error) return;
  state.version += 1;
  state.updatedAt = iso(Date.now());
  state.events = [...events.reverse(), ...state.events].slice(0, 300);
  cleanupAcks();
  broadcast({ type: 'state', state: snapshot(), events });
  if (events.length) for (const e of events) console.log(`[${e.level}] ${e.incidentId ?? ''} ${e.text}`);
}

load('incidents', { initial: true });
load('mail', { initial: true });
cleanupAcks();
setMailUpdateListener(() => {
  // Изменения метаданных почты должны быть видны HTTP-клиентам так же быстро,
  // как WebSocket-клиентам: меняем версию перед рассылкой нового снимка.
  state.version += 1;
  state.updatedAt = iso(Date.now());
  broadcast({ type: 'state', state: snapshot(), events: [] });
});
void analyzeInbox(state.mail);

// Изменения файла ловим двумя способами: fs.watch (мгновенно) и опросом mtime (надёжно для любых редакторов и сетевых дисков).
let debounce = null;
const schedule = () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => refresh(), 60);
};
try {
  fs.watch(DATA_DIR, (_e, name) => {
    if (!name || name === 'incidents.json' || name === 'mail.json') schedule();
  });
} catch (err) {
  console.warn('fs.watch недоступен, остаётся опрос файла:', err.message);
}
const mtimes = {};
setInterval(() => {
  for (const k of ['incidents', 'mail']) {
    try {
      const m = fs.statSync(FILES[k]).mtimeMs;
      if (mtimes[k] !== undefined && mtimes[k] !== m) schedule();
      mtimes[k] = m;
    } catch { /* файл в процессе замены */ }
  }
}, 500);

// ---------- HTTP ----------
const app = express();
app.use(express.json());

app.get('/api/state', (_req, res) => res.json(snapshot()));
// Резервный endpoint для окружений, где WebSocket недоступен (например, через Passenger).
// Клиент передаёт версию состояния: без изменений сервер отвечает 204,
// при изменениях возвращает новый снимок.
app.get('/api/stage', (req, res) => {
  const since = Number(req.query.since);
  res.set('Cache-Control', 'no-store');
  if (Number.isFinite(since) && since === state.version) return res.status(204).end();
  return res.json(snapshot());
});

app.post('/api/incidents/:id', (req, res) => {
  const allowed = ['stateId', 'priorityId', 'assignedGroupName', 'assignedEmployee', 'deadline', 'solution', 'isNeedUp'];
  const patch = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => allowed.includes(k)));
  const inc = patchIncident(req.params.id, patch);
  if (!inc) return res.status(404).json({ error: `Инцидент ${req.params.id} не найден` });
  refresh(['incidents']);
  res.json(inc);
});

// ---------- Почта: чтение, папки, оценки, явное преобразование в инцидент ----------
app.get('/api/ai/status', async (_req, res) => res.json(await probeOllama()));

app.post('/api/mail/analyze', async (_req, res) => {
  // Массовый повторный прогон, без создания ITSM. Не держим HTTP-запрос открытым на генерации.
  const letters = [...state.mail];
  void (async () => {
    await probeOllama();
    for (const letter of letters) if (state.mail.some((m) => m.id === letter.id)) await analyzeMail(letter, { force: true });
  })();
  res.json({ ok: true, count: letters.length, message: 'Анализ запущен; результаты появятся автоматически' });
});

app.post('/api/mail/:id/analyze', async (req, res) => {
  const mail = state.mail.find((m) => m.id === req.params.id);
  if (!mail) return res.status(404).json({ error: 'Письмо не найдено' });
  try { res.json(await analyzeMail(mail, { force: true })); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

app.patch('/api/mail/:id', (req, res) => {
  if (!state.mail.some((m) => m.id === req.params.id)) return res.status(404).json({ error: 'Письмо не найдено' });
  const input = req.body ?? {};
  const patch = {};
  if (input.folder !== undefined) {
    if (!['inbox', 'spam', 'archive'].includes(input.folder)) return res.status(400).json({ error: 'Неизвестная папка' });
    patch.folder = input.folder;
  }
  if (input.read !== undefined) {
    if (typeof input.read !== 'boolean') return res.status(400).json({ error: 'read должно быть boolean' });
    patch.read = input.read;
  }
  if (input.potential !== undefined) {
    if (typeof input.potential !== 'boolean') return res.status(400).json({ error: 'potential должно быть boolean' });
    patch.potential = input.potential;
  }
  res.json({ ok: true, metadata: patchMailMetadata(req.params.id, patch) });
});

app.post('/api/mail/:id/link', (req, res) => {
  const incidentId = String(req.body?.incidentId ?? '').trim().toUpperCase();
  if (!state.incidents.some((inc) => inc.id === incidentId)) return res.status(404).json({ error: 'Инцидент с таким номером не найден' });
  if (!state.mail.some((m) => m.id === req.params.id)) return res.status(404).json({ error: 'Письмо не найдено' });
  updateMail((list) => { const mail = list.find((m) => m.id === req.params.id); mail.incidentId = incidentId; });
  refresh(['mail']);
  res.json({ ok: true, incidentId });
});

app.post('/api/mail/:id/incident', (req, res) => {
  const letter = state.mail.find((m) => m.id === req.params.id);
  if (!letter) return res.status(404).json({ error: 'Письмо не найдено' });
  if (letter.incidentId) return res.status(409).json({ error: `Письмо уже связано с ${letter.incidentId}` });
  const priorityId = Number(req.body?.priorityId ?? 2);
  if (![1, 2, 3, 4].includes(priorityId)) return res.status(400).json({ error: 'Неверный приоритет' });
  const team = String(req.body?.team || COORD_GROUP).slice(0, 120);
  if (team !== COORD_GROUP && !teams(state.incidents).includes(team)) return res.status(400).json({ error: 'Неизвестная команда' });
  const incident = updateIncidents((list) => {
    const inc = makeIncident(list, { priorityId, group: team });
    // Сохраняем структуру ITSM, но содержимое берём только из конкретного письма.
    inc.header = String(letter.subject).slice(0, 240);
    inc.shortDescription = inc.header;
    inc.description = `Получено по электронной почте от ${letter.fromName} <${letter.fromAddress}>:\n${letter.body}`.slice(0, 5000);
    inc.initiatorName = letter.fromName;
    inc.initiatorLogin = letter.fromAddress;
    inc.receivingChannel = 'Электронная почта';
    inc.assignedEmployee = null;
    inc.assignedEmployeeLogin = null;
    inc.productName = 'Не определён (почта)';
    inc.productId = '';
    inc.productMasterId = '';
    inc.service = 'Требуется классификация';
    inc.serviceId = '';
    inc.scenarioName = 'Обращение из почты';
    list.unshift(inc);
    return inc;
  });
  updateMail((list) => { const mail = list.find((m) => m.id === letter.id); if (mail) mail.incidentId = incident.id; });
  refresh(['incidents', 'mail']);
  res.status(201).json({ ok: true, incidentId: incident.id });
});

app.post('/api/ack', (req, res) => {
  const { key, by } = req.body ?? {};
  if (!/^(crit|coord):[\w-]+$/.test(key ?? '')) return res.status(400).json({ error: 'Неверный ключ подтверждения' });
  state.acks[key] = { by: String(by || 'Координатор').slice(0, 60), at: iso(Date.now()) };
  saveAcks();
  state.version += 1;
  broadcast({ type: 'state', state: snapshot(), events: [] });
  res.json({ ok: true });
});

app.get('/api/scenarios', (_req, res) =>
  res.json(Object.entries(SCENARIOS).map(([name, s]) => ({ name, label: s.label }))));

app.post('/api/demo/auto', (req, res) => {
  const { enabled, intervalMs } = req.body ?? {};
  if (intervalMs) auto.intervalMs = Math.max(2000, Number(intervalMs));
  setAuto(Boolean(enabled));
  res.json({ enabled: auto.enabled, intervalMs: auto.intervalMs });
});

app.post('/api/demo/reset', (_req, res) => {
  seed({ quiet: true });
  state.acks = readJson(FILES.dashboard, { acks: {} }).acks;
  raw.incidents = raw.mail = null;
  state.incidents = [];
  state.mail = [];
  load('incidents', { initial: true });
  load('mail', { initial: true });
  resetMailMetadata(state.mail);
  void analyzeInbox(state.mail);
  state.events = [];
  state.version += 1;
  broadcast({ type: 'state', state: snapshot(), events: [] });
  res.json({ ok: true });
});

app.post('/api/demo/:name', (req, res) => {
  try {
    const result = runScenario(req.params.name);
    refresh();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function setAuto(enabled) {
  clearInterval(auto.timer);
  auto.enabled = enabled;
  if (enabled) {
    auto.timer = setInterval(() => {
      try {
        const { name, result } = runRandomScenario();
        auto.last = `${SCENARIOS[name].label}: ${result}`;
        refresh();
      } catch (err) {
        console.warn('Автосимуляция:', err.message);
      }
    }, auto.intervalMs);
  }
  state.version += 1;
  broadcast({ type: 'state', state: snapshot(), events: [] });
}

// Собранный фронтенд (npm run build) + SPA-маршруты (/itsm/INC...)
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) if (client.readyState === 1) client.send(data);
}

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
  socket.send(JSON.stringify({ type: 'state', state: snapshot(), events: [] }));
});
setInterval(() => {
  for (const s of wss.clients) {
    if (!s.isAlive) { s.terminate(); continue; }
    s.isAlive = false;
    s.ping();
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`Пульт координатора: http://localhost:${PORT}  (API /api/state, WebSocket /ws)`);
  console.log(`Слежу за файлом ${FILES.incidents}`);
});
