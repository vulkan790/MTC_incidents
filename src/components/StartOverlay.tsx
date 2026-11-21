// Первый экран смены. Нужен по делу: браузер разрешает звук только после клика,
// а тревога о критическом инциденте без звука — не тревога.
import { useState } from 'react';

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
        <p>Включите звук и уведомления, чтобы не пропустить критический инцидент и назначение на координаторов.</p>
        <label>
          Кто на смене
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Например, Дядя Фёдор" autoFocus />
        </label>
        <button className="btn btn-start" type="submit">Начать смену со звуком</button>
      </form>
    </div>
  );
}
