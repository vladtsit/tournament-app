import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev convenience: hit Functions directly when running `npm run dev:app`.
      // When running via `npm run dev` (SWA CLI), this proxy is bypassed.
      '/api': 'http://localhost:7071',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
