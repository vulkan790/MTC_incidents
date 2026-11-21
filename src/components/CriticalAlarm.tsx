// Полноэкранная тревога о критическом инциденте. Не исчезает, пока координатор не подтвердит,
// и всё это время звучит сирена. Пропустить критический невозможно.
import { useLayoutEffect, useRef } from 'react';
import type { Incident } from '../types';
import { gsap, reducedMotion } from '../lib/motion';
import { fmtDuration, fmtTime, openItsm, personName, serviceShort } from '../lib/model';
import { ack } from '../lib/live';

interface Props {
  incidents: Incident[];
  now: number;
  operator: string;
}

export function CriticalAlarm({ incidents, now, operator }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const current = incidents[0];
  const id = current?.id;

  useLayoutEffect(() => {
    if (!root.current || !id) return;
    const ctx = gsap.context(() => {
      if (reducedMotion()) return;
      const tl = gsap.timeline();
      tl.fromTo('.alarm-bg', { opacity: 0 }, { opacity: 1, duration: 0.25 })
        .fromTo('.alarm-panel', { scale: 1.18, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(1.6)' }, 0.05)
        .fromTo('.alarm-panel > *', { y: 16, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.05, duration: 0.35 }, 0.3);
      gsap.to('.alarm-bg', { '--pulse': 1, duration: 0.6, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      gsap.fromTo('.alarm-beacon', { rotate: 0 }, { rotate: 360, duration: 1.6, repeat: -1, ease: 'none' });
    }, root);
    return () => ctx.revert();
  }, [id]);

  if (!current) return null;
  const left = current.deadline ? Date.parse(current.deadline) - now : null;

  return (
    <div className="alarm" ref={root} role="alertdialog" aria-modal="true" aria-labelledby="alarm-title">
      <div className="alarm-bg" />
      <div className="alarm-panel">
        <div className="alarm-head">
          <span className="alarm-beacon" aria-hidden />
          <h1 id="alarm-title">Критический инцидент</h1>
          {incidents.length > 1 && <span className="alarm-more">и ещё {incidents.length - 1} ждут подтверждения</span>}
        </div>
        <p className="alarm-product">{current.productName}</p>
        <p className="alarm-header">{current.header}</p>
        <div className="alarm-grid">
          <div><span>Сервис</span><b>{serviceShort(current)}</b></div>
          <div><span>Возник</span><b>{fmtTime(current.submitDate, now)}</b></div>
          <div><span>Решает</span><b>{current.assignedGroupName}{current.assignedEmployee ? `, ${personName(current.assignedEmployee)}` : ''}</b></div>
          <div><span>Канал</span><b>{current.receivingChannel}</b></div>
        </div>
        <div className="alarm-timer">
          <span>{left === null ? 'Срок не задан' : left > 0 ? 'До срока решения' : 'Срок решения нарушен'}</span>
          <b>{left === null ? '—' : fmtDuration(Math.abs(left), true)}</b>
          <small>{current.id}, срок {fmtTime(current.deadline, now)}</small>
        </div>
        <div className="alarm-actions">
          <button className="btn btn-alarm" autoFocus onClick={() => ack(`crit:${current.id}`, operator)}>
            Принял, беру на контроль
          </button>
          <button className="btn btn-ghost-light" onClick={() => openItsm(current.id)}>Открыть в ITSM</button>
        </div>
      </div>
    </div>
  );
}
