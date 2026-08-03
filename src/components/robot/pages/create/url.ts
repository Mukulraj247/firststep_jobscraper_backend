export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function isValidHttpUrl(input: string): boolean {
  try {
    const u = new URL(normalizeUrl(input));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
