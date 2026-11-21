// Первый экран смены: после действия пользователя браузер разрешит звуковые сигналы,
// но их воспроизведение всё равно подчиняется персональным настройкам координатора.
import { useState } from 'react';
import { rememberOperatorBeforeStart } from '../lib/operator-session';

export function StartOverlay({ name, onStart }: { name: string; onStart: (name: string) => void }) {
  const [value, setValue] = useState(name);
  return (
    <div className="start">
      <form
        className="start-panel"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(value.trim() || 'Координатор');
        }}
      >
        <h1>Пульт координатора</h1>
        <p>Во время смены уведомления и звук будут работать согласно вашим персональным настройкам.</p>
        <label>
          Кто на смене
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Например, Дядя Фёдор" autoFocus />
        </label>
        <button className="btn btn-start" type="submit">Начать смену</button>
        <a className="start-settings-link" href="/settings" onClick={() => {
          rememberOperatorBeforeStart(value);
        }}>⚙ Настроить уведомления перед сменой</a>
      </form>
    </div>
  );
}
