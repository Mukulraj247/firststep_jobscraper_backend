export type DigestStatus = {
  enabled: boolean;
  zeptoConfigured: boolean;
  recipients: string[];
  canSend: boolean;
  reason?: string;
  interval?: string;
};

export type DigestLast6hSummary = {
  total: number;
  passed: number;
  failed: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize chip/list input: split, validate, dedupe case-insensitively. */
export function normalizeDigestEmailList(input: unknown): string[] {
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

export function digestRecipientsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map((e) => e.toLowerCase()).sort();
  const right = b.map((e) => e.toLowerCase()).sort();
  return left.every((e, i) => e === right[i]);
}

export function digestStatusCaption(status: DigestStatus | null): string | null {
  if (!status) return null;
  const recipients = status.recipients?.length
    ? `to ${status.recipients.join(', ')}`
    : 'no recipients';
  const text =
    `Ops digest: ${status.enabled ? 'enabled' : 'disabled'} · every ${
      status.interval || '6 hours'
    } · ZeptoMail ${status.zeptoConfigured ? 'configured' : 'not configured'} · ${recipients}`;
  if (!status.canSend && status.reason) {
    return `${text} — ${status.reason}`;
  }
  return text;
}

export function digestSendDisabled(sending: boolean, canSend?: boolean): boolean {
  return sending || canSend === false;
}

export function digestAlertSeverity(message: string): 'success' | 'warning' {
  return message.startsWith('Digest sent') || message.startsWith('Recipients saved')
    ? 'success'
    : 'warning';
}

export function digestSentMessage(summary: { last6h: DigestLast6hSummary } | null | undefined): string {
  const last6h = summary?.last6h;
  if (!last6h) return 'Digest sent.';
  return `Digest sent. Last 6h: ${last6h.total} runs, ${last6h.passed} passed, ${last6h.failed} failed.`;
}
