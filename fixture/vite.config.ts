import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: 'index.html', lab: 'lab.html' } } },
  server: { port: 5180, strictPort: false },
});
