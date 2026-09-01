/** Client-side display helpers for job board cards (aggregator fallbacks). */

const CHOPPING_BLOCK_NOISE = /^(chopping\s*block|ai chopping block|the ai chopping block|top\s*ai|ai\s*jobs?)$/i;

export function companyFromChoppingBlockSlug(url: string): string {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const atMatch = slug.match(/-at-([a-z0-9-]+)$/i);
    if (!atMatch) return '';
    return atMatch[1]
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  } catch {
    return '';
  }
}

export function companyFromDescriptionLead(description: string): string {
  const lead = String(description || '').trim().match(/^([A-Z][A-Za-z0-9.&' -]{1,48})\s+is\s+(?:the|a|an)\b/);
  return lead?.[1]?.trim() || '';
}

export function resolveJobBoardCompany(data: {
  companyName?: unknown;
  jobDescription?: unknown;
  aggregatorPostingUrl?: unknown;
  jobUrl?: unknown;
  source?: unknown;
}): string {
  const stored = String(data.companyName || '').trim();
  const source = String(data.source || '').toLowerCase();
  const posting = String(data.aggregatorPostingUrl || data.jobUrl || '').trim();
  const description = String(data.jobDescription || '');

  if (source !== 'choppingblock' && !/choppingblock\.ai/i.test(posting)) {
    return stored;
  }

  const fromSlug = companyFromChoppingBlockSlug(posting);
  if (fromSlug) return fromSlug;

  if (stored && !CHOPPING_BLOCK_NOISE.test(stored)) return stored;

  const fromDesc = companyFromDescriptionLead(description);
  if (fromDesc && !CHOPPING_BLOCK_NOISE.test(fromDesc)) return fromDesc;

  return stored;
}

export function resolveJobBoardLocation(data: {
  location?: unknown;
  remoteType?: unknown;
}): string {
  const location = String(data.location || '').trim();
  const remote = String(data.remoteType || '').trim();
  if (location && !/^remote$/i.test(location)) return location;
  if (remote) return remote;
  return location;
}
