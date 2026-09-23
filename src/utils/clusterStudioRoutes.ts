/**
 * Ops Cluster Studio route helpers (list + detail).
 * Keeps sidebar highlight and detail deep-links consistent.
 */

export function isClusterStudioPath(pathname: string): boolean {
  return pathname === '/clusters' || pathname.startsWith('/clusters/');
}

export function clusterDetailPath(id: string): string {
  return `/clusters/${encodeURIComponent(id)}`;
}

export function clusterNewPath(): string {
  return '/clusters/new';
}

export function clusterAliasRedirectTarget(id: string | undefined): string {
  return `/clusters/${id || ''}`;
}
