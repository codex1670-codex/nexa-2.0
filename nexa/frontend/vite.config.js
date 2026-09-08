import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  bash:'/nexa-2.0/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
