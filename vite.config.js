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
      'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(process.env.VITE_AUTH0_DOMAIN || ''),
      'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify(process.env.VITE_AUTH0_CLIENT_ID || ''),
      'import.meta.env.VITE_AUTH0_AUDIENCE': JSON.stringify(process.env.VITE_AUTH0_AUDIENCE || ''),
      'import.meta.env.VITE_AUTH0_CALLBACK_URL': JSON.stringify(
        process.env.VITE_AUTH0_CALLBACK_URL || publicUrl
      ),
    },
    resolve: {
      // Prevent duplicate react-router-dom instances (useNavigate outside <Router>).
      dedupe: ['react', 'react-dom', 'react-router-dom'],
    },
    server: {
      host: parsedPublicUrl.hostname,
      port: serverPort,
      // Same-origin API in local Vite so Auth0 session cookies (Set-Cookie from
      // /auth/auth0/exchange) stick. apiConfig.js routes localhost DEV to page origin.
      proxy: {
        '/auth': { target: backendUrl, changeOrigin: true },
        '/api': { target: backendUrl, changeOrigin: true },
        '/storage': { target: backendUrl, changeOrigin: true },
        '/record': { target: backendUrl, changeOrigin: true },
        '/workflow': { target: backendUrl, changeOrigin: true },
        '/robot': { target: backendUrl, changeOrigin: true },
        '/proxy': { target: backendUrl, changeOrigin: true },
        '/webhook': { target: backendUrl, changeOrigin: true },
        '/socket.io': { target: backendUrl, changeOrigin: true, ws: true },
      },
    },
    build: {
      outDir: 'build',
      manifest: true,
      chunkSizeWarningLimit: 1024,
    },
    optimizeDeps: {
      include: ['cron-parser', 'react-router-dom', 'react', 'react-dom'],
    },
    plugins: [react()],
  };
});