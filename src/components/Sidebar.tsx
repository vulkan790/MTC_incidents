import type { Letter, LiveEvent } from '../types';
import { fmtClock, fmtTime, openItsm, personName } from '../lib/model';
import type { ColumnDnd } from '../lib/layout';
import { Icon } from './Icon';

export interface DeadlineSummary {
  active: number;
  overdue: number;
  risk: number;
}

interface Props {
  events: LiveEvent[];
  mail: Letter[];
  now: number;
  summary: DeadlineSummary;
  dnd?: ColumnDnd;
}

export function Sidebar({ events, mail, now, summary, dnd }: Props) {
  return (
    <aside className={`sidebar ${dnd?.className ?? ''}`} data-col="side" {...dnd?.zone}>
      <section className="kpi kpi-sla" aria-label="Контроль сроков" {...dnd?.handle}>
        <div className="kpi-head">
          <div className="kpi-title">
            <span className="kpi-icon"><Icon name="clock" /></span>
            <h2 className="kpi-label">Контроль сроков</h2>
          </div>
          <span className="kpi-sub">из {summary.active} активных</span>
        </div>
        {dnd && <span className="kpi-grip" aria-hidden>⠿</span>}
        <div className="kpi-pair">
          <div className={summary.overdue ? 'is-bad' : ''}>
            <span className="kpi-value">{summary.overdue}</span>
            <span className="kpi-sub">просрочено</span>
          </div>
          <div className={summary.risk ? 'is-warn' : ''}>
            <span className="kpi-value">{summary.risk}</span>
            <span className="kpi-sub">под угрозой</span>
          </div>
        </div>
      </section>
      <section className="side-block">
        <h2><Icon name="activity" />События смены</h2>
        {!events.length && <p className="side-empty">Изменения из ITSM появятся здесь, как только придут</p>}
        <ol className="feed">
          {events.slice(0, 40).map((e) => (
            <li key={e.id} className={`feed-item lvl-${e.level}`}>
              <time>{fmtClock(e.at)}</time>
              <button disabled={!e.incidentId} onClick={() => e.incidentId && openItsm(e.incidentId)}>
                <span className="feed-text">{e.text}</span>
                {e.incidentId && <span className="feed-inc">{e.incidentId}{e.product ? `, ${e.product}` : ''}</span>}
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section className="side-block">
        <h2><Icon name="mail" />Почта по инцидентам</h2>
        <ol className="mail">
          {mail.slice(0, 30).map((m) => (
            <li key={m.id} className={m.important ? 'is-important' : ''}>
              <button disabled={!m.incidentId} onClick={() => m.incidentId && openItsm(m.incidentId)} title={m.body}>
                <span className="mail-meta">
                  <b>{personName(m.fromName) || m.fromName}</b>
                  <time>{fmtTime(m.receivedAt, now)}</time>
                </span>
                <span className="mail-subject">{m.subject}</span>
                <span className="mail-body">{m.body}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
