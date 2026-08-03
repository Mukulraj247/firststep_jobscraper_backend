/**
 * ZeptoMail transactional email sender (REST API).
 * Env: ZEPTOMAIL_TOKEN, ZEPTOMAIL_FROM_ADDRESS, ZEPTOMAIL_FROM_NAME
 */
import axios from 'axios';
import logger from '../logger';

const ZEPTO_URL = 'https://api.zeptomail.com/v1.1/email';

export type ZeptoSendResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  requestId?: string;
  error?: string;
};

export function isZeptoMailConfigured(): boolean {
  return !!(
    String(process.env.ZEPTOMAIL_TOKEN || '').trim() &&
    String(process.env.ZEPTOMAIL_FROM_ADDRESS || '').trim()
  );
}

export function parseDigestRecipients(): string[] {
  const raw = String(process.env.OPS_DIGEST_EMAIL_TO || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

export async function sendZeptoMail(opts: {
  to: string[];
  subject: string;
  htmlbody: string;
  textbody?: string;
}): Promise<ZeptoSendResult> {
  const token = String(process.env.ZEPTOMAIL_TOKEN || '').trim();
  const fromAddress = String(process.env.ZEPTOMAIL_FROM_ADDRESS || '').trim();
  const fromName = String(process.env.ZEPTOMAIL_FROM_NAME || 'Scout-X Ops').trim();

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

  try {
    const res = await axios.post(
      ZEPTO_URL,
      {
        from: { address: fromAddress, name: fromName },
        to: recipients.map((address) => ({
          email_address: { address, name: address },
        })),
        subject: opts.subject,
        htmlbody: opts.htmlbody,
        ...(opts.textbody ? { textbody: opts.textbody } : {}),
      },
      {
        timeout: 30_000,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Zoho-enczapikey ${token}`,
        },
      }
    );

    const requestId =
      res.data?.data?.[0]?.request_id ||
      res.data?.request_id ||
      res.headers?.['x-request-id'] ||
      undefined;

    logger.log('info', `ZeptoMail sent to ${recipients.join(', ')} subject="${opts.subject}"`);
    return { ok: true, requestId: requestId ? String(requestId) : undefined };
  } catch (error: any) {
    const detail =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      JSON.stringify(error?.response?.data || {}) ||
      error?.message ||
      String(error);
    logger.log('error', `ZeptoMail send failed: ${detail}`);
    return { ok: false, error: detail };
  }
}
