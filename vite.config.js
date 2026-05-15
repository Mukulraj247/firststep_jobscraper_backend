import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
dotenv.config();

const parseUrlSafe = (value, fallback) => {
  try {
    return new URL(value);
  } catch {
    return new URL(fallback);
  }
};

export default defineConfig(() => {
  const publicUrlRaw = (process.env.VITE_PUBLIC_URL || '').trim();
  const publicUrl = publicUrlRaw || 'http://localhost:5173';
  const parsedPublicUrl = parseUrlSafe(publicUrl, 'http://localhost:5173');

  const serverPort = parsedPublicUrl.port
    ? Number.parseInt(parsedPublicUrl.port, 10)
    : parsedPublicUrl.protocol === 'https:'
      ? 443
      : 80;

  const backendUrlRaw = (process.env.VITE_BACKEND_URL || '').trim();
  const backendUrl = backendUrlRaw || 'http://localhost:8080';
  const parsedBackendUrl = parseUrlSafe(backendUrl, 'http://localhost:8080');

  return {
    // Root-hosted SPA (e.g. https://app.onrender.com/); deep links must load JS from /assets/...
    base: '/',
    define: {
      // Ensure the value is always a valid absolute URL at build time.
      'import.meta.env.VITE_BACKEND_URL': JSON.stringify(parsedBackendUrl.toString()),
      'import.meta.env.VITE_PUBLIC_URL': JSON.stringify(publicUrl),
    },
    server: {
      host: parsedPublicUrl.hostname,
      port: serverPort,
    },
    build: {
      outDir: 'build',
      manifest: true,
      chunkSizeWarningLimit: 1024,
    },
    optimizeDeps: {
      include: ['cron-parser'],
    },
    plugins: [react()],
  };
});