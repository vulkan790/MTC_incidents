import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import type { Incident, Ack } from '../types';
import { CriticalAcceptedBadge } from './CriticalAcceptedBadge';
import {
  type GroupKey, type Sla, COORD_GROUP, STATE, fmtAgo, fmtDuration, fmtTime, isActive, isCritical,
  openItsm, personName, serviceShort,
} from '../lib/model';
import { ack, patchIncident } from '../lib/live';
import { reducedMotion } from '../lib/motion';
import { PinButton } from './PinButton';

const GROUP_CHIP: Record<GroupKey, string> = {
  critical: 'критический',
  coord: 'на координаторах',
  high: 'высокий приоритет',
  research: 'исследование',
};

export interface CardProps {
  inc: Incident;
  lane: GroupKey;
  groups: GroupKey[];
  sla: Sla;
  now: number;
  mailCount: number;
  unacked: boolean;
  criticalAck?: Ack;
  changedAt?: number;
  operator: string;
  teams: string[];
  pinned?: boolean;
  pinLimitReached?: boolean;
  onTogglePin?: () => void;
}

function Deadline({ inc, sla, now }: { inc: Incident; sla: Sla; now: number }) {
  const critical = isCritical(inc);
  if (inc.stateId === STATE.research) {
    return (
      <div className="deadline is-research">
        <span className="dl-main">Разбор причин</span>
        <span className="dl-sub">
          решён {fmtTime(inc.completionDate, now)}
          {inc.completionDate && `, разбор идёт ${fmtDuration(now - Date.parse(inc.completionDate))}`}
        </span>
      </div>
    );
  }
  if (!isActive(inc)) {
    const took = inc.completionDate ? Date.parse(inc.completionDate) - Date.parse(inc.submitDate) : null;
    return (
      <div className="deadline is-done">
        <span className="dl-main">{inc.stateId === STATE.closed ? 'Закрыт' : 'Решён'} {fmtTime(inc.completionDate, now)}</span>
        {took !== null && <span className="dl-sub">решили за {fmtDuration(took)}</span>}
      </div>
    );
  }
  if (sla.left === null) {
    return (
      <div className="deadline">
        <span className="dl-main dl-none">Срок не задан</span>
      </div>
    );
  }
  const overdue = sla.left <= 0;
  return (
    <div className={`deadline risk-${sla.risk}`}>
      <span className="dl-main">
        {overdue ? `просрочен на ${fmtDuration(-sla.left, critical)}` : `осталось ${fmtDuration(sla.left, critical)}`}
      </span>
      <span className="dl-sub">
        срок {fmtTime(inc.deadline, now)}
        {sla.forecast && !overdue && <b className="forecast"> прогноз: не успеют</b>}
      </span>
    </div>
  );
}

export function Handoff({ inc, teams, onDone }: { inc: Incident; teams: string[]; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onDone();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onDone]);
  const list = teams.filter((t) => t.toLowerCase().includes(q.trim().toLowerCase()));
  const send = async (team: string) => {
    setBusy(team);
    setError(null);
    try {
      await patchIncident(inc.id, { assignedGroupName: team });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };
  return (
    <div className="handoff" ref={box} onClick={(e) => e.stopPropagation()}>
      <input autoFocus placeholder="Найти команду" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul>
        {list.map((t) => (
          <li key={t}>
            <button disabled={!!busy} onClick={() => send(t)}>{busy === t ? 'Передаю…' : t}</button>
          </li>
        ))}
        {!list.length && <li className="muted">Команда не найдена</li>}
      </ul>
      {error && <p className="handoff-error">{error}</p>}
    </div>
  );
}

function IncidentCardImpl({ inc, lane, groups, sla, now, mailCount, unacked, criticalAck, changedAt, operator, teams, pinned, pinLimitReached, onTogglePin }: CardProps) {
  const ref = useRef<HTMLElement>(null);
  const flash = useRef<HTMLSpanElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const [handoff, setHandoff] = useState(false);
  const critical = isCritical(inc);
  const active = isActive(inc);
  const criticalActive = critical && active;
  const resolved = !active && inc.stateId !== STATE.research;
  const onCoord = inc.assignedGroupName === COORD_GROUP && inc.stateId !== STATE.closed;

  useEffect(() => {
    if (!changedAt || !flash.current || reducedMotion()) return;
    gsap.fromTo(flash.current, { opacity: 0.9 }, { opacity: 0, duration: 2.4, ease: 'power2.out' });
  }, [changedAt]);

  useLayoutEffect(() => {
    if (!criticalActive || !glow.current || reducedMotion()) return;
    const tw = gsap.fromTo(glow.current, { opacity: 0.25 }, { opacity: 1, duration: 0.9, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    return () => { tw.kill(); };
  }, [criticalActive]);

  const others = groups.filter((g) => g !== lane);
  const cls = [
    'card',
    `st-${inc.stateId}`,
    `risk-${sla.risk}`,
    criticalActive && 'is-critical',
    critical && resolved && 'is-critical-resolved',
    resolved && 'is-resolved',
    unacked && 'is-new',
  ].filter(Boolean).join(' ');

  return (
    <article
      ref={ref}
      className={cls}
      data-flip-id={inc.id}
      role="link"
      tabIndex={0}
      title="Открыть в ITSM"
      onClick={() => openItsm(inc.id)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && openItsm(inc.id)}
    >
      <span className="flash" ref={flash} aria-hidden />
      {criticalActive && <span className="glow" ref={glow} aria-hidden />}

      <div className="card-top">
        {onTogglePin && <PinButton pinned={!!pinned} limitReached={!!pinLimitReached} onToggle={onTogglePin} />}
        <span className="inc-id">{inc.id}</span>
        <span className={`state state-${inc.stateId}`}>{inc.state}</span>
        {critical && resolved && <span className="stamp">Решён</span>}
        {mailCount > 0 && <span className="mail-badge" title="Письма по инциденту">✉ {mailCount}</span>}
      </div>

      {criticalActive && <div className="card-critical-owner"><CriticalAcceptedBadge ack={criticalAck} showPending /></div>}

      <h3 className="card-title">{inc.header}</h3>
      <p className="product"><b>{inc.productName}</b> {serviceShort(inc)}</p>

      <dl className="facts">
        <div>
          <dt>Решает</dt>
          <dd>
            {inc.assignedGroupName}
            {inc.assignedEmployee ? `, ${personName(inc.assignedEmployee)}` : <i className="muted">, исполнитель не назначен</i>}
          </dd>
        </div>
        <div>
          <dt>Возник</dt>
          <dd>{fmtTime(inc.submitDate, now)}, {fmtAgo(inc.submitDate, now)}</dd>
        </div>
        <div>
          <dt>Заявитель</dt>
          <dd>{personName(inc.initiatorName)}, {inc.receivingChannel.toLowerCase()}</dd>
        </div>
      </dl>

      <Deadline inc={inc} sla={sla} now={now} />

      {(others.length > 0 || inc.isMaster || inc.isDouble || inc.isReason || inc.isNeedUp) && (
        <div className="chips">
          {others.map((g) => <span key={g} className={`chip chip-${g}`}>{GROUP_CHIP[g]}</span>)}
          {inc.isMaster && <span className="chip">мастер-инцидент</span>}
          {inc.isDouble && <span className="chip">дубль</span>}
          {inc.isReason && <span className="chip">дочерний</span>}
          {inc.isNeedUp && <span className="chip chip-warn">нужно устранить последствия</span>}
        </div>
      )}

      {onCoord && (
        <div className="card-actions" onClick={(e) => e.stopPropagation()}>
          {unacked && (
            <button className="btn btn-accept" onClick={() => ack(`coord:${inc.id}`, operator)}>Принял</button>
          )}
          <button className="btn btn-handoff" aria-expanded={handoff} onClick={() => setHandoff((v) => !v)}>
            Передать в команду
          </button>
          {handoff && <Handoff inc={inc} teams={teams} onDone={() => setHandoff(false)} />}
        </div>
      )}
    </article>
  );
}

export const IncidentCard = memo(IncidentCardImpl);
