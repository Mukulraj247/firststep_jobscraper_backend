/** postMessage type from Maxun web app → extension (API base URL only; never secrets). */
export const MAXUN_APPLY_BACKEND_URL = 'MAXUN_APPLY_BACKEND_URL';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:80',
  'http://127.0.0.1:80',
  'https://app.maxun.dev',
  'https://scoutx-dev.firststepjob.com',
  'https://scoutx.firststepjob.com',
];

/**
 * Origins allowed to push the API base URL into the extension via window.postMessage.
 * Set VITE_EXTENSION_BRIDGE_ORIGINS (comma-separated) at extension build time for extra hosts.
 */
export function isAllowedWebOrigin(origin: string): boolean {
  const extra =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_EXTENSION_BRIDGE_ORIGINS
      ? String(import.meta.env.VITE_EXTENSION_BRIDGE_ORIGINS)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const all = [...DEFAULT_ALLOWED_ORIGINS, ...extra];
  return all.includes(origin);
}
