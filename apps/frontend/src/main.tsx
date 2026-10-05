import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { AuthProvider } from './context/AuthContext.js';
import { ThemeProvider } from './context/ThemeContext.js';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register PWA service worker with automatic update checking
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('New BillsMaster version available. Updating...');
  },
  onOfflineReady() {
    console.log('BillsMaster is ready for offline operation.');
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>
);
