import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const disableHmr = env.DISABLE_HMR === 'true';

  return {
    base: './',
    define: {
      global: 'globalThis',
    },
    plugins: [
      {
        name: 'elara-memory-modal-mount-guard',
        enforce: 'pre',
        transform(code: string, id: string) {
          if (id.endsWith('/src/App.tsx')) {
            return code.replace(
              "from './components/MemoryModal';",
              "from './components/MemoryModalGuard';"
            );
          }
          return null;
        },
      },
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: false,
        },
        manifest: {
          name: 'Elara Companion',
          short_name: 'Elara',
          description: 'A sophisticated AI companion',
          theme_color: '#ffffff',
          background_color: '#09090b',
          display: 'standalone',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: !disableHmr,
      watch: disableHmr ? null : {},
    },
  };
});
