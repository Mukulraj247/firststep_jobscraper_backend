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
  return message.startsWith('Digest sent') ? 'success' : 'warning';
}

export function digestSentMessage(summary: { last6h: DigestLast6hSummary } | null | undefined): string {
  const last6h = summary?.last6h;
  if (!last6h) return 'Digest sent.';
  return `Digest sent. Last 6h: ${last6h.total} runs, ${last6h.passed} passed, ${last6h.failed} failed.`;
}
