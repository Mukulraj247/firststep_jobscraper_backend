import { describe, expect, it } from 'vitest';
import { SIDEBAR_NAV_VALUES } from '../../components/dashboard/sidebarNav';
import {
  digestAlertSeverity,
  digestRecipientsEqual,
  digestSendDisabled,
  digestSentMessage,
  digestStatusCaption,
  normalizeDigestEmailList,
} from './communicationPageBehavior';

describe('sidebar Communication tab', () => {
  it('sits after Failure Dashboard; Aggregators sits before Proxy', () => {
    const failures = SIDEBAR_NAV_VALUES.indexOf('failures');
    const communication = SIDEBAR_NAV_VALUES.indexOf('communication');
    const aggregators = SIDEBAR_NAV_VALUES.indexOf('aggregators');
    const proxy = SIDEBAR_NAV_VALUES.indexOf('proxy');
    expect(communication).toBe(failures + 1);
    expect(aggregators).toBe(communication + 1);
    expect(proxy).toBe(aggregators + 1);
  });
});

describe('normalizeDigestEmailList', () => {
  it('splits, validates, and dedupes recipients', () => {
    expect(normalizeDigestEmailList('a@x.com, b@y.com;A@x.com nope')).toEqual([
      'a@x.com',
      'b@y.com',
    ]);
  });

  it('compares recipient lists case-insensitively', () => {
    expect(digestRecipientsEqual(['A@x.com'], ['a@x.com'])).toBe(true);
    expect(digestRecipientsEqual(['a@x.com'], ['a@x.com', 'b@y.com'])).toBe(false);
  });
});

describe('digestStatusCaption', () => {
  it('returns null when status has not loaded', () => {
    expect(digestStatusCaption(null)).toBeNull();
  });

  it('summarizes ZeptoMail, interval, and recipients', () => {
    expect(
      digestStatusCaption({
        enabled: true,
        zeptoConfigured: true,
        recipients: ['ops@example.com'],
        canSend: true,
        interval: '6 hours',
      }),
    ).toBe(
      'Ops digest: enabled · every 6 hours · ZeptoMail configured · to ops@example.com',
    );
  });

  it('appends the block reason when send is disabled', () => {
    expect(
      digestStatusCaption({
        enabled: true,
        zeptoConfigured: false,
        recipients: [],
        canSend: false,
        reason: 'ZeptoMail is not configured.',
        interval: '6 hours',
      }),
    ).toContain('ZeptoMail is not configured.');
  });
});

describe('digest send helpers', () => {
  it('disables send while in flight or when the server says canSend is false', () => {
    expect(digestSendDisabled(false, true)).toBe(false);
    expect(digestSendDisabled(true, true)).toBe(true);
    expect(digestSendDisabled(false, false)).toBe(true);
  });

  it('treats digest sent copy as success', () => {
    expect(digestAlertSeverity('Digest sent. Last 6h: 3 runs, 2 passed, 1 failed.')).toBe('success');
    expect(digestAlertSeverity('ZeptoMail is not configured.')).toBe('warning');
  });

  it('formats the last-6h summary after a successful send', () => {
    expect(
      digestSentMessage({
        last6h: { total: 37, passed: 32, failed: 5, jobsAddedToBoard: 18 },
      }),
    ).toBe('Digest sent. Last 6h: 37 runs, 32 passed, 5 failed, 18 jobs added.');
    expect(digestSentMessage(null)).toBe('Digest sent.');
  });
});
