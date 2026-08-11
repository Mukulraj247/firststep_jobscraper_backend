import { describe, expect, it } from 'vitest';
import {
  applyLayoutChangeSuggestion,
  classifyFailureReason,
  resolveFailureReason,
} from './failureReason';

describe('applyLayoutChangeSuggestion', () => {
  it('suggests layout_change on zero_rows', () => {
    expect(
      applyLayoutChangeSuggestion({
        anomaly: 'zero_rows',
        runStatus: 'failed',
        rows: 0,
      })
    ).toEqual({ failureReason: 'layout_change', failureReasonSource: 'suggested' });
  });

  it('suggests layout_change on failed empty extract', () => {
    expect(
      applyLayoutChangeSuggestion({
        anomaly: null,
        runStatus: 'failed',
        rows: 0,
      })
    ).toEqual({ failureReason: 'layout_change', failureReasonSource: 'suggested' });
  });

  it('does not overwrite confirmed reasons', () => {
    expect(
      applyLayoutChangeSuggestion({
        anomaly: 'zero_rows',
        runStatus: 'failed',
        rows: 0,
        failureReason: 'layout_change',
        failureReasonSource: 'confirmed',
      })
    ).toEqual({ failureReason: 'layout_change', failureReasonSource: 'confirmed' });
  });

  it('leaves healthy runs unchanged', () => {
    expect(
      applyLayoutChangeSuggestion({
        anomaly: null,
        runStatus: 'completed',
        rows: 12,
        failureReason: null,
        failureReasonSource: null,
      })
    ).toEqual({ failureReason: null, failureReasonSource: null });
  });
});

describe('classifyFailureReason', () => {
  it('classifies CAPTCHA', () => {
    expect(
      classifyFailureReason('CAPTCHA encountered — run paused. CAPTCHA detected (re-captcha)')
    ).toBe('captcha');
  });

  it('classifies browser closed', () => {
    expect(
      classifyFailureReason('browserContext.newPage: Target page, context or browser has been closed')
    ).toBe('browser_closed');
  });

  it('classifies navigation errors', () => {
    expect(classifyFailureReason('page.goto: net::ERR_CONNECTION_REFUSED')).toBe('navigation_error');
  });

  it('classifies timeouts', () => {
    expect(classifyFailureReason('Timeout 30000ms exceeded')).toBe('timeout');
  });

  it('returns null for empty', () => {
    expect(classifyFailureReason('')).toBeNull();
  });
});

describe('resolveFailureReason', () => {
  it('derives from errorMessage when unset', () => {
    expect(
      resolveFailureReason({
        failureReason: null,
        errorMessage: 'Target page, context or browser has been closed',
      })
    ).toEqual({ failureReason: 'browser_closed', failureReasonSource: 'suggested' });
  });

  it('keeps confirmed reasons', () => {
    expect(
      resolveFailureReason({
        failureReason: 'layout_change',
        failureReasonSource: 'confirmed',
        errorMessage: 'CAPTCHA encountered',
      })
    ).toEqual({ failureReason: 'layout_change', failureReasonSource: 'confirmed' });
  });
});
