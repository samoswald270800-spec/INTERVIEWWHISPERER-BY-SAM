import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  esbuild: {
    drop: ['debugger'],
    pure: ['console.log', 'console.debug'],
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html',
        login: './login.html',
      },
    },
    // esbuild avoids the Terser/CommonJS loader failure under Node ESM.
    minify: 'esbuild',
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',
      '/session': 'http://localhost:3000',
      '/set-jd': 'http://localhost:3000',
      '/analyze-screen': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    }
  }
});
