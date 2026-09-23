/**
 * Strip aggregator / tracking query params from apply URLs before opening.
 * Notably removes `source=` (hiringcave, linkedin, etc.) so users land on the
 * clean career-page URL.
 */
const DROP_PARAM_RE =
  /^(source|src|utm_|fbclid|gclid|gbraid|wbraid|mc_eid|mc_cid|_ga|_gl|ref|trk|si|igshid|mkt_tok)$/i;

export function stripTrackingParams(raw: string | null | undefined): string {
  const input = String(raw || '').trim();
  if (!input) return '';

  try {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const parsed = new URL(withProto);
    const kept = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      if (DROP_PARAM_RE.test(key) || /^utm_/i.test(key)) return;
      kept.append(key, value);
    });
    parsed.search = kept.toString() ? `?${kept.toString()}` : '';
    return parsed.toString();
  } catch {
    return input;
  }
}
