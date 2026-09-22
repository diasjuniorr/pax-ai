import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/telemetry': { target: 'ws://127.0.0.1:3001', ws: true }, '/api': 'http://127.0.0.1:3001' } },
});
