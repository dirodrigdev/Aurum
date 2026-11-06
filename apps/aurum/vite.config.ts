import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crossAppLocalTransports } from '../../packages/e2e-harness/cross-app/aurum-local-transports.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), ...(mode === 'e2e' ? [crossAppLocalTransports()].filter(Boolean) : [])],
      define: {
        // Mantenemos la definición de variables de entorno para Firebase/Gemini
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      // Eliminamos el bloque 'resolve' completo que causaba conflicto
      // resolve: {
      //   alias: {
      //     '@': path.resolve(__dirname, '.'),
      //   }
      // }
    };
});
