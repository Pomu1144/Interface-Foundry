import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './app/App';
import { registerCoreActions } from './app/coreActions';
import { registerModules } from './app/modules';
import { connectCompanion } from './modules/project-adapter/server-api';
import { startPreviewSync } from './modules/preview-runtime/sync';
import { startAutosave } from './modules/project-storage/storage';

registerCoreActions();
registerModules();
startPreviewSync();
startAutosave();
void connectCompanion();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
