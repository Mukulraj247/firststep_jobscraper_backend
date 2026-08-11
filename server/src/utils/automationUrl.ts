/**
 * Automation start URL normalization for storage + exact duplicate checks.
 * No path fuzzy-matching — only protocol/URL parse consistency.
 */

export function normalizeAutomationUrl(value: string): string {
  const trimmedValue = String(value || '').trim();

  if (!trimmedValue) {
    throw new Error('startUrl is required');
  }

  const collapsedProtocolValue = trimmedValue.replace(/^(https?:\/\/)+/i, (match) =>
    match.toLowerCase().startsWith('https://') ? 'https://' : 'http://'
  );

  const normalizedCandidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(collapsedProtocolValue)
    ? collapsedProtocolValue
    : `https://${collapsedProtocolValue}`;

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedCandidate);
  } catch {
    throw new Error('Invalid startUrl');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('startUrl must use http or https');
  }

  return parsedUrl.toString();
}
