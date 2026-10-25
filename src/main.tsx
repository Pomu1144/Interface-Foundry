import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './app/App';
import { registerCoreActions } from './app/coreActions';
import { registerModules } from './app/modules';
import { connectCompanion } from './modules/project-adapter/server-api';
import { startPreviewSync } from './modules/preview-runtime/sync';
import { startAutosave } from './modules/project-storage/storage';
import { useStudio } from './store';
import { startTelemetry } from './modules/telemetry-adapter';

registerCoreActions();
registerModules();
startPreviewSync();
startAutosave();
startTelemetry();
void connectCompanion();

// Dev/test hook for end-to-end tests and debugging (not present in production builds).
if (import.meta.env.DEV) (window as unknown as { __IFDY__: unknown }).__IFDY__ = { useStudio };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
