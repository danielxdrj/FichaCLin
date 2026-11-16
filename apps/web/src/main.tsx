import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { SessionProvider } from './lib/session';
import { applyTheme } from './lib/theme';
import './styles/app.css';

applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
