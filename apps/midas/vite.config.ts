import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const useE2EEmulator = env.VITE_E2E_USE_FIREBASE_EMULATOR === 'true';
  return {
    plugins: [react()],
    build: {
      sourcemap: 'hidden',
    },
    define: useE2EEmulator
      ? { __MIDAS_E2E_LOCAL__: JSON.stringify(true) }
      : {},
  };
});
