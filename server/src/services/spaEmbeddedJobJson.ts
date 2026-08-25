function stripHtmlTags(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

type EmbeddedJobFields = {
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  location: string;
  salaryRange: string;
  employmentType: string;
  remoteType: string;
  date: string;
  applyUrl: string;
  companyLogoUrl: string;
  jobCategory: string;
  source: 'jsonld' | 'meta' | 'html' | 'none';
};

function emptyFields(): EmbeddedJobFields {
  return {
    jobTitle: '',
    companyName: '',
    jobDescription: '',
    location: '',
    salaryRange: '',
    employmentType: '',
    remoteType: '',
    date: '',
    applyUrl: '',
    companyLogoUrl: '',
    jobCategory: '',
    source: 'html',
  };
}

/** Parse a JSON object starting at `start` (must be `{`), respecting strings. */
export function parseBalancedJsonObject(source: string, start: number): unknown | null {
  if (source[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = source.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function indexOfJsonValue(html: string, marker: RegExp): number {
  const match = marker.exec(html);
  if (!match) return -1;
  let i = match.index + match[0].length;
  while (i < html.length && /\s|=|:/.test(html[i]!)) i += 1;
  return i;
}

function parseJsonStringLiteral(source: string, start: number): unknown | null {
  if (source[start] !== '"') return null;
  let escape = false;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      try {
        return JSON.parse(source.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseValueAfterMarker(html: string, marker: RegExp): unknown | null {
  const i = indexOfJsonValue(html, marker);
  if (i < 0 || i >= html.length) return null;
  let pos = i;
  // Live Apple pages assign: staticRouterHydrationData = JSON.parse("...")
  if (html.slice(pos, pos + 11).toLowerCase() === 'json.parse(') {
    pos += 11;
    while (pos < html.length && /\s/.test(html[pos]!)) pos += 1;
  }
  if (html[pos] === '"') {
    const inner = parseJsonStringLiteral(html, pos);
    if (typeof inner === 'string') {
      try {
        return JSON.parse(inner);
      } catch {
        return inner;
      }
    }
    return inner;
  }
  if (html[pos] === '{') return parseBalancedJsonObject(html, pos);
  return null;
}

function walkFindAppleJob(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || depth > 14) return null;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 50)) {
      const found = walkFindAppleJob(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const details = (obj.loaderData as Record<string, unknown> | undefined)?.jobDetails as
    | Record<string, unknown>
    | undefined;
  const detailsJob = details?.jobsData;
  if (detailsJob && typeof detailsJob === 'object' && !Array.isArray(detailsJob)) {
    const job = detailsJob as Record<string, unknown>;
    if (job.postingTitle || job.jobSummary || job.minimumQualifications) return job;
  }
  const nested = obj.jobsData;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const job = nested as Record<string, unknown>;
    if (job.postingTitle || job.jobSummary || job.minimumQualifications) return job;
  }
  if (obj.postingTitle && (obj.jobSummary || obj.minimumQualifications || obj.responsibilities)) {
    return obj;
  }
  for (const value of Object.values(obj)) {
    const found = walkFindAppleJob(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function joinHtmlParts(parts: unknown[]): string {
  return parts
    .map((part) => stripHtmlTags(String(part || '')))
    .filter((text) => text.length > 20)
    .join('\n\n');
}

export function parseAppleJobsHydration(html: string, pageUrl = ''): EmbeddedJobFields | null {
  if (!html || !/staticRouterHydrationData/i.test(html)) return null;
  const payload = parseValueAfterMarker(
    html,
    /(?:window\.)?_{0,2}staticRouterHydrationData\s*=/i
  );
  const job = walkFindAppleJob(payload);
  if (!job) return null;
  const fields = emptyFields();
  fields.companyName = 'Apple';
  fields.jobTitle = String(job.postingTitle || job.transformedPostingTitle || '').trim();
  fields.jobDescription = joinHtmlParts([
    job.jobSummary,
    job.responsibilities,
    job.minimumQualifications,
    job.preferredQualifications,
    job.keyQualifications,
    job.description,
  ]);
  const locations = job.locations;
  if (Array.isArray(locations)) {
    fields.location = locations
      .map((loc) =>
        typeof loc === 'string'
          ? loc
          : String((loc as any)?.name || (loc as any)?.city || (loc as any)?.displayName || '')
      )
      .filter(Boolean)
      .join(', ');
  }
  fields.employmentType = String(job.employmentType || '').trim();
  fields.applyUrl = pageUrl;
  fields.source = 'html';
  if (!fields.jobTitle && !fields.jobDescription) return null;
  return fields;
}

function walkFindPhenomJob(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || depth > 12) return null;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 40)) {
      const found = walkFindPhenomJob(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const desc = obj.description || obj.jobDescription || obj.descriptionTeaser;
  const title = obj.title || obj.jobTitle;
  if (title && desc && String(desc).length > 80) return obj;
  const nested = obj.jobDetail || obj.job;
  if (nested && typeof nested === 'object') {
    const found = walkFindPhenomJob(nested, depth + 1);
    if (found) return found;
  }
  for (const value of Object.values(obj)) {
    const found = walkFindPhenomJob(value, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parsePhenomJobDdo(html: string, pageUrl = ''): EmbeddedJobFields | null {
  if (!html || !/phApp\.ddo\s*=/i.test(html)) return null;
  const payload = parseValueAfterMarker(html, /phApp\.ddo\s*=/i);
  const job = walkFindPhenomJob(payload);
  if (!job) return null;
  return mapPhenomJobRecord(job, pageUrl);
}

export function mapPhenomJobRecord(job: Record<string, unknown>, pageUrl = ''): EmbeddedJobFields {
  const fields = emptyFields();
  fields.jobTitle = String(job.title || job.jobTitle || '').trim();
  fields.companyName = String(job.companyName || job.brand || '').trim();
  fields.jobDescription = joinHtmlParts([
    job.description,
    job.jobDescription,
    job.qualifications,
    job.externalQualifications,
    job.descriptionFooter,
    job.descriptionTeaser,
  ]);
  fields.location = String(
    job.location ||
      [job.city, job.state, job.country].filter(Boolean).join(', ') ||
      ''
  ).trim();
  fields.employmentType = String(job.type || job.employmentType || '').trim();
  fields.applyUrl = String(job.applyUrl || job.jobUrl || pageUrl).trim() || pageUrl;
  fields.source = 'html';
  return fields;
}

export function mapAppleSearchResult(job: Record<string, unknown>, pageUrl = ''): EmbeddedJobFields {
  const fields = emptyFields();
  fields.companyName = 'Apple';
  fields.jobTitle = String(job.postingTitle || job.transformedPostingTitle || '').trim();
  fields.jobDescription = joinHtmlParts([
    job.jobSummary,
    job.responsibilities,
    job.minimumQualifications,
    job.preferredQualifications,
  ]);
  const locations = job.locations;
  if (Array.isArray(locations)) {
    fields.location = locations
      .map((loc) =>
        typeof loc === 'string' ? loc : String((loc as any)?.name || (loc as any)?.city || '')
      )
      .filter(Boolean)
      .join(', ');
  }
  fields.employmentType = String(job.positionType || job.employmentType || '').trim();
  fields.applyUrl = pageUrl;
  fields.source = 'html';
  return fields;
}

export function applePositionIdFromUrl(pageUrl: string): string {
  try {
    return decodeURIComponent(new URL(pageUrl).pathname.match(/\/details\/([^/?#]+)/i)?.[1] || '');
  } catch {
    return '';
  }
}

export function microsoftJobIdFromUrl(pageUrl: string): string {
  try {
    const path = new URL(pageUrl).pathname;
    const fromJob = path.match(/\/job\/(\d+)/i)?.[1];
    if (fromJob) return fromJob;
    return path.match(/\/(\d{5,})(?:\/|$)/)?.[1] || '';
  } catch {
    return '';
  }
}

export function isMicrosoftCareersHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return (
    h === 'careers.microsoft.com' ||
    h === 'jobs.careers.microsoft.com' ||
    h === 'apply.careers.microsoft.com' ||
    h.endsWith('.careers.microsoft.com')
  );
}

export function isAppleJobsHost(host: string): boolean {
  return host.toLowerCase().replace(/^www\./, '') === 'jobs.apple.com';
}
