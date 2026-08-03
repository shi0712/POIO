import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../desktop/src/App';
import '../../desktop/src/styles.css';
import '../../desktop/src/fixes.css';
import './web.css';
import { installBrowserBridge } from './browser-bridge';

installBrowserBridge();
if('serviceWorker' in navigator&&import.meta.env.PROD)void navigator.serviceWorker.register('/sw.js');

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
