/**
 * Soften technical / gibberish labels for display (request IDs, keyboard mash names).
 */
export function humanLabel(raw: string | null | undefined, fallback = 'Custom cluster'): string {
  let s = String(raw || '').trim();
  if (!s) return fallback;

  // UTF-8 mojibake leftovers in short titles/descriptions
  s = s
    .replace(/â€"|â€”|â€“/g, '—')
    .replace(/â€˜|â€™/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€¦/g, '…')
    .replace(/â€¢/g, '•')
    .replace(/Â /g, ' ')
    .trim();

  if (!s) return fallback;

  // Bare Mongo-style ObjectIds
  if (/^[a-f0-9]{24}$/i.test(s)) return fallback;

  // "From request <id>" (entire string or leading phrase)
  if (/^from request\s+[a-f0-9]{8,}$/i.test(s)) return fallback;
  if (/from request\s+[a-f0-9]{8,}/i.test(s)) {
    const cleaned = s.replace(/from request\s+[a-f0-9]{8,}/gi, '').trim();
    if (!cleaned || cleaned.length < 3) return fallback;
    s = cleaned;
  }

  // Hash / hex dump style: #kdsAMERICAN…[hex…]
  if (/^#/.test(s) || /\[hex/i.test(s) || /objectid/i.test(s)) return fallback;
  if (/[a-f0-9]{20,}/i.test(s) && s.length > 40) return fallback;

  // Long unbroken keyboard-mash (no spaces, mostly consonants / repeated keys)
  if (!/\s/.test(s) && s.length >= 12 && !/[.:/@]/.test(s)) {
    const letters = s.replace(/[^a-z]/gi, '');
    if (letters.length >= 12) {
      const vowels = (letters.match(/[aeiou]/gi) || []).length;
      const vowelRatio = vowels / letters.length;
      // Repeated digrams (jyujtyuj…) or very low vowel density
      const hasRepeatRun = /(.)\1{3,}/.test(letters) || /(.{2,4})\1{2,}/i.test(letters);
      if (vowelRatio < 0.28 || hasRepeatRun) return fallback;
    }
  }

  if (/(.)\1{4,}/.test(s)) return fallback;

  return s;
}

export function shortRequestHint(title: string | null | undefined): string {
  const label = humanLabel(title, '');
  if (!label) return 'Open request in progress';
  return label.length > 42 ? `${label.slice(0, 40)}…` : label;
}
