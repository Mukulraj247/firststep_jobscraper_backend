export type InAppReturnState = {
  returnTo?: string;
  from?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function isSafeInAppReturnPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return false;
  const pathname = path.split('?')[0];
  if (pathname === '/login' || pathname === '/register' || pathname === '/recording') return false;
  return true;
}

export function inAppBackHref(returnTo: unknown, fallback: string): string {
  if (typeof returnTo !== 'string' || !isSafeInAppReturnPath(returnTo)) return fallback;
  return returnTo;
}

export function runDetailsBackHref(returnTo: unknown, fallback = '/failures'): string {
  return inAppBackHref(returnTo, fallback);
}

export function inAppBackLabel(returnTo: string): string {
  if (returnTo.startsWith('/failures')) return 'Back to Failures';
  if (returnTo.startsWith('/automations')) return 'Back to Automations';
  if (returnTo.startsWith('/aggregators')) return 'Back to Aggregators';
  if (returnTo.startsWith('/runs')) return 'Back to Runs';
  if (returnTo.startsWith('/run/')) return 'Back to Run';
  if (returnTo.startsWith('/jobs')) return 'Back to Job board';
  if (returnTo.startsWith('/automation/') && returnTo.endsWith('/data')) return 'Back to Extracted data';
  if (returnTo.startsWith('/automation/') && returnTo.endsWith('/config')) return 'Back to Config';
  return 'Back';
}

export function runDetailsBackLabel(returnTo: string): string {
  return inAppBackLabel(returnTo);
}

export function currentLocationHref(pathname: string, search = ''): string {
  return `${pathname}${search || ''}`;
}

export function pushReturnState(location: {
  pathname: string;
  search: string;
  state: unknown;
}): InAppReturnState {
  const current = currentLocationHref(location.pathname, location.search);
  const prev = isRecord(location.state) ? location.state.returnTo : undefined;
  return {
    returnTo: current,
    from: typeof prev === 'string' && isSafeInAppReturnPath(prev) ? prev : undefined,
  };
}

export function popReturnNavigateOptions(
  state: unknown,
  fallback: string,
): { href: string; state?: InAppReturnState } {
  const record = isRecord(state) ? state : {};
  const href = inAppBackHref(record.returnTo, fallback);
  const from = typeof record.from === 'string' && isSafeInAppReturnPath(record.from)
    ? record.from
    : undefined;
  return from ? { href, state: { returnTo: from } } : { href };
}
