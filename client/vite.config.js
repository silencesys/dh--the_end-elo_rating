import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/images': 'http://localhost:3001',
      '/previews': 'http://localhost:3001',
    },
  },
  // Serve index.html for all routes so /results works on direct navigation
  appType: 'spa',
});
