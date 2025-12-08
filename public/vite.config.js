import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',
      '/session': 'http://localhost:3000',
      '/set-jd': 'http://localhost:3000',
      '/analyze-screen': 'http://localhost:3000',
    }
  }
});
