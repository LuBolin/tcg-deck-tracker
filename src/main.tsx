import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { CollectionPage } from './ui/CollectionPage';
import { DeckPage } from './ui/deck/DeckPage';
import { ToastProvider } from './ui/toast';
import { DecksPage } from './ui/DecksPage';
import { ImportPage } from './ui/ImportPage';
import { SettingsPage } from './ui/SettingsPage';
import { SharePage } from './ui/SharePage';
import { HelpPage } from './ui/HelpPage';
import { Shell } from './ui/Shell';
import { WantPage } from './ui/WantPage';
import './ui/styles.css';
import { applyTheme, readTheme } from './ui/theme';

applyTheme(readTheme());

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <DecksPage /> },
      { path: '/import', element: <ImportPage /> },
      { path: '/decks/:id', element: <DeckPage /> },
      { path: '/collection', element: <CollectionPage /> },
      { path: '/want', element: <WantPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/share', element: <SharePage /> },
      { path: '/help', element: <HelpPage /> },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
);

// Offline app shell, production builds only (in dev it would cache modules mid-edit).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}
