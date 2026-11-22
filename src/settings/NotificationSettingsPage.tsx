import { ThemeSwitch } from '../components/ThemeSwitch';
import { useState } from 'react';
import { useLiveState } from '../lib/live';
import { readOperator } from '../lib/operator-session';
import {
  ALERT_STATUSES, matchesCriticalAlert, useNotificationSettings,
  type AlertStatus,
} from '../lib/notification-settings';

function Switch({ checked, onChange, title, description }: {
  checked: boolean; onChange: (checked: boolean) => void; title: string; description?: string;
}) {
  return (
    <label className="settings-option">
      <span className="settings-option-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
      <input className="settings-switch-input" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-switch" aria-hidden="true" />
    </label>
  );
}

export function NotificationSettingsPage() {
  const [operator] = useState(() => readOperator() || 'Координатор');
  const { settings, update, reset } = useNotificationSettings(operator);
  const { data } = useLiveState();
  const [saved, setSaved] = useState(false);
  const [systemPermission, setSystemPermission] = useState(() => 'Notification' in window ? Notification.permission : 'unsupported');

  const change = (patch: Parameters<typeof update>[0]) => {
    update(patch);
    setSaved(true);
  };
  const selectedStatuses = settings.criticalStatuses;
  const toggleStatus = (id: AlertStatus, enabled: boolean) => {
    const statuses = enabled
      ? ALERT_STATUSES.map((x) => x.id).filter((x) => x === id || selectedStatuses.includes(x))
      : selectedStatuses.filter((x) => x !== id);
    change({ criticalStatuses: statuses });
  };
  const eligible = (data?.incidents || []).filter((i) => matchesCriticalAlert(i, settings));
  const pending = eligible.filter((i) => !i.assignedEmployee && !data?.acks[`crit:${i.id}`]);

  return (
    <div className="settings-page">
      <header className="settings-header">
        <a href="/" className="settings-back">← На дашборд</a>
        <div className="settings-brand"><span className="settings-brand-dot" /> Пульт МИ <span className="settings-separator">/</span> Настройки</div>
        <ThemeSwitch />
        <a className="settings-header-link" href="/cabinet">Личный кабинет</a>
      </header>
      <main className="settings-container">
        <div className="settings-heading">
          <div>
            <div className="settings-eyebrow">Персональные параметры · {operator}</div>
            <h1>Настройки интерфейса и уведомлений</h1>
            <p>Выбирайте отображение категорий и управляйте уведомлениями. Настройки сохраняются автоматически в этом браузере для выбранного координатора.</p>
          </div>
          <button className="settings-reset" onClick={() => {
            if (window.confirm('Сбросить настройки интерфейса и уведомлений до стандартных?')) { reset(); setSaved(false); }
          }}>Сбросить настройки</button>
        </div>
        <div className="settings-content">
          <div className="settings-main">
            <section className="settings-section" aria-labelledby="view-mode-title">
              <div className="settings-section-header">
                <div className="settings-section-icon is-blue" aria-hidden="true">▤</div>
                <div>
                  <h2 id="view-mode-title">Отображение инцидентов</h2>
                  <p>Выберите, как показывать инциденты внутри категорий дашборда</p>
                </div>
              </div>
              <div className="settings-view-options" role="radiogroup" aria-label="Вид инцидентов в категориях">
                <label className={`settings-view-choice ${settings.incidentViewMode === 'cards' ? 'is-selected' : ''}`}>
                  <input type="radio" name="incidentViewMode" value="cards" checked={settings.incidentViewMode === 'cards'} onChange={() => change({ incidentViewMode: 'cards' })} />
                  <span className="settings-view-choice-content">
                    <strong>Подробные карточки</strong>
                    <small>Описание, статус, сроки, исполнитель и дополнительные сведения</small>
                    <span className="settings-preview-card" aria-hidden="true">
                      <b>INC000000123 · Веб-портал</b><span>Проблема с доступностью сервиса</span><i>Ответственный · осталось 1 ч 12 мин</i>
                    </span>
                  </span>
                </label>
                <label className={`settings-view-choice ${settings.incidentViewMode === 'compact' ? 'is-selected' : ''}`}>
                  <input type="radio" name="incidentViewMode" value="compact" checked={settings.incidentViewMode === 'compact'} onChange={() => change({ incidentViewMode: 'compact' })} />
                  <span className="settings-view-choice-content">
                    <strong>Минималистичный вид</strong>
                    <small>Одна строка: продукт, дедлайн и быстрые действия. Остальное — в ITSM.</small>
                    <span className="settings-preview-compact" aria-hidden="true">
                      <span>Веб-портал</span><b>1:12:40</b><i>✓</i><i>↗</i>
                    </span>
                  </span>
                </label>
              </div>
              <p className="settings-view-note">Выбор действует только для координатора «{operator}». Состав категорий, уведомления и действия с инцидентами не меняются.</p>
            </section>
            <section className="settings-section" aria-labelledby="critical-title">
              <div className="settings-section-header">
                <div className="settings-section-icon is-critical" aria-hidden="true">!</div>
                <div><h2 id="critical-title">Критические инциденты</h2><p>Правила показа полноэкранной тревоги и её сопровождения</p></div>
              </div>
              <Switch title="Показывать модальное окно" description="Окно с кнопками «Принял, беру на контроль» и «Не беру на контроль»" checked={settings.criticalModal} onChange={(criticalModal) => change({ criticalModal })} />
              <Switch title="Всплывающие уведомления о критических" description="Краткое сообщение на любой странице, даже если модальное окно отключено" checked={settings.criticalToasts} onChange={(criticalToasts) => change({ criticalToasts })} />
              <div className="settings-nested" role="group" aria-label="Статусы для критической тревоги">
                <div className="settings-nested-title">При каких статусах показывать тревогу</div>
                <p>Отбираются инциденты с наивысшим приоритетом. Решённые и закрытые не вызывают тревогу.</p>
                <div className="settings-statuses">
                  {ALERT_STATUSES.map((item) => (
                    <label key={item.id} className="settings-status">
                      <input type="checkbox" checked={selectedStatuses.includes(item.id)} onChange={(e) => toggleStatus(item.id, e.target.checked)} />
                      <span><strong>{item.label}</strong><small>{item.description}</small></span>
                    </label>
                  ))}
                </div>
                {selectedStatuses.length === 0 && <p className="settings-warning">Ни один статус не выбран — тревожное окно не появится.</p>}
              </div>
              <Switch title="Только на группе координаторов" description="Не показывать тревогу для инцидентов, назначенных другим командам" checked={settings.onlyCoordinatorTeam} onChange={(onlyCoordinatorTeam) => change({ onlyCoordinatorTeam })} />
              <Switch title="Показывать красную полосу на всех страницах" description="Отдельное постоянное напоминание об активных критических инцидентах" checked={settings.criticalBanner} onChange={(criticalBanner) => change({ criticalBanner })} />
              <Switch title="Мигать названием вкладки" description="Помогает заметить неподтверждённые критические инциденты" checked={settings.blinkTitle} onChange={(blinkTitle) => change({ blinkTitle })} />
              <Switch title="Системные уведомления о критических" description="Уведомление браузера при новом критическом инциденте, когда вкладка неактивна" checked={settings.criticalDesktop} onChange={(criticalDesktop) => change({ criticalDesktop })} />
            </section>
            <section className="settings-section" aria-labelledby="audio-title">
              <div className="settings-section-header">
                <div className="settings-section-icon is-blue" aria-hidden="true">♪</div>
                <div><h2 id="audio-title">Звуковое сопровождение</h2><p>Настройка звука без изменения сигналов у других координаторов</p></div>
              </div>
              <Switch title="Включить звуки" description="Общий переключатель: действует также на быструю кнопку в дашборде" checked={settings.soundEnabled} onChange={(soundEnabled) => change({ soundEnabled })} />
              <Switch title="Сирена критической тревоги" description="Сирена работает независимо от модального окна, для инцидентов с выбранным статусом" checked={settings.siren} onChange={(siren) => change({ siren })} />
              <div className="settings-select-row">
                <div><strong>Повторять сирену</strong><small>0 секунд — проиграть один раз, без повторения</small></div>
                <select value={settings.sirenRepeatSeconds} disabled={!settings.siren} onChange={(e) => change({ sirenRepeatSeconds: Number(e.target.value) })} aria-label="Интервал повтора сирены">
                  <option value={0}>Не повторять</option>
                  <option value={5}>Каждые 5 секунд</option>
                  <option value={10}>Каждые 10 секунд</option>
                  <option value={30}>Каждые 30 секунд</option>
                  <option value={60}>Каждую минуту</option>
                </select>
              </div>
              <Switch title="Звуки остальных событий" description="Назначения на координаторов, решения инцидентов, важные письма и изменение приоритета" checked={settings.secondarySounds} onChange={(secondarySounds) => change({ secondarySounds })} />
            </section>
            <section className="settings-section" aria-labelledby="other-title">
              <div className="settings-section-header">
                <div className="settings-section-icon is-green" aria-hidden="true">✓</div>
                <div><h2 id="other-title">Остальные уведомления</h2><p>Выберите события для всплывающих сообщений</p></div>
              </div>
              <Switch title="Назначения на координаторов" description="Показывать сообщение о поступлении нового инцидента в команду" checked={settings.coordToasts} onChange={(coordToasts) => change({ coordToasts })} />
              <Switch title="Решение критического инцидента" description="Показывать сообщение о завершении критического инцидента" checked={settings.resolvedToasts} onChange={(resolvedToasts) => change({ resolvedToasts })} />
              <Switch title="Важные письма" description="Показывать уведомления о новых важных письмах" checked={settings.mailToasts} onChange={(mailToasts) => change({ mailToasts })} />
              <Switch title="Системные уведомления об остальных событиях" description="Работают только при разрешении браузера и неактивной вкладке" checked={settings.desktopOther} onChange={(desktopOther) => change({ desktopOther })} />
            </section>
          </div>
          <aside className="settings-aside">
            <div className="settings-summary">
              <h3>Предпросмотр правил</h3>
              <span className="settings-summary-caption">Инцидентов, подходящих под фильтр</span>
              <strong className="settings-summary-number">{eligible.length}</strong>
              <span className="settings-summary-caption">Из них ещё не подтверждены: <b>{pending.length}</b></span>
              <div className="settings-summary-line" />
              <p>{!settings.criticalModal ? 'Модальное окно отключено.' : !selectedStatuses.length ? 'Выберите хотя бы один статус.' : pending.length ? 'При начале смены для подходящих неподтверждённых инцидентов появится тревога.' : 'Сейчас нет подходящих неподтверждённых инцидентов.'}</p>
              <small>Показанные числа не меняют состав категорий дашборда. Серверные подтверждения остаются общими.</small>
            </div>
            <div className="settings-summary settings-browser">
              <h3>Уведомления браузера</h3>
              <p>{systemPermission === 'granted' ? 'Разрешены браузером' : systemPermission === 'denied' ? 'Запрещены настройками браузера' : systemPermission === 'unsupported' ? 'Не поддерживаются этим браузером' : 'Необходимо разрешение браузера'}</p>
              {systemPermission === 'default' && <button onClick={() => void Notification.requestPermission().then(setSystemPermission)}>Разрешить уведомления</button>}
              <small>Настройка системы и ваши личные переключатели действуют независимо.</small>
            </div>
            <div className="settings-summary settings-note">
              <h3>Как работают настройки</h3>
              <p>«Не беру на контроль» скрывает конкретную тревогу только в вашем сеансе. Настройки этой страницы сохраняются для {operator} в текущем браузере, а подтверждение «Принял» остаётся общим действием для всех координаторов.</p>
              <a href="/">Вернуться к дашборду</a>
            </div>
            {saved && <p className="settings-saved" role="status">✓ Изменения сохранены автоматически</p>}
          </aside>
        </div>
      </main>
    </div>
  );
}
