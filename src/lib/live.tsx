// Живые данные: первичная загрузка через React Query, дальше сервер присылает актуальное состояние по WebSocket,
// и мы кладём его прямо в кэш React Query. Если сокет отвалился — включается опрос раз в 5 секунд.
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

export function useLiveState() {
  const connection = useConnection();
  return useQuery({
    queryKey: ['state'],
    queryFn: fetchState,
    staleTime: Infinity,
    refetchInterval: connection === 'online' ? false : 5000,
    refetchIntervalInBackground: true,
  });
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [connection, setConnection] = useState<Connection>('connecting');
  const retry = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/ws`);
      socket.onopen = () => {
        retry.current = 0;
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
        setConnection('offline');
        const delay = Math.min(1000 * 2 ** retry.current++, 10000);
        timer = setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
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
  await fetch('/api/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, by }),
  });
}

export async function patchIncident(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`/api/incidents/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Не удалось сохранить');
  return res.json();
}

export async function demo(path: string, body?: unknown) {
  const res = await fetch(`/api/demo/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
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
