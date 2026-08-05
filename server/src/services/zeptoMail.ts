/**
 * ZeptoMail transactional email sender (REST API).
 * Env: ZEPTOMAIL_TOKEN (or ZEPTOMAIL_API_KEY), ZEPTOMAIL_FROM_ADDRESS, ZEPTOMAIL_FROM_NAME
 * Optional: ZEPTOMAIL_API_URL — e.g. https://api.zeptomail.in/v1.1/email for Zoho India accounts
 */
import axios from 'axios';
import logger from '../logger';

const DEFAULT_ZEPTO_URL = 'https://api.zeptomail.com/v1.1/email';
const INDIA_ZEPTO_URL = 'https://api.zeptomail.in/v1.1/email';

export type ZeptoSendResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  requestId?: string;
  error?: string;
};

function getZeptoApiUrl(): string {
  const raw = String(process.env.ZEPTOMAIL_API_URL || DEFAULT_ZEPTO_URL).trim();
  return raw || DEFAULT_ZEPTO_URL;
}

/** Prefer ZEPTOMAIL_TOKEN; accept ZEPTOMAIL_API_KEY as alias. Strip accidental auth prefix. */
export function getZeptoToken(): string {
  let token = String(
    process.env.ZEPTOMAIL_TOKEN || process.env.ZEPTOMAIL_API_KEY || ''
  ).trim();
  // Users sometimes paste the full header value from docs.
  token = token.replace(/^Zoho-enczapikey\s+/i, '').trim();
  // Strip wrapping quotes from .env mistakes.
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  return token;
}

export function isZeptoMailConfigured(): boolean {
  return !!(getZeptoToken() && String(process.env.ZEPTOMAIL_FROM_ADDRESS || '').trim());
}

export function parseDigestRecipients(): string[] {
  const raw = String(process.env.OPS_DIGEST_EMAIL_TO || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

function formatZeptoError(error: any): string {
  const data = error?.response?.data;
  const top = data?.error;
  const details = Array.isArray(top?.details) ? top.details : [];
  const detailMsgs = details
    .map((d: any) => {
      const code = d?.code ? String(d.code) : '';
      const msg = d?.message ? String(d.message) : '';
      return [code, msg].filter(Boolean).join(' ');
    })
    .filter(Boolean);

  if (top?.message || detailMsgs.length) {
    const head = [top?.code, top?.message].filter(Boolean).join(' ');
    return detailMsgs.length ? `${head} — ${detailMsgs.join('; ')}` : head;
  }

  if (typeof data?.message === 'string') return data.message;
  if (data) return JSON.stringify(data);
  return error?.message || String(error);
}

function isInvalidTokenError(error: any): boolean {
  const data = error?.response?.data?.error;
  if (!data) return false;
  if (String(data.code || '') === 'TM_4001') return true;
  if (/access denied/i.test(String(data.message || ''))) return true;
  const details = Array.isArray(data.details) ? data.details : [];
  return details.some(
    (d: any) =>
      String(d?.code || '') === 'SERR_157' ||
      /invalid api token/i.test(String(d?.message || ''))
  );
}

async function postZeptoEmail(
  apiUrl: string,
  token: string,
  body: Record<string, unknown>
) {
  return axios.post(apiUrl, body, {
    timeout: 30_000,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Zoho-enczapikey ${token}`,
    },
  });
}

export async function sendZeptoMail(opts: {
  to: string[];
  subject: string;
  htmlbody: string;
  textbody?: string;
}): Promise<ZeptoSendResult> {
  const token = getZeptoToken();
  const fromAddress = String(process.env.ZEPTOMAIL_FROM_ADDRESS || '').trim();
  const fromName = String(process.env.ZEPTOMAIL_FROM_NAME || 'Scout-X Ops').trim();
  const configuredUrl = getZeptoApiUrl();

  if (!token || !fromAddress) {
    return {
      ok: false,
      skipped: true,
      reason: 'ZeptoMail is not configured (ZEPTOMAIL_TOKEN / ZEPTOMAIL_FROM_ADDRESS).',
    };
  }

  const recipients = (opts.to || []).filter(Boolean);
  if (!recipients.length) {
    return {
      ok: false,
      skipped: true,
      reason: 'No recipients provided.',
    };
  }

  const body: Record<string, unknown> = {
    from: { address: fromAddress, name: fromName },
    to: recipients.map((address) => ({
      email_address: { address, name: address },
    })),
    subject: opts.subject,
    htmlbody: opts.htmlbody,
    ...(opts.textbody ? { textbody: opts.textbody } : {}),
  };

  try {
    let res;
    try {
      res = await postZeptoEmail(configuredUrl, token, body);
    } catch (primaryError: any) {
      // Zoho India agents reject tokens on api.zeptomail.com with TM_4001 / Access Denied.
      // Retry once on the India host when the caller did not explicitly set another region URL.
      const explicitUrl = String(process.env.ZEPTOMAIL_API_URL || '').trim();
      const shouldRetryIndia =
        !explicitUrl &&
        /api\.zeptomail\.com/i.test(configuredUrl) &&
        isInvalidTokenError(primaryError);

      if (!shouldRetryIndia) throw primaryError;

      logger.log(
        'warn',
        'ZeptoMail token rejected on api.zeptomail.com — retrying api.zeptomail.in (Zoho India)'
      );
      res = await postZeptoEmail(INDIA_ZEPTO_URL, token, body);
    }

    const requestId =
      res.data?.data?.[0]?.request_id ||
      res.data?.request_id ||
      res.headers?.['x-request-id'] ||
      undefined;

    logger.log('info', `ZeptoMail sent to ${recipients.join(', ')} subject="${opts.subject}"`);
    return { ok: true, requestId: requestId ? String(requestId) : undefined };
  } catch (error: any) {
    const detail = formatZeptoError(error);
    logger.log('error', `ZeptoMail send failed: ${detail}`);
    return { ok: false, error: detail };
  }
}
