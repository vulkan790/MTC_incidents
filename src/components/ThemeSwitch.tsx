import { useSyncExternalStore } from 'react';
import { getTheme, setTheme, subscribeTheme } from '../lib/theme';

export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  return (
    <div className="theme-switch" role="group" aria-label="Тема оформления">
      <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Светлая</button>
      <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Тёмная</button>
    </div>
  );
}
