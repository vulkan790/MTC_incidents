import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import './styles.css';
import './itsm/itsm.css';
import './cabinet/cabinet.css';
import './settings/settings.css';
import './mobile.css';
import { LiveProvider } from './lib/live';
import { GlobalAlertsProvider } from './lib/global-alerts';
import { Dashboard } from './Dashboard';
import { initializeTheme } from './lib/theme';
import { ItsmPage } from './itsm/ItsmPage';
import { CabinetPage } from './cabinet/CabinetPage';
import { NotificationSettingsPage } from './settings/NotificationSettingsPage';

initializeTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: true, retryDelay: 2000, refetchOnWindowFocus: false } },
});

function routeKey() {
  return `${location.pathname}${location.search}${location.hash}`;
}

function App() {
  const [route, setRoute] = useState(routeKey);

  useEffect(() => {
    const onPopState = () => setRoute(routeKey());
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest('a');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname && url.search === location.search) return;
      event.preventDefault();
      history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
      setRoute(routeKey());
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick);
    };
  }, []);

  const itsm = location.pathname.match(/^\/itsm\/([^/]+)/);
  const settings = location.pathname === '/settings' || location.pathname === '/settings/';
  const cabinet = location.pathname === '/cabinet' || location.pathname.startsWith('/cabinet/');
  const baseTitle = itsm ? `${decodeURIComponent(itsm[1])} · ITSM` : settings ? 'Настройки · Пульт МИ' : cabinet ? 'Личный кабинет · Пульт МИ' : 'Пульт МИ';
  document.body.classList.toggle('is-itsm', !!itsm);

  return (
    <GlobalAlertsProvider outsideDashboard={!!itsm || settings || cabinet} baseTitle={baseTitle}>
      {itsm ? <ItsmPage key={route} id={decodeURIComponent(itsm[1])} /> : settings ? <NotificationSettingsPage key={route} /> : cabinet ? <CabinetPage key={route} /> : <Dashboard key={route} />}
    </GlobalAlertsProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LiveProvider>
        <App />
      </LiveProvider>
    </QueryClientProvider>
  </StrictMode>,
);
