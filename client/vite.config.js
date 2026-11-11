import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // The browser calls /api/... on :5173; Vite forwards it to Express on :5000.
      // Same origin for the browser, so no CORS preflight and cookies just work.
      '/api': 'http://localhost:5000',
    },
  },
});
