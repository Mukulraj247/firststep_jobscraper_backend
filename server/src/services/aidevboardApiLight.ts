/**
 * Light AI Dev Board enrich: public JSON API first, HTML /apply redirect fallback.
 * Never scrapes employer ATS for JD when API/HTML has description.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { isAidevboardJobPostingUrl, isAidevboardUrl } from './aggregatorIdentity';
import {
  aidevboardJobIdFromUrl,
  mapAidevboardApiJob,
  mergeAidevboardDetailIntoRow,
  preferExternalApplyUrl,
  type AidevboardStructuredFields,
} from './aidevboardDetail';
import { normalizeJobDescription, sanitizeCompanyName } from './jobPageParser';
import logger from '../logger';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export type FetchAidevboardResult = {
  ok: boolean;
  fields: AidevboardStructuredFields | null;
  method: 'api' | 'html' | 'none';
  error?: string;
};

export async function resolveAidevboardApplyRedirect(jobId: string): Promise<string> {
  const id = String(jobId || '').trim();
  if (!id) return '';
  try {
    const res = await axios.get(`https://aidevboard.com/apply/${encodeURIComponent(id)}`, {
      timeout: 15_000,
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    const loc = String(res.headers?.location || '').trim();
    return preferExternalApplyUrl(loc);
  } catch (err: any) {
    const loc = String(err?.response?.headers?.location || '').trim();
    return preferExternalApplyUrl(loc);
  }
}

export async function fetchAidevboardJobById(jobId: string): Promise<FetchAidevboardResult> {
  const id = String(jobId || '').trim();
  if (!id) {
    return { ok: false, fields: null, method: 'none', error: 'Missing job id' };
  }

  // Try single-job API shapes first (open catalog).
  for (const apiUrl of [
    `https://aidevboard.com/api/v1/jobs/${encodeURIComponent(id)}`,
    `https://aidevboard.com/api/v1/job/${encodeURIComponent(id)}`,
  ]) {
    try {
      const res = await axios.get(apiUrl, {
        timeout: 20_000,
        validateStatus: () => true,
        headers: { Accept: 'application/json', 'User-Agent': UA },
      });
      if (res.status < 400 && res.data && typeof res.data === 'object') {
        const job = (res.data.job || res.data.data || res.data) as Record<string, unknown>;
        if (job && (job.title || job.description || job.id)) {
          const fields = mapAidevboardApiJob({ ...job, id: job.id || id });
          if (!fields.applyUrl) {
            fields.applyUrl = await resolveAidevboardApplyRedirect(id);
          }
          return {
            ok: Boolean(fields.jobTitle || fields.jobDescription),
            fields,
            method: 'api',
          };
        }
      }
    } catch {
      /* try next */
    }
  }

  // SSR job page always carries the full description for this id.
  return fetchAidevboardJobHtml(`https://aidevboard.com/job/${id}`);
}

export async function fetchAidevboardJobHtml(postingUrl: string): Promise<FetchAidevboardResult> {
  const url = String(postingUrl || '').trim().split('#')[0] || '';
  if (!url || !isAidevboardUrl(url) || !isAidevboardJobPostingUrl(url)) {
    return { ok: false, fields: null, method: 'none', error: 'Not an AI Dev Board job URL' };
  }
  const jobId = aidevboardJobIdFromUrl(url);
  try {
    const res = await axios.get(url, {
      timeout: 25_000,
      responseType: 'text',
      transitional: { forcedJSONParsing: false },
      maxContentLength: 4 * 1024 * 1024,
      validateStatus: () => true,
      headers: { Accept: 'text/html', 'User-Agent': UA },
    });
    const html = typeof res.data === 'string' ? res.data : '';
    if (res.status >= 400 || !html) {
      return {
        ok: false,
        fields: null,
        method: 'html',
        error: `HTTP ${res.status}`,
      };
    }
    const $ = cheerio.load(html);
    const h1 = ($('h1').first().text() || '').replace(/\s+/g, ' ').trim();
    let description = '';
    const jsonDesc = html.match(/"description"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (jsonDesc?.[1]) {
      try {
        description = JSON.parse(`"${jsonDesc[1]}"`) as string;
      } catch {
        description = jsonDesc[1];
      }
    }
    if (!description || description.length < 100) {
      description = $('main, article, .job-description, [class*="description"]')
        .first()
        .text();
    }
    let company = '';
    const companyMatch = html.match(/"company_name"\s*:\s*"([^"]+)"/);
    if (companyMatch) company = companyMatch[1];
    if (!company) {
      company = ($('a[href*="/company"]').first().text() || '').replace(/\s+/g, ' ').trim();
    }
    let applyUrl = preferExternalApplyUrl(
      ...(html.match(/https?:\/\/(?:job-boards\.)?greenhouse\.io\/[^"'\s]+/gi) || []),
      ...(html.match(/https?:\/\/jobs\.ashbyhq\.com\/[^"'\s]+/gi) || [])
    );
    if (!applyUrl && jobId) {
      applyUrl = await resolveAidevboardApplyRedirect(jobId);
    }

    const fields: AidevboardStructuredFields = {
      jobTitle: h1,
      companyName: sanitizeCompanyName(company),
      jobDescription: normalizeJobDescription(description),
      applyUrl,
      aggregatorPostingUrl: url,
      jobId,
      source: 'html',
    };
    return {
      ok: Boolean(fields.jobTitle || (fields.jobDescription && fields.jobDescription.length > 100)),
      fields,
      method: 'html',
    };
  } catch (err: any) {
    return {
      ok: false,
      fields: null,
      method: 'html',
      error: String(err?.message || err || 'fetch_failed'),
    };
  }
}

export function enrichAidevboardRowFromFields(
  listRow: Record<string, unknown>,
  fields: AidevboardStructuredFields,
  postingUrl: string
): Record<string, unknown> {
  const merged = mergeAidevboardDetailIntoRow(listRow, fields, postingUrl);
  merged._enrichMethod = fields.source === 'api' ? 'api' : 'http_html';
  return merged;
}
