/** Compact relative time for job cards, e.g. "12m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, nowMs = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, nowMs - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Countdown for the next scheduled refresh, e.g. "in 42m". */
export function timeUntil(iso: string, nowMs = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = then - nowMs;
  if (diff <= 0) return 'due now';
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`;
}

export function greetingFor(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
}

/** Counts the filters a user has actually set, for the "Filters (3)" badge. */
export function countActiveFilters(filters: Record<string, unknown>): number {
  return Object.entries(filters).filter(([, value]) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.trim().length > 0;
    return value !== undefined && value !== null;
  }).length;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`;
}
