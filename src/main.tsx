import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
// Deliberately imported again after index.css (which @imports it before Tailwind):
// this copy lands after the utilities, so its *:focus-visible ring beats
// `outline-none` and its scrollbar styles beat index.css's. Not a duplicate.
import './modules/core/styles/theme.css';
import './platform/i18n';
import { initSentry } from './platform/observability/sentry';

initSentry();

createRoot(document.getElementById('root')!).render(<App />);
