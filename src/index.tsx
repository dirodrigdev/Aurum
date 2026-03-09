import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// 🔥 BUMP APP_BUILD:
// Cada vez que quieras FORZAR que todos refresquen caché (celu incluido),
// cambia este valor y vuelve a deployar.
const APP_BUILD = '2025-12-17-01';

// Key persistente en localStorage
const BUILD_KEY = 'aurum_app_build_v1';

const addOrUpdateQueryParam = (urlStr: string, key: string, value: string) => {
  try {
    const url = new URL(urlStr);
    url.searchParams.set(key, value);
    return url.toString();
  } catch {
    // fallback simple
    const sep = urlStr.includes('?') ? '&' : '?';
    return `${urlStr}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
};

const forceHardRefresh = async () => {
  // 1) Unregister service workers
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {
    console.warn('[APP_BUILD] No pude desregistrar SW:', e);
  }

  // 2) Clear Cache Storage (si existe)
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn('[APP_BUILD] No pude borrar caches:', e);
  }

  // 3) Hard reload con query param (cache-buster)
  const nextUrl = addOrUpdateQueryParam(window.location.href, 'v', APP_BUILD);
  window.location.replace(nextUrl);
};

const maybeBumpBuildAndRefresh = () => {
  try {
    const prev = localStorage.getItem(BUILD_KEY);
    if (prev !== APP_BUILD) {
      // Guardamos ANTES de refrescar para evitar loop infinito
      localStorage.setItem(BUILD_KEY, APP_BUILD);

      console.warn(
        `[APP_BUILD] Cambio detectado (${prev || 'none'} -> ${APP_BUILD}). Forzando hard refresh...`,
      );

      // Disparamos refresh fuerte y salimos
      void forceHardRefresh();
      return true;
    }
  } catch (e) {
    console.warn('[APP_BUILD] No pude leer/escribir localStorage:', e);
  }
  return false;
};

const container = document.getElementById('root');

if (!container) {
  console.error("Error crítico: No se encontró el elemento 'root' en el HTML.");
} else {
  // Si hubo bump, NO renderizamos App (porque estamos recargando)
  const bumped = maybeBumpBuildAndRefresh();
  if (!bumped) {
    const root = createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
}
