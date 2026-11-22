import { ThemeSwitch } from '../components/ThemeSwitch';
import { useEffect, useState, type ReactNode } from 'react';
import type { Incident } from '../types';
import { useLiveState, useNow, patchIncident } from '../lib/live';
import { CriticalAcceptedBadge } from '../components/CriticalAcceptedBadge';
import { COORD_GROUP, fmtDuration, fmtTime, resolutionStats, slaOf, isActive } from '../lib/model';

const STATES: [number, string][] = [[0, 'Назначен'], [2, 'Выполняется'], [7, 'Завершен'], [20, 'Исследование ситуации'], [10, 'Закрыт']];
const PRIORITIES: [number, string][] = [[4, 'Наивысший'], [3, 'Высокий'], [2, 'Средний'], [1, 'Низкий']];

const yesNo = (v: boolean | null) => (v === null || v === undefined ? '—' : v ? 'Да' : 'Нет');

function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="it-field">
      <span>{label}</span>
      <div>{children ?? '—'}</div>
    </div>
  );
}

function Editor({ inc, teams }: { inc: Incident; teams: string[] }) {
  const [form, setForm] = useState(() => ({
    stateId: inc.stateId,
    priorityId: inc.priorityId,
    assignedGroupName: inc.assignedGroupName,
    deadline: toLocalInput(inc.deadline),
    solution: inc.solution ?? '',
  }));
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      stateId: inc.stateId,
      priorityId: inc.priorityId,
      assignedGroupName: inc.assignedGroupName,
      deadline: toLocalInput(inc.deadline),
      solution: inc.solution ?? '',
    });
  }, [inc.stateId, inc.priorityId, inc.assignedGroupName, inc.deadline, inc.solution]);

  const save = async (patch: Record<string, unknown>, done: string) => {
    setStatus('Сохраняю…');
    try {
      await patchIncident(inc.id, patch);
      setStatus(done);
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  const allTeams = [COORD_GROUP, ...teams.filter((t) => t !== COORD_GROUP)];
  if (!allTeams.includes(inc.assignedGroupName)) allTeams.push(inc.assignedGroupName);

  return (
    <form
      className="it-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const patch: Record<string, unknown> = {};
        if (Number(form.stateId) !== inc.stateId) patch.stateId = Number(form.stateId);
        if (Number(form.priorityId) !== inc.priorityId) patch.priorityId = Number(form.priorityId);
        if (form.assignedGroupName !== inc.assignedGroupName) patch.assignedGroupName = form.assignedGroupName;
        if (form.deadline !== toLocalInput(inc.deadline)) patch.deadline = form.deadline ? new Date(form.deadline).toISOString() : null;
        if ((form.solution || null) !== (inc.solution || null)) patch.solution = form.solution || null;
        if (!Object.keys(patch).length) return setStatus('Изменений нет');
        void save(patch, 'Изменения сохранены');
      }}
    >
      <h2>Действия</h2>
      {inc.assignedGroupName === COORD_GROUP && (
        <div className="it-quick">
          <p>Инцидент на координаторах. Передайте его в профильную команду.</p>
          <div className="it-quick-row">
            <select value={form.assignedGroupName} onChange={(e) => setForm({ ...form, assignedGroupName: e.target.value })}>
              {allTeams.map((t) => <option key={t}>{t}</option>)}
            </select>
            <button
              type="button"
              className="it-btn it-btn-primary"
              disabled={form.assignedGroupName === COORD_GROUP}
              onClick={() => save({ assignedGroupName: form.assignedGroupName }, `Передан в «${form.assignedGroupName}»`)}
            >
              Передать
            </button>
          </div>
        </div>
      )}
      <label>
        Статус
        <select value={form.stateId} onChange={(e) => setForm({ ...form, stateId: Number(e.target.value) })}>
          {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label>
        Приоритет
        <select value={form.priorityId} onChange={(e) => setForm({ ...form, priorityId: Number(e.target.value) })}>
          {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label>
        Назначенная группа
        <select value={form.assignedGroupName} onChange={(e) => setForm({ ...form, assignedGroupName: e.target.value })}>
          {allTeams.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label>
        Срок решения
        <input type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
      </label>
      <label>
        Описание решения
        <textarea rows={3} value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} />
      </label>
      <div className="it-actions">
        <button type="submit" className="it-btn it-btn-primary">Сохранить</button>
        {isActive(inc) && (
          <button type="button" className="it-btn" onClick={() => save({ stateId: 7, solution: form.solution || 'Работоспособность восстановлена.' }, 'Инцидент решён')}>
            Решить
          </button>
        )}
      </div>
      {status && <p className="it-status">{status}</p>}
    </form>
  );
}

export function ItsmPage({ id }: { id: string }) {
  const { data } = useLiveState();
  const now = useNow(1000);
  const inc = data?.incidents.find((i) => i.id === id);


  if (!data) return <div className="it-page"><p className="it-empty">Загрузка…</p></div>;
  if (!inc) {
    return (
      <div className="it-page">
        <ItsmBar />
        <p className="it-empty">Инцидент {id} не найден в выгрузке.</p>
      </div>
    );
  }

  const sla = slaOf(inc, now, resolutionStats(data.incidents));
  const letters = data.mail.filter((m) => m.incidentId === inc.id);
  const history = data.events.filter((e) => e.incidentId === inc.id && e.type !== 'mail');

  return (
    <div className="it-page">
      <ItsmBar />
      <main className="it-main">
        <section className="it-card">
          <div className="it-title">
            <span className={`it-prio it-prio-${inc.priorityId}`}>{inc.priority}</span>
            <h1>{inc.id}: {inc.header}</h1>
          </div>
          {inc.priorityId === 4 && isActive(inc) && (
            <div className="it-critical-accepted">
              <CriticalAcceptedBadge ack={data.acks[`crit:${inc.id}`]} showPending />
            </div>
          )}
          <p className="it-desc">{inc.description}</p>
          <div className="it-sla">
            {sla.left !== null ? (
              <>
                <b className={sla.left <= 0 ? 'bad' : sla.risk === 'risk' ? 'warn' : ''}>
                  {sla.left > 0 ? `До срока ${fmtDuration(sla.left, true)}` : `Срок нарушен на ${fmtDuration(-sla.left, true)}`}
                </b>
                {sla.forecast && sla.left > 0 && sla.typical && (
                  <span> Прогноз: срок под угрозой, обычно на решение уходит {fmtDuration(sla.typical)}.</span>
                )}
              </>
            ) : (
              <b>{inc.completionDate ? `Решён ${fmtTime(inc.completionDate, now)}` : 'Срок не задан'}</b>
            )}
          </div>

          <div className="it-grid">
            <Field label="Статус">{inc.state}{inc.stateReason && inc.stateReason !== 'Нет' ? `, ${inc.stateReason}` : ''}</Field>
            <Field label="Приоритет">{inc.priority}</Field>
            <Field label="Влияние">{inc.impact}</Field>
            <Field label="Срочность">{inc.urgency}</Field>
            <Field label="Продукт">{inc.productName} ({inc.productMasterId})</Field>
            <Field label="Сервис">{inc.service}</Field>
            <Field label="Сценарий">{inc.scenarioName}</Field>
            <Field label="Тип сервиса">{inc.serviceType}</Field>
            <Field label="Назначенная группа">{inc.assignedGroupName}</Field>
            <Field label="Исполнитель">{inc.assignedEmployee}</Field>
            <Field label="Инициатор">{inc.initiatorName}</Field>
            <Field label="Канал регистрации">{inc.receivingChannel}</Field>
            <Field label="Зарегистрирован">{fmtTime(inc.submitDate, now)}</Field>
            <Field label="Срок решения">{fmtTime(inc.deadline, now)}</Field>
            <Field label="Решён">{fmtTime(inc.completionDate, now)}</Field>
            <Field label="Назначен на группу">{fmtTime(inc.lastAssignmentToTeamDateTime, now)}</Field>
            <Field label="Мастер-инцидент">{yesNo(inc.isMaster)}</Field>
            <Field label="Дубль">{yesNo(inc.isDouble)}</Field>
            <Field label="Дочерний">{yesNo(inc.isReason)}</Field>
            <Field label="Причина дочерних">{yesNo(inc.isEffect)}</Field>
            <Field label="Устранение последствий">{yesNo(inc.isNeedUp)}</Field>
            <Field label="Тип">{inc.incType}</Field>
          </div>
          {inc.solution && (
            <div className="it-solution">
              <h2>Решение</h2>
              <p>{inc.solution}</p>
            </div>
          )}
        </section>

        <aside className="it-side">
          <Editor inc={inc} teams={data.meta.teams} />
          <section className="it-box">
            <h2>Переписка ({letters.length})</h2>
            {!letters.length && <p className="it-muted">Писем по инциденту нет</p>}
            {letters.map((m) => (
              <article key={m.id} className="it-letter">
                <header><b>{m.fromName}</b> <time>{fmtTime(m.receivedAt, now)}</time></header>
                <p className="it-letter-subj">{m.subject}</p>
                <p>{m.body}</p>
              </article>
            ))}
          </section>
          <section className="it-box">
            <h2>История изменений</h2>
            {!history.length && <p className="it-muted">С начала работы дашборда изменений не было</p>}
            <ol className="it-history">
              {history.map((e) => (
                <li key={e.id}><time>{fmtTime(e.at, now)}</time> {e.text}</li>
              ))}
            </ol>
          </section>
        </aside>
      </main>
    </div>
  );
}

function ItsmBar() {
  return (
    <header className="it-bar">
      <b>ITSM</b>
      <span>Учебный муляж для демонстрации пульта координатора</span>
      <ThemeSwitch />
      <a href="/">Вернуться на пульт</a>
    </header>
  );
}
