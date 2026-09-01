/** Hostnames that are aggregator boards — never use as direct Apply targets. */
export function isAggregatorApplyHost(hostname: string): boolean {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '');
  if (!host) return false;
  return (
    host === 'hiring.cafe' ||
    host === 'hiringcafe.com' ||
    host.endsWith('.hiring.cafe') ||
    host === 'jobs.accel.com' ||
    host.endsWith('.jobs.accel.com') ||
    host === 'jobs.sequoiacap.com' ||
    host.endsWith('.jobs.sequoiacap.com') ||
    host === 'careers.capitalg.com' ||
    host.endsWith('.careers.capitalg.com') ||
    host === 'choppingblock.ai' ||
    host.endsWith('.choppingblock.ai') ||
    host === 'aidevboard.com' ||
    host.endsWith('.aidevboard.com') ||
    host === 'startups.gallery' ||
    host.endsWith('.startups.gallery')
  );
}

/** True when href is a usable employer apply URL (not an aggregator host). */
export function isEmployerApplyHref(href: string): boolean {
  try {
    const host = new URL(href).hostname;
    return Boolean(href) && !isAggregatorApplyHost(host);
  } catch {
    return false;
  }
}
