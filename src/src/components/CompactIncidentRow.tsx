// Минималистичный вид: одна строка, продукт, срок и действия без лишнего текста.
// По нажатию на строку раскрываются подробности; действия используют существующие API.
import { memo, useId, useState } from 'react';
import type { CardProps } from './IncidentCard';
import { Handoff } from './IncidentCard';
import { Icon } from './Icon';
import { PinButton } from './PinButton';
import { ack } from '../lib/live';
import { COORD_GROUP, STATE, fmtDuration, isActive, isCritical, openItsm, personName, serviceShort } from '../lib/model';

interface CompactProps extends CardProps {
  criticalUnacked?: boolean;
}

function CompactIncidentRowImpl({ inc, sla, operator, teams, unacked, criticalUnacked, pinned, pinLimitReached, onTogglePin }: CompactProps) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [accepting, setAccepting] = useState<'crit' | 'coord' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = isActive(inc);
  const onCoord = inc.assignedGroupName === COORD_GROUP && inc.stateId !== STATE.closed;
  const canTransfer = inc.stateId !== STATE.closed && inc.stateId !== STATE.resolved;
  const product = inc.productName || 'Без продукта';
  // Для длинных сроков используем короткие обозначения дней и часов.
  const compactDuration = (ms: number) => fmtDuration(ms, true).replace(' дн ', 'д ').replace(' ч', 'ч');
  const deadlineLabel = inc.stateId === STATE.research ? 'Разбор'
    : !active ? 'Решён'
      : sla.left === null || !Number.isFinite(sla.left) ? '—'
        : sla.left <= 0 ? `−${compactDuration(-sla.left)}` : compactDuration(sla.left);
  const details = `${inc.id}: ${inc.header}\nПродукт: ${product}\nСервис: ${serviceShort(inc) || '—'}\nСтатус: ${inc.state}\nОтветственный: ${personName(inc.assignedEmployee) || 'Не назначен'}\nКоманда: ${inc.assignedGroupName}`;
  // Краткая выжимка вместо полного описания и повторения всех атрибутов.
  const summary = [inc.shortDescription, inc.header, inc.description]
    .map((value) => (value || '').replace(/\s+/g, ' ').trim())
    .find(Boolean) || 'Описание отсутствует';
  const brief = summary.length > 140 ? `${summary.slice(0, 137).trimEnd()}…` : summary;
  const team = inc.assignedGroupName?.trim() || 'Не назначена';
  const assignee = personName(inc.assignedEmployee).trim() || 'Не назначен';
  const deadlineTitle = inc.stateId === STATE.research ? 'Исследование ситуации'
    : !active ? 'Инцидент решён'
      : sla.left === null || !Number.isFinite(sla.left) ? 'Срок не указан'
        : `${sla.left <= 0 ? 'Просрочен на' : 'До дедлайна'} ${fmtDuration(Math.abs(sla.left), true)}${inc.deadline ? ` · ${new Date(inc.deadline).toLocaleString('ru-RU')}` : ''}`;

  const accept = async (type: 'crit' | 'coord') => {
    setError(null);
    setAccepting(type);
    try {
      await ack(`${type}:${inc.id}`, operator);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось принять инцидент');
    } finally {
      setAccepting(null);
    }
  };

  return (
    <article className={`compact-incident risk-${sla.risk} ${isCritical(inc) && active ? 'is-critical' : ''} ${onCoord && unacked ? 'is-new' : ''}`}
      data-flip-id={inc.id} aria-label={`Инцидент ${inc.id}: ${inc.header}`}>
      <div className="compact-line">
        <button type="button" className="compact-main" title={`${expanded ? 'Свернуть' : 'Развернуть'} подробности · ${details}`}
          onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls={detailId}
          aria-label={`${expanded ? 'Свернуть' : 'Развернуть'} инцидент ${inc.id}: ${inc.header}`}>
          <svg className="compact-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          <span className="compact-product-name">{product}</span>
          <span className={`compact-deadline risk-${sla.risk}`} title={deadlineTitle} aria-label={deadlineTitle}>{deadlineLabel}</span>
        </button>
        <div className="compact-actions" aria-label={`Действия с ${inc.id}`}>
          {criticalUnacked && (
            <button type="button" className="compact-action compact-action-critical" disabled={accepting !== null}
              title="Взять на контроль" aria-label="Взять на контроль" aria-busy={accepting === 'crit'} onClick={() => void accept('crit')}>
              <Icon name="check" />
            </button>
          )}
          {onCoord && unacked && (
            <button type="button" className="compact-action compact-action-accept" disabled={accepting !== null}
              title="Принять инцидент" aria-label="Принять инцидент" aria-busy={accepting === 'coord'} onClick={() => void accept('coord')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
            </button>
          )}
          {onTogglePin && <PinButton pinned={!!pinned} limitReached={!!pinLimitReached} onToggle={onTogglePin} />}
          {canTransfer && (
            <button type="button" className="compact-action compact-action-transfer" title={handoffOpen ? 'Скрыть выбор команды' : 'Передать в команду'}
              aria-label={handoffOpen ? 'Скрыть выбор команды' : 'Передать в команду'} aria-expanded={handoffOpen}
              onMouseDown={(event) => event.stopPropagation()} onClick={() => setHandoffOpen((v) => !v)}>
              <Icon name="coord" />
            </button>
          )}
        </div>
      </div>
      <div id={detailId} className="compact-details" hidden={!expanded}>
        {expanded && <>
          <div className="compact-detail-meta">
            <button type="button" className="compact-open-itsm" title="Открыть в ITSM" aria-label={`Открыть ${inc.id} в ITSM`} onClick={() => openItsm(inc.id)}>
              {inc.id} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg>
            </button>
            <span className={`state state-${inc.stateId}`}>{inc.state}</span>
          </div>
          <div className="compact-detail-problem">
            <span className="compact-detail-label">Суть проблемы</span>
            <p className="compact-detail-summary">{brief}</p>
          </div>
          <dl className="compact-detail-people">
            <div>
              <dt className="compact-detail-label">Команда</dt>
              <dd>{team}</dd>
            </div>
            <div>
              <dt className="compact-detail-label">Ответственный</dt>
              <dd>{assignee}</dd>
            </div>
          </dl>
        </>}
      </div>
      {handoffOpen && canTransfer && <div className="compact-handoff"><Handoff inc={inc} teams={teams} onDone={() => setHandoffOpen(false)} /></div>}
      {error && <p className="compact-error" role="alert">{error}</p>}
    </article>
  );
}

export const CompactIncidentRow = memo(CompactIncidentRowImpl);
