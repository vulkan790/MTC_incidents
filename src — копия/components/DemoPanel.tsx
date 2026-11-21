// Панель для защиты: имитирует изменения в ITSM. Каждая кнопка меняет файл data/incidents.json на сервере,
// а дашборд узнаёт об этом так же, как о любом внешнем изменении файла.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { demo } from '../lib/live';
import type { LiveState } from '../types';

const ORDER = [
  'newCritical', 'escalateToCritical', 'resolveCritical', 'assignToCoordinators', 'handOff',
  'raisePriority', 'shiftDeadline', 'startWork', 'resolveAny', 'toResearch', 'closeResolved', 'newIncident', 'newMail',
];

export function DemoPanel({ auto, onClose }: { auto: LiveState['auto']; onClose: () => void }) {
  const { data: scenarios = [] } = useQuery<{ name: string; label: string }[]>({
    queryKey: ['scenarios'],
    queryFn: () => fetch('/api/scenarios').then((r) => r.json()),
    staleTime: Infinity,
  });
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (name: string) => {
    setBusy(true);
    const res = await demo(name);
    setLog(res.result ?? res.error ?? null);
    setBusy(false);
  };
  const sorted = [...scenarios].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));

  return (
    <div className="demo" role="dialog" aria-label="Имитация изменений в ITSM">
      <header>
        <h2>Имитация ITSM</h2>
        <button className="toast-close" aria-label="Закрыть" onClick={onClose}>×</button>
      </header>
      <p className="demo-hint">
        Кнопки меняют файл <code>data/incidents.json</code>. Файл можно править и вручную, дашборд подхватит изменения сам.
      </p>
      <div className="demo-grid">
        {sorted.map((s) => (
          <button key={s.name} className={`btn demo-btn demo-${s.name}`} disabled={busy} onClick={() => run(s.name)}>
            {s.label}
          </button>
        ))}
      </div>
      <label className="demo-auto">
        <input type="checkbox" checked={auto.enabled} onChange={(e) => demo('auto', { enabled: e.target.checked })} />
        Случайные изменения каждые {Math.round(auto.intervalMs / 1000)} с
      </label>
      {(log || auto.last) && <p className="demo-log">{auto.enabled && auto.last ? auto.last : log}</p>}
      <button
        className="btn btn-quiet"
        onClick={() => confirm('Вернуть исходные данные из выгрузки ITSM? Все изменения демо будут сброшены.') && demo('reset')}
      >
        Сбросить данные к исходной выгрузке
      </button>
    </div>
  );
}
