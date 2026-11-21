// Простые линейные иконки (24×24, обводка currentColor), встроены в код: работают без интернета.
export type IconName =
  | 'critical' | 'coord' | 'high' | 'research'
  | 'clock' | 'activity' | 'mail' | 'check';

const PATHS: Record<IconName, string[]> = {
  // Треугольник с восклицательным знаком: критический инцидент.
  critical: ['M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z', 'M12 9v4.5', 'M12 17h.01'],
  // Человек со стрелкой: на координаторах, нужно передать дальше.
  coord: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M2.5 20.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5', 'M16 10h6', 'M19 7l3 3-3 3'],
  // Двойная стрелка вверх: высокий приоритет.
  high: ['m17 11-5-5-5 5', 'm17 18-5-5-5 5'],
  // Лупа: исследование ситуации, разбор причин.
  research: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20.5 20.5-4.5-4.5'],
  // Часы: контроль сроков.
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3.5 2'],
  // Пульс: события смены.
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  // Конверт: почта.
  mail: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'm3 7 9 6 9-6'],
  // Галочка в круге: решены.
  check: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm8 12.5 2.8 2.8L16 9.5'],
};

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
