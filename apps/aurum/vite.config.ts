import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const useE2EEmulator = env.VITE_E2E_USE_FIREBASE_EMULATOR === 'true';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        useE2EEmulator && {
          name: 'aurum-e2e-no-external-assets',
          transformIndexHtml(html) {
            return html
              .replace(/\s*<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '')
              .replace(/\s*<link\s+href="https:\/\/fonts\.googleapis\.com[^>]+>/, '')
              .replace(/\s*<script>\s*tailwind\.config[\s\S]*?<\/script>/, '');
          },
        },
      ],
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
