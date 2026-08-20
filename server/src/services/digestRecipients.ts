import OpsDigestSettings, { OPS_DIGEST_SETTINGS_ID } from '../models/OpsDigestSettings';
import { parseDigestRecipients } from './zeptoMail';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Split / normalize a list of emails: trim, drop invalid, dedupe case-insensitively
 * while preserving the first-seen casing.
 */
export function normalizeEmailList(input: unknown): string[] {
  const rawParts: string[] = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      rawParts.push(...String(item ?? '').split(/[,;\s]+/));
    }
  } else if (typeof input === 'string') {
    rawParts.push(...input.split(/[,;\s]+/));
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed || !EMAIL_RE.test(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Mongo recipients if the settings doc exists; otherwise env seed. */
export async function resolveDigestRecipients(): Promise<string[]> {
  const doc = await OpsDigestSettings.findById(OPS_DIGEST_SETTINGS_ID).lean();
  if (doc) {
    return normalizeEmailList((doc as { recipients?: string[] }).recipients || []);
  }
  return parseDigestRecipients();
}

export async function saveDigestRecipients(input: unknown): Promise<string[]> {
  const recipients = normalizeEmailList(input);
  await OpsDigestSettings.findByIdAndUpdate(
    OPS_DIGEST_SETTINGS_ID,
    { $set: { recipients } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return recipients;
}
