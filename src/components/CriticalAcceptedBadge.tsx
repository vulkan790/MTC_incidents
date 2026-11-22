import type { Ack } from '../types';

interface Props {
  ack?: Ack;
  compact?: boolean;
  showPending?: boolean;
  minimal?: boolean;
}

export function CriticalAcceptedBadge({ ack, compact = false, showPending = false, minimal = false }: Props) {
  if (!ack && !showPending) return null;
  const date = ack?.at ? new Date(ack.at) : null;
  const valid = date && Number.isFinite(date.getTime());
  const time = valid ? date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '';
  const name = ack?.by?.trim() || 'не назначен';
  const title = minimal
    ? (ack ? 'Взято на контроль' : 'Ожидает принятия')
    : ack
    ? `Ответственный: ${name}${time ? ` · Принял ${time}` : ''}`
    : 'Ответственный: не назначен';

  return (
    <span className={`critical-accepted-badge ${ack ? 'is-accepted' : 'is-pending'}${compact ? ' is-compact' : ''}`}
      title={title} aria-label={title}>
      <span className="critical-accepted-mark" aria-hidden="true">{ack ? '✓' : '!'}</span>
      {minimal ? <span className="critical-accepted-status">{ack ? 'Взято на контроль' : 'Ожидает принятия'}</span> : <>
        <span className="critical-accepted-name">{`Ответственный: ${name}`}</span>
        {ack && valid && <time className="critical-accepted-at" dateTime={ack.at}>{time}</time>}
      </>}
    </span>
  );
}
