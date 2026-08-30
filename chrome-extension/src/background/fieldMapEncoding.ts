/**
 * Pure field-map encoding for Send to Maxun → cloud listExtractor.
 * Kept free of chrome.* so unit tests can import it under Node/vitest.
 */

function withAttr(selector: string, attribute: string): string {
  return attribute && attribute !== 'innerText' ? `${selector}@${attribute}` : selector;
}

/** Encode Schema.org / fixed literals so cloud listExtractor applies them as constants. */
export function encodeFieldSelectorForBackend(
  selector: string,
  attribute: string,
  fromSchema?: boolean
): string {
  const literal = String(selector || '').trim();
  if (!literal) return '';
  if (fromSchema || attribute === 'fixed') {
    // Cloud already treats `value@fixed` as a literal (not a CSS selector).
    return `${literal}@fixed`;
  }
  return withAttr(literal, attribute);
}

/**
 * Structural / Tailwind variants so the backend can try ranked fallbacks when
 * career portals rotate hashed class names.
 */
function generateBackendSelectorVariants(selector: string): string[] {
  if (!selector || typeof selector !== 'string') return [];
  const variants: string[] = [selector.trim()];
  const stripped = selector
    .replace(/\.[a-zA-Z0-9_-]*__[a-zA-Z0-9_-]+/g, '') // CSS-modules hashed classes
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped && stripped !== selector.trim()) variants.push(stripped);
  const nthMatch = selector.match(/:nth-of-type\(\d+\)/);
  if (nthMatch) {
    const tagMatch = selector.match(/^([a-zA-Z][\w-]*)/);
    if (tagMatch) variants.push(tagMatch[1] + nthMatch[0]);
  }
  // Attribute-ish job link fallback when selector looks like a link container.
  if (/a[\s.#\[:]/i.test(selector) || selector.includes('href')) {
    variants.push('a[href*="/job/"]', 'a[href*="/jobs/"]');
  }
  return [...new Set(variants.filter(Boolean))];
}

const SEMANTIC_BACKEND_FIELD: Record<string, string> = {
  title: 'title',
  company: 'company',
  description: 'description',
  url: 'url',
  location: 'location',
  date: 'date',
  image: 'image',
  companyUrl: 'companyUrl',
  employmentType: 'employmentType',
};

function backendFieldKey(
  name: string,
  field: { semanticType?: string; label?: string }
): string {
  const sem = String(field.semanticType || '').trim();
  if (sem && sem !== 'unknown' && SEMANTIC_BACKEND_FIELD[sem]) {
    return SEMANTIC_BACKEND_FIELD[sem];
  }
  const label = String(field.label || name || '').trim();
  return label || name;
}

export type BackendFieldInput = {
  selector: string;
  attribute: string;
  fallbackSelectors?: string[];
  semanticType?: string;
  label?: string;
  fromSchema?: boolean;
};

export function buildFieldMap(
  fields: Record<string, BackendFieldInput>
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [name, field] of Object.entries(fields)) {
    const key = backendFieldKey(name, field);
    const { selector, attribute, fallbackSelectors, fromSchema } = field;
    const isLiteral = !!(fromSchema || attribute === 'fixed');
    const primary = encodeFieldSelectorForBackend(selector, attribute, fromSchema);
    if (!primary) continue;
    const extras = isLiteral
      ? []
      : [
          ...(Array.isArray(fallbackSelectors) ? fallbackSelectors : []),
          ...generateBackendSelectorVariants(selector).slice(1),
        ].map((s) => encodeFieldSelectorForBackend(s, attribute, false));
    const ranked = [...new Set([primary, ...extras].filter(Boolean))];
    const existing = result[key];
    if (existing) {
      const merged = [
        ...new Set([
          ...(Array.isArray(existing) ? existing : [existing]),
          ...(ranked.length === 1 ? [ranked[0]!] : ranked),
        ]),
      ];
      result[key] = merged.length === 1 ? merged[0]! : merged;
    } else {
      result[key] = ranked.length === 1 ? ranked[0]! : ranked;
    }
  }
  return result;
}
