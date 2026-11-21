import { StrictMode } from 'react';
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
import { LiveProvider } from './lib/live';
import { GlobalAlertsProvider } from './lib/global-alerts';
import { Dashboard } from './Dashboard';
import { ItsmPage } from './itsm/ItsmPage';
import { CabinetPage } from './cabinet/CabinetPage';
import { NotificationSettingsPage } from './settings/NotificationSettingsPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: true, retryDelay: 2000, refetchOnWindowFocus: false } },
});

const itsm = location.pathname.match(/^\/itsm\/([^/]+)/);
const settings = location.pathname === '/settings' || location.pathname === '/settings/';
const cabinet = location.pathname === '/cabinet' || location.pathname.startsWith('/cabinet/');
if (itsm) document.body.classList.add('is-itsm');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LiveProvider>
        <GlobalAlertsProvider outsideDashboard={!!itsm || settings || cabinet} baseTitle={itsm ? `${decodeURIComponent(itsm[1])} · ITSM` : settings ? 'Настройки · Пульт МИ' : cabinet ? 'Личный кабинет · Пульт МИ' : 'Пульт МИ'}>
          {itsm ? <ItsmPage id={decodeURIComponent(itsm[1])} /> : settings ? <NotificationSettingsPage /> : cabinet ? <CabinetPage /> : <Dashboard />}
        </GlobalAlertsProvider>
      </LiveProvider>
    </QueryClientProvider>
  </StrictMode>,
);
