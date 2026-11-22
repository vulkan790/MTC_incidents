import { ThemeSwitch } from '../components/ThemeSwitch';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Letter } from '../types';
import { useConnection, useLiveState } from '../lib/live';
import { fmtTime, openItsm } from '../lib/model';
import { Icon } from '../components/Icon';
import { useMobileLayout } from '../lib/mobile';
import { readOperator, rememberOperator } from '../lib/operator-session';

type Folder = 'inbox' | 'potential' | 'archive' | 'spam';
const routeId = () => {
  const match = window.location.pathname.match(/^\/cabinet\/mail\/([^/]+)\/?$/);
  try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
};

async function request(url: string, method: 'PATCH' | 'POST', body?: object) {
  const response = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Ошибка ${response.status}`);
  return result;
}

const updateLetter = (id: string, patch: object) => request(`/api/mail/${encodeURIComponent(id)}`, 'PATCH', patch);
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? '').join('').toUpperCase() || 'К';

export function CabinetPage() {
  const { data, isError } = useLiveState();
  const connection = useConnection();
  const [operator, setOperator] = useState(() => readOperator() || 'Координатор');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(operator);
  const [folder, setFolder] = useState<Folder>(routeId() ? 'potential' : 'inbox');
  const [selectedId, setSelectedId] = useState<string | null>(routeId);
  const mobile = useMobileLayout();
  const [mobileReading, setMobileReading] = useState(() => !!routeId());
  const mailPanel = useRef<HTMLElement>(null);
  const reader = useRef<HTMLElement>(null);
  const listScroll = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const mailReady = !!data;
  useEffect(() => {
    if (!mobile) return;
    if (mobileReading) {
      reader.current?.scrollIntoView({ block: 'start' });
    } else if (listScroll.current) {
      listScroll.current.scrollTop = listPosition.current;
    }
  }, [mobile, mobileReading, mailReady]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState('');
  const [convertOpen, setConvertOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkId, setLinkId] = useState('');
  const [priorityId, setPriorityId] = useState(2);
  const [team, setTeam] = useState('');

  const mails = useMemo(() => [...(data?.mail ?? [])].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)), [data?.mail]);
  const selected = mails.find((mail) => mail.id === selectedId) ?? null;
  const matchesFolder = (mail: Letter, f: Folder) => {
    if (f === 'potential') return mail.folder === 'inbox' && mail.analysis?.isPotential;
    return mail.folder === f;
  };
  const counters = {
    inbox: mails.filter((mail) => mail.folder === 'inbox').length,
    potential: mails.filter((mail) => matchesFolder(mail, 'potential')).length,
    archive: mails.filter((mail) => mail.folder === 'archive').length,
    spam: mails.filter((mail) => mail.folder === 'spam').length,
  };
  const visible = mails.filter((m) => matchesFolder(m, folder) && [m.subject, m.fromName, m.fromAddress, m.body, m.incidentId ?? '']
    .some((part) => part.toLowerCase().includes(search.trim().toLowerCase())));

  useEffect(() => {
    if (!data || !selectedId) return;
    const mail = mails.find((m) => m.id === selectedId);
    if (!mail) return;
    if (!matchesFolder(mail, folder)) setFolder(mail.folder === 'inbox' && mail.analysis.isPotential ? 'potential' : mail.folder);
  }, [data?.version, selectedId]);

  useEffect(() => {
    if (!selected || selected.read || (mobile && !mobileReading)) return;
    void updateLetter(selected.id, { read: true }).catch(() => {});
  }, [selected?.id, selected?.read, mobile, mobileReading]);

  const pickMail = (id: string) => {
    if (mobile) {
      listPosition.current = listScroll.current?.scrollTop ?? 0;
      setMobileReading(true);
    }
    setSelectedId(id);
    setBanner('');
    setConvertOpen(false);
    setLinkOpen(false);
    window.history.replaceState(null, '', `/cabinet/mail/${encodeURIComponent(id)}`);
  };
  const switchFolder = (next: Folder) => {
    setFolder(next);
    setSearch('');
    setBanner('');
    const first = mails.find((mail) => matchesFolder(mail, next));
    setSelectedId(mobile ? null : first?.id ?? null);
    setMobileReading(false);
    listPosition.current = 0;
    if (listScroll.current) listScroll.current.scrollTop = 0;
    window.history.replaceState(null, '', '/cabinet');
  };

  const action = async (fn: () => Promise<unknown>, label: string) => {
    if (busy) return;
    setBusy(true);
    setBanner('');
    try { await fn(); setBanner(label); }
    catch (err) { setBanner(`Ошибка: ${(err as Error).message}`); }
    finally { setBusy(false); }
  };

  const saveName = () => {
    const clean = nameDraft.trim().slice(0, 60) || 'Координатор';
    rememberOperator(clean);
    setOperator(clean);
    setEditingName(false);
  };

  if (!data) return <div className="boot">{isError ? 'Нет связи с сервером почты. Проверьте npm run dev.' : 'Загрузка личного кабинета…'}</div>;

  const assignedTeam = team || data.meta.coordGroup;

  return (
    <div className="cabinet-page">
      <header className="cabinet-topbar">
        <a className="cabinet-back" href="/">← <span>На дашборд</span></a>
        <div className="cabinet-brand"><span className="cabinet-brand-dot" />Пульт МИ <span className="cabinet-brand-sep">/</span> Личный кабинет</div>
        <div className={`cabinet-connection ${connection}`}>{connection === 'online' ? '● Почта синхронизирована' : '● Подключение…'}</div>
        <ThemeSwitch />
        <span className="cabinet-mini-avatar">{initials(operator)}</span>
      </header>

      <main className="cabinet-main">
        <div className="cabinet-title-row">
          <div><h1>Личный кабинет</h1><p>Профиль координатора и работа с письмами по инцидентам</p></div>
          <div className="cabinet-profile-links"><a href="/settings" className="cabinet-dashboard-link">⚙ Настройки уведомлений</a><a href="/" className="cabinet-dashboard-link">Пульт инцидентов ↗</a></div>
        </div>

        <section className="cabinet-profile" aria-label="Профиль координатора">
          <div className="cabinet-profile-avatar">{initials(operator)}</div>
          <div className="cabinet-profile-person">
            <span className="cabinet-caption">Координатор смены</span>
            {editingName ? (
              <form className="cabinet-name-form" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
                <input value={nameDraft} maxLength={60} onChange={(e) => setNameDraft(e.target.value)} autoFocus aria-label="Имя координатора" />
                <button type="submit">Сохранить</button>
              </form>
            ) : <div className="cabinet-name"><b>{operator}</b><button onClick={() => { setNameDraft(operator); setEditingName(true); }} title="Изменить отображаемое имя">Изменить</button></div>}
            <span className="cabinet-subline">Локальный профиль для демонстрации · без SSO</span>
          </div>
          <div className="cabinet-profile-field"><span>Команда</span><strong>{data.meta.coordGroup}</strong></div>
          <div className="cabinet-profile-field"><span>Почтовый ящик</span><strong>Демо-почта координатора</strong><small>Источник: data/mail.json</small></div>
        </section>

        <section ref={mailPanel} className="cabinet-mail-panel" aria-label="Рабочая почта">
          <div className="cabinet-mail-heading">
            <div><h2><Icon name="mail" /> Почта</h2><p>Письма проходят триаж. Создать инцидент можно только вручную.</p></div>
            <div className="cabinet-ai-actions">
              <span className={`cabinet-ai-state ${data.meta.ai.available ? 'ready' : ''}`} title={data.meta.ai.details}>
                <span className="cabinet-ai-indicator" />{data.meta.ai.available ? `ИИ: ${data.meta.ai.model}` : 'Анализ по правилам'}
              </span>
              <button className="cabinet-btn cabinet-btn-quiet" disabled={busy} onClick={() => void action(async () => {
                await request('/api/mail/analyze', 'POST');
              }, 'Проверка входящих запущена. Результаты будут обновляться автоматически.')}>Повторить анализ</button>
            </div>
          </div>
          <div className={`cabinet-mail-layout ${mobile && mobileReading ? 'mobile-reading' : ''}`}>
            <nav className="cabinet-folders" aria-label="Папки почты">
              <button className={folder === 'inbox' ? 'active' : ''} onClick={() => switchFolder('inbox')}><span>Входящие</span><b>{counters.inbox}</b></button>
              <button className={folder === 'potential' ? 'active' : ''} onClick={() => switchFolder('potential')}><span>Потенциальные инциденты</span><b>{counters.potential}</b></button>
              <button className={folder === 'archive' ? 'active' : ''} onClick={() => switchFolder('archive')}><span>Архив</span><b>{counters.archive}</b></button>
              <button className={folder === 'spam' ? 'active' : ''} onClick={() => switchFolder('spam')}><span>Спам</span><b>{counters.spam}</b></button>
              <div className="cabinet-folders-note">{data.meta.ai.details}. Письма не отправляются во внешние платные сервисы.</div>
            </nav>

            <div className="cabinet-letter-list">
              <div className="cabinet-list-tools"><input type="search" placeholder="Поиск по почте" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск писем" /><span>{visible.length} писем</span></div>
              <div className="cabinet-letters-scroll" ref={listScroll}>
                {visible.length === 0 && <p className="cabinet-empty">В этой папке нет писем по выбранному запросу.</p>}
                {visible.map((m) => (
                  <button key={m.id} className={`cabinet-letter ${selected?.id === m.id ? 'selected' : ''} ${m.read ? '' : 'unread'}`} onClick={() => pickMail(m.id)}>
                    <span className="cabinet-letter-top"><span className="cabinet-sender"><i className="cabinet-unread-dot" />{m.fromName}</span><time>{fmtTime(m.receivedAt, Date.now())}</time></span>
                    <span className="cabinet-letter-subject">{m.subject}</span>
                    <span className="cabinet-letter-preview">{m.body}</span>
                    <span className="cabinet-letter-tags">
                      {m.analysis.isPotential && <em className="cabinet-tag-risk">Возможный инцидент</em>}
                      {m.incidentId && <em className="cabinet-tag-linked">{m.incidentId}</em>}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <article className="cabinet-reader" ref={reader}>
              {mobile && <button type="button" className="cabinet-mobile-back" onClick={() => {
                setMobileReading(false);
                setConvertOpen(false);
                setLinkOpen(false);
                window.history.replaceState(null, '', '/cabinet');
                requestAnimationFrame(() => mailPanel.current?.scrollIntoView({ block: 'start' }));
              }}>← К списку писем</button>}
              {!selected ? <div className="cabinet-reader-empty"><Icon name="mail" /><h3>Выберите письмо</h3><p>Откройте сообщение, чтобы увидеть анализ и доступные действия.</p></div> : (
                <>
                  <div className="cabinet-reader-header"><h3>{selected.subject}</h3><div className="cabinet-reader-meta"><span><b>{selected.fromName}</b> · {selected.fromAddress}</span><time>{new Date(selected.receivedAt).toLocaleString('ru-RU')}</time></div></div>
                  <div className="cabinet-reader-toolbar">
                    {selected.incidentId ? <button className="cabinet-btn cabinet-btn-primary" onClick={() => openItsm(selected.incidentId!)}>Открыть {selected.incidentId} ↗</button>
                      : <button className="cabinet-btn cabinet-btn-primary" onClick={() => { setConvertOpen((x) => !x); setLinkOpen(false); }} aria-expanded={convertOpen}>В инцидент</button>}
                    {!selected.incidentId && <button className="cabinet-btn cabinet-btn-quiet" onClick={() => { setLinkOpen((x) => !x); setConvertOpen(false); }}>Связать с ITSM</button>}
                    <button className="cabinet-btn cabinet-btn-quiet" disabled={busy} onClick={() => void action(() => updateLetter(selected.id, { folder: selected.folder === 'archive' ? 'inbox' : 'archive' }), selected.folder === 'archive' ? 'Письмо возвращено во входящие' : 'Перемещено в архив')}>{selected.folder === 'archive' ? 'Из архива' : 'В архив'}</button>
                    <button className="cabinet-btn cabinet-btn-quiet" disabled={busy} onClick={() => void action(() => updateLetter(selected.id, { folder: selected.folder === 'spam' ? 'inbox' : 'spam' }), selected.folder === 'spam' ? 'Письмо возвращено' : 'Перемещено в спам')}>{selected.folder === 'spam' ? 'Не спам' : 'Спам'}</button>
                    <button className="cabinet-btn cabinet-btn-quiet" disabled={busy} onClick={() => void action(() => updateLetter(selected.id, { read: !selected.read }), selected.read ? 'Отмечено как непрочитанное' : 'Письмо прочитано')}>{selected.read ? 'Не прочитано' : 'Прочитано'}</button>
                  </div>
                  {convertOpen && !selected.incidentId && <form className="cabinet-create-form" onSubmit={(e) => { e.preventDefault(); void action(async () => {
                    const created = await request(`/api/mail/${encodeURIComponent(selected.id)}/incident`, 'POST', { priorityId, team: assignedTeam });
                    setConvertOpen(false);
                    setBanner(`Создан ${created.incidentId}. Инцидент привязан к письму.`);
                  }, 'Инцидент создан и привязан к письму'); }}>
                    <b>Создать новый инцидент в демо-ITSM?</b><p>Только после подтверждения. Анализ ИИ ничего не создаёт.</p>
                    <div className="cabinet-form-row"><label>Приоритет<select value={priorityId} onChange={(e) => setPriorityId(Number(e.target.value))}><option value={1}>Низкий</option><option value={2}>Средний</option><option value={3}>Высокий</option><option value={4}>Наивысший</option></select></label><label>Команда<select value={assignedTeam} onChange={(e) => setTeam(e.target.value)}><option value={data.meta.coordGroup}>{data.meta.coordGroup}</option>{data.meta.teams.map((t) => <option key={t} value={t}>{t}</option>)}</select></label></div>
                    <div className="cabinet-form-buttons"><button className="cabinet-btn cabinet-btn-primary" type="submit" disabled={busy}>Подтвердить создание</button><button className="cabinet-btn cabinet-btn-quiet" type="button" onClick={() => setConvertOpen(false)}>Отмена</button></div>
                  </form>}
                  {linkOpen && !selected.incidentId && <form className="cabinet-create-form" onSubmit={(e) => { e.preventDefault(); void action(async () => {
                    await request(`/api/mail/${encodeURIComponent(selected.id)}/link`, 'POST', { incidentId: linkId });
                    setLinkOpen(false);
                  }, `Письмо связано с ${linkId.toUpperCase()}`); }}><label>Номер существующего инцидента<input value={linkId} onChange={(e) => setLinkId(e.target.value)} placeholder="INC000021941837" required /></label><div className="cabinet-form-buttons"><button className="cabinet-btn cabinet-btn-primary" type="submit" disabled={busy}>Связать</button><button type="button" className="cabinet-btn cabinet-btn-quiet" onClick={() => setLinkOpen(false)}>Отмена</button></div></form>}
                  {banner && <div className={`cabinet-action-banner ${banner.startsWith('Ошибка') ? 'error' : ''}`} role="status">{banner}</div>}
                  <section className={`cabinet-analysis ${selected.analysis.isPotential ? 'potential' : ''}`}>
                    <div className="cabinet-analysis-head"><strong>{selected.analysis.isPotential ? 'Возможный инцидент' : 'Признаков инцидента не обнаружено'}</strong><span>{selected.analysis.source === 'ollama' ? 'Ollama · ИИ' : selected.analysis.source === 'manual' ? 'Решение координатора' : 'Проверка по правилам'}{selected.analysis.source !== 'manual' ? ` · ${Math.round(selected.analysis.confidence * 100)}%` : ''}</span></div>
                    <p>{selected.analysis.reason}</p>
                    <div className="cabinet-analysis-controls"><button disabled={busy} onClick={() => void action(() => request(`/api/mail/${encodeURIComponent(selected.id)}/analyze`, 'POST'), 'Письмо проанализировано')} className="cabinet-text-btn">Проверить ещё раз</button><button disabled={busy} onClick={() => void action(() => updateLetter(selected.id, { potential: !selected.analysis.isPotential }), selected.analysis.isPotential ? 'Письмо исключено из потенциальных инцидентов' : 'Письмо добавлено в потенциальные инциденты')} className="cabinet-text-btn">{selected.analysis.isPotential ? 'Не инцидент' : 'Это инцидент'}</button></div>
                  </section>
                  <div className="cabinet-letter-body">{selected.body}</div>
                  <div className="cabinet-reader-bottom">Источник: {selected.fromAddress} · ID письма: {selected.id}</div>
                </>
              )}
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
