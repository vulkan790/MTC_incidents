export type Theme = 'light' | 'dark';
const THEME_KEY = 'theme'; 
const listeners = new Set<() => void>();
const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark';

function readSavedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return isTheme(value) ? value : null;
  } catch { return null; }
}

function initialTheme(): Theme {
  const saved = readSavedTheme();
  if (saved) return saved;
  const rootTheme = document.documentElement.dataset.theme;
  if (isTheme(rootTheme)) return rootTheme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

let current: Theme = initialTheme();
let initialized = false;

function applyTheme(theme: Theme) {
  const changed = current !== theme;
  current = theme;
  document.documentElement.dataset.theme = theme;
  if (changed) listeners.forEach((listener) => listener());
}

export function getTheme(): Theme { return current; }

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setTheme(theme: Theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* Тема всё равно меняется на текущей странице. */ }
  applyTheme(theme);
}

export function initializeTheme() {
  applyTheme(initialTheme());
  if (initialized) return;
  initialized = true;
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY && isTheme(event.newValue)) {
      applyTheme(event.newValue);
    }
  });
  window.addEventListener('pageshow', () => {
    const saved = readSavedTheme();
    if (saved) applyTheme(saved);
  });
}
