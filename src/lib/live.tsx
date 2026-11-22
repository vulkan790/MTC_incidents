// Живые данные: первичная загрузка через React Query, дальше сервер присылает актуальное состояние по WebSocket,
// и мы кладём его прямо в кэш React Query. Если сокет отвалился — включается лёгкий опрос /api/stage.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LiveEvent, LiveState } from '../types';

export type Connection = 'connecting' | 'online' | 'offline';

type Listener = (events: LiveEvent[], state: LiveState) => void;
const listeners = new Set<Listener>();
export function onLiveEvents(fn: Listener) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

const ConnectionContext = createContext<Connection>('connecting');
export const useConnection = () => useContext(ConnectionContext);

async function fetchState(): Promise<LiveState> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
  return res.json();
}

// Резервный канал для хостингов, где Passenger или прокси не пропускает WebSocket.
// Сервер отдаёт тот же снимок состояния по этому адресу.
async function fetchStage(since?: number): Promise<LiveState | null> {
  const query = since === undefined ? '' : `?since=${encodeURIComponent(since)}`;
  const res = await fetch(`/api/stage${query}`, { cache: 'no-store' });
  if (res.status === 204 || res.status === 304) return null;
  if (!res.ok) throw new Error(`Резервный API ответил ${res.status}`);
  return res.json();
}

// Вызывается после любого успешного POST/PATCH, чтобы состояние не ждало таймера.
export function refreshLiveState() {
  window.dispatchEvent(new Event('mi:live-refresh'));
}

export function useLiveState() {
  return useQuery({
    queryKey: ['state'],
    queryFn: fetchState,
    staleTime: Infinity,
  });
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [connection, setConnection] = useState<Connection>('connecting');
  const retry = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    let inFlight = false;
    let stopped = false;

    const stopPolling = () => {
      polling = false;
      clearTimeout(pollTimer);
    };

    const pullStage = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const current = qc.getQueryData<LiveState>(['state']);
        const stage = await fetchStage(current?.version);
        if (stopped) return;
        if (stage) qc.setQueryData(['state'], stage);
        setConnection('online');
      } catch {
        if (!stopped) setConnection('offline');
      } finally {
        inFlight = false;
      }
    };

    const pollStage = async () => {
      if (stopped || !polling) return;
      await pullStage();
      if (!stopped && polling) {
        // 2 секунды дают почти мгновенное обновление внешних изменений,
        // а при отсутствии изменений endpoint отвечает 204 без большого JSON.
        pollTimer = setTimeout(pollStage, 2000);
      }
    };

    const startPolling = () => {
      if (polling || stopped) return;
      polling = true;
      setConnection('offline');
      void pollStage();
    };

    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      try {
        socket = new WebSocket(`${proto}://${location.host}/ws`);
      } catch {
        startPolling();
        return;
      }
      socket.onopen = () => {
        retry.current = 0;
        stopPolling();
        setConnection('online');
      };
      socket.onmessage = (msg) => {
        if (stopped) return;
        const data = JSON.parse(msg.data);
        if (data.type !== 'state') return;
        qc.setQueryData(['state'], data.state as LiveState);
        if (data.events?.length) listeners.forEach((fn) => fn(data.events, data.state));
      };
      socket.onclose = () => {
        if (stopped) return;
        startPolling();
        const delay = Math.min(1000 * 2 ** retry.current++, 10000);
        timer = setTimeout(connect, delay);
      };
    };
    const onRefresh = () => { void pullStage(); };
    window.addEventListener('mi:live-refresh', onRefresh);
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stopPolling();
      window.removeEventListener('mi:live-refresh', onRefresh);
      // Закрываем аккуратно: сокет в состоянии CONNECTING закрываем сразу после открытия.
      if (socket?.readyState === WebSocket.CONNECTING) {
        const s = socket;
        s.onopen = () => s.close();
      } else socket?.close();
    };
  }, [qc]);

  return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>;
}

// Действия координатора: подтверждение тревоги и правки инцидента (POST в «ITSM»).
export async function ack(key: string, by: string) {
  const res = await fetch('/api/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, by }),
  });
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
  refreshLiveState();
}

export async function patchIncident(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`/api/incidents/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Не удалось сохранить');
  refreshLiveState();
  return res.json();
}

export async function demo(path: string, body?: unknown) {
  const res = await fetch(`/api/demo/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await res.json();
  refreshLiveState();
  return result;
}

// Текущее время с тиком — для обратных отсчётов.
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
