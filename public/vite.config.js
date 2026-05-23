import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'build',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html',
        login: './login.html',
      },
    },
    // Production security: minify and drop console logs
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.debug']
      }
    }
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
