// Звуки генерируются через Web Audio — никаких файлов, работает офлайн.
// Браузер разрешает звук только после действия пользователя, поэтому unlock() вызывается по кнопке «Начать смену».
let ctx: AudioContext | null = null;
let muted = false;

export function unlockAudio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

export const setMuted = (v: boolean) => { muted = v; };
export const isMuted = () => muted;
export const audioReady = () => !!ctx && ctx.state === 'running';

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, toFreq?: number) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (toFreq) osc.frequency.linearRampToValueAtTime(toFreq, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.setValueAtTime(gain, t0 + dur - 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Тревога: двухтональная сирена ~1.6 с. Повторяется, пока критический не подтверждён.
export function playSiren() {
  if (muted || !ctx) return;
  for (let k = 0; k < 4; k++) {
    tone(740, k * 0.4, 0.2, 'square', 0.12, 980);
    tone(980, k * 0.4 + 0.2, 0.2, 'square', 0.12, 740);
  }
}

// Колокольчик для уведомлений: мягкая атака и затухание с обертонами, без жужжания прямоугольной волны.
function chime(freq: number, start: number, dur: number, gain: number) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  out.connect(ctx.destination);
  // Основной тон и два тихих обертона дают «стеклянный» тембр.
  for (const [mult, level] of [[1, 1], [2.01, 0.28], [3.98, 0.08]] as const) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * mult, t0);
    g.gain.value = level;
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

// Назначение на координаторов: два колокольчика вверх «дин-дон», заметно, но не тревожно.
export function playCoord() {
  if (muted || !ctx) return;
  chime(784, 0, 0.9, 0.22);
  chime(1175, 0.16, 1.1, 0.2);
}

// Критический решён: три колокольчика по восходящей.
export function playResolved() {
  if (muted || !ctx) return;
  chime(659, 0, 0.9, 0.2);
  chime(831, 0.12, 0.9, 0.2);
  chime(988, 0.24, 1.4, 0.22);
}

// Письмо или изменение приоритета: один тихий колокольчик.
export function playSoft() {
  if (muted || !ctx) return;
  chime(1319, 0, 0.6, 0.1);
}
