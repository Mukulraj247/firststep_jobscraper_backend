/**
 * Auth0 SPA SDK only runs on "secure origins": HTTPS, or http://localhost / 127.0.0.1.
 * Plain HTTP on a public IP (e.g. http://174.x.x.x:8080) throws and crashes the app.
 * @see https://github.com/auth0/auth0-spa-js/blob/main/FAQ.md
 */
export function isAuth0SecureOrigin(origin?: string): boolean {
  const raw =
    origin ||
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '');
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function auth0InsecureOriginHint(origin?: string): string {
  const current =
    origin ||
    (typeof window !== 'undefined' ? window.location.origin : 'this URL');
  return (
    `Auth0 cannot run on ${current}. Use http://localhost:5173 for local login, ` +
    `or https://scoutx-dev.firststepjob.com on the droplet — not a bare http://IP:8080 URL.`
  );
}
