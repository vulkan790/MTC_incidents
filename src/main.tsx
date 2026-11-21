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
import { LiveProvider } from './lib/live';
import { Dashboard } from './Dashboard';
import { ItsmPage } from './itsm/ItsmPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: true, retryDelay: 2000, refetchOnWindowFocus: false } },
});

const itsm = location.pathname.match(/^\/itsm\/([^/]+)/);
if (itsm) document.body.classList.add('is-itsm');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LiveProvider>
        {itsm ? <ItsmPage id={decodeURIComponent(itsm[1])} /> : <Dashboard />}
      </LiveProvider>
    </QueryClientProvider>
  </StrictMode>,
);
