// Персональные настройки уведомлений. Хранятся только в браузере текущего координатора.
// Никакие изменения здесь не отправляются на сервер и не затрагивают коллег.
import { useCallback, useEffect, useState } from 'react';
import type { Incident } from '../types';
import { COORD_GROUP, STATE } from './model';

export type AlertStatus = 0 | 2 | 20;
export const ALERT_STATUSES: { id: AlertStatus; label: string; description: string }[] = [
  { id: STATE.assigned, label: 'Назначен', description: 'Инцидент назначен на исполнителя' },
  { id: STATE.inProgress, label: 'Выполняется', description: 'Инцидент находится в работе' },
  { id: STATE.research, label: 'Исследование ситуации', description: 'Проводится разбор причин' },
];

export interface NotificationSettings {
  // Критические тревоги
  criticalModal: boolean;
  criticalStatuses: AlertStatus[];
  onlyCoordinatorTeam: boolean;
  criticalBanner: boolean;
  blinkTitle: boolean;
  criticalDesktop: boolean;
  siren: boolean;
  sirenRepeatSeconds: number; // 0 — без повторов
  // Другие события
  coordToasts: boolean;
  resolvedToasts: boolean;
  mailToasts: boolean;
  desktopOther: boolean;
  secondarySounds: boolean;
  soundEnabled: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  criticalModal: true,
  criticalStatuses: [STATE.assigned, STATE.inProgress],
  onlyCoordinatorTeam: false,
  criticalBanner: true,
  blinkTitle: true,
  criticalDesktop: true,
  siren: true,
  sirenRepeatSeconds: 5,
  coordToasts: true,
  resolvedToasts: true,
  mailToasts: true,
  desktopOther: true,
  secondarySounds: true,
  soundEnabled: true,
};

export const settingsStorageKey = (operator: string) => `mi:notification-settings:v1:${operator.trim().toLocaleLowerCase('ru-RU') || 'координатор'}`;
const changedEvent = 'mi:notification-settings-changed';
const repeatValues = [0, 5, 10, 30, 60];

export function readNotificationSettings(operator: string): NotificationSettings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(settingsStorageKey(operator)) || 'null');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...DEFAULT_NOTIFICATION_SETTINGS, criticalStatuses: [...DEFAULT_NOTIFICATION_SETTINGS.criticalStatuses] };
    const s = saved as Record<string, unknown>;
    const result: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS, criticalStatuses: [...DEFAULT_NOTIFICATION_SETTINGS.criticalStatuses] };
    for (const key of Object.keys(result) as (keyof NotificationSettings)[]) {
      if (key === 'criticalStatuses' || key === 'sirenRepeatSeconds') continue;
      if (typeof s[key] === 'boolean') {
        // TS не связывает динамический ключ со значением, кроме явного безопасного приведения.
        (result as unknown as Record<string, unknown>)[key] = s[key];
      }
    }
    if (Array.isArray(s.criticalStatuses)) {
      const selected: unknown[] = s.criticalStatuses;
      result.criticalStatuses = ALERT_STATUSES.map((item) => item.id).filter((id) => selected.includes(id));
    }
    if (typeof s.sirenRepeatSeconds === 'number' && repeatValues.includes(s.sirenRepeatSeconds)) {
      result.sirenRepeatSeconds = s.sirenRepeatSeconds;
    }
    return result;
  } catch {
    return { ...DEFAULT_NOTIFICATION_SETTINGS, criticalStatuses: [...DEFAULT_NOTIFICATION_SETTINGS.criticalStatuses] };
  }
}

function writeNotificationSettings(operator: string, settings: NotificationSettings) {
  try { localStorage.setItem(settingsStorageKey(operator), JSON.stringify(settings)); } catch { /* доступ может быть запрещён */ }
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: { key: settingsStorageKey(operator) } }));
}

export function useNotificationSettings(operator: string) {
  const [settings, setSettings] = useState<NotificationSettings>(() => readNotificationSettings(operator));
  useEffect(() => {
    const key = settingsStorageKey(operator);
    setSettings(readNotificationSettings(operator));
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setSettings(readNotificationSettings(operator));
    };
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === key) setSettings(readNotificationSettings(operator));
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(changedEvent, onChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(changedEvent, onChange);
    };
  }, [operator]);

  const update = useCallback((patch: Partial<NotificationSettings>) => {
    const next = { ...readNotificationSettings(operator), ...patch };
    setSettings(next);
    writeNotificationSettings(operator, next);
  }, [operator]);
  const reset = useCallback(() => {
    const next = { ...DEFAULT_NOTIFICATION_SETTINGS, criticalStatuses: [...DEFAULT_NOTIFICATION_SETTINGS.criticalStatuses] };
    setSettings(next);
    writeNotificationSettings(operator, next);
  }, [operator]);

  return { settings, update, reset };
}

// Фильтр применяется к тревогам, но НЕ к общему списку критических инцидентов.
// Решённые (7) и закрытые (10) намеренно недоступны для повторной тревоги.
export function matchesCriticalAlert(incident: Incident, s: NotificationSettings) {
  return incident.priorityId === 4 && s.criticalStatuses.some((status) => status === incident.stateId)
    && (!s.onlyCoordinatorTeam || incident.assignedGroupName === COORD_GROUP);
}
