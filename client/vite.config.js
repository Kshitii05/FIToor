import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => {
  // The repository root .env is shared with the server; only APP_NAME, APP_TAGLINE and PORT are read here.
  const env = loadEnv(mode, rootDir, '');
  const appName = env.APP_NAME;
  if (!appName) {
    throw new Error('APP_NAME is not set. Copy .env.example to .env first.');
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'app-name-in-html',
        transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', appName),
      },
    ],
    // Exposes only the product name and tagline to client code (see src/config/app.js).
    define: {
      __APP_NAME__: JSON.stringify(appName),
      __APP_TAGLINE__: JSON.stringify(env.APP_TAGLINE ?? ''),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${env.PORT || 4000}`,
      },
    },
  };
});
