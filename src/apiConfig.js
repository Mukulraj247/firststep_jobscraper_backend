/**
 * Vite bakes VITE_BACKEND_URL at build time. A localhost bake breaks Droplet HTTP
 * (Private Network Access blocks public-page → loopback). Prefer the page origin
 * when the baked URL is loopback but the user is on a public host.
 *
 * In Vite dev on localhost, always use the page origin so `/auth` + `/api` hit
 * the Vite proxy (same-origin cookies for Auth0 exchange).
 */
function resolveApiOrigin() {
  const fromEnv = String(import.meta.env.VITE_BACKEND_URL || '').replace(/\/+$/, '');
  const page =
    typeof window !== 'undefined' && window.location?.origin
      ? String(window.location.origin).replace(/\/+$/, '')
      : '';
  const pageHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const envIsLoopback =
    !fromEnv ||
    /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/i.test(fromEnv);
  const pageIsLoopback = pageHost === 'localhost' || pageHost === '127.0.0.1';

  // Local Vite: same-origin via proxy (see vite.config.js) — required for Auth0 cookies.
  if (import.meta.env.DEV && page && pageIsLoopback) {
    return page;
  }

  if (page && pageHost && !pageIsLoopback && envIsLoopback) {
    return page;
  }
  if (fromEnv) return fromEnv;
  if (page) return page;
  return 'http://localhost:8080';
}

/** Backend origin without trailing slash (same as axios `${apiUrl}/api/...`). */
export const apiUrl = resolveApiOrigin();

/** Full `/api` base for the Chrome extension “Connection” setting (must match server routes). */
export const extensionApiBaseUrl = `${apiUrl}/api`;