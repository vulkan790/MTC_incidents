interface Props {
  pinned: boolean;
  limitReached: boolean;
  onToggle: () => void;
}

export function PinButton({ pinned, limitReached, onToggle }: Props) {
  const blocked = !pinned && limitReached;
  const label = pinned ? 'Открепить инцидент' : blocked ? 'Лимит: 3 закреплённых инцидента в категории. Сначала открепите один.' : 'Закрепить наверху категории';
  return (
    <button type="button" className="incident-pin" aria-label={label} title={label}
      aria-pressed={pinned} aria-disabled={blocked}
      onClick={(event) => { event.stopPropagation(); if (!blocked) onToggle(); }}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path className="pin-head" d="M16 3l5 5-3 1-3 3v4l-2 2-7-7 2-2h4l3-3 1-3Z" />
        <path d="m9.5 14.5-6 6" />
      </svg>
    </button>
  );
}
