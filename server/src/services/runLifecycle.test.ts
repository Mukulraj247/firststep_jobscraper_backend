import { describe, expect, it } from 'vitest';
import {
  addAdmissionGuardReleaseToTerminalUpdate,
  addFailureClassificationToTerminalUpdate,
  addSortAtToTerminalUpdate,
  isTerminalRunStatus,
} from './runLifecycle';

describe('isTerminalRunStatus', () => {
  it('identifies runs that must never be overwritten by a duplicate queue job', () => {
    expect(isTerminalRunStatus('completed')).toBe(true);
    expect(isTerminalRunStatus('success')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isTerminalRunStatus('dead')).toBe(true);
    expect(isTerminalRunStatus('aborted')).toBe(true);
  });

  it('allows active and retry-pending runs to execute', () => {
    expect(isTerminalRunStatus('pending')).toBe(false);
    expect(isTerminalRunStatus('running')).toBe(false);
  });
});

describe('addAdmissionGuardReleaseToTerminalUpdate', () => {
  it('unsets admission guards for every terminal transition', () => {
    for (const status of ['completed', 'success', 'failed', 'dead', 'aborted']) {
      expect(addAdmissionGuardReleaseToTerminalUpdate({
        $set: { status, finishedAt: 'now' },
      })).toEqual({
        $set: { status, finishedAt: 'now' },
        $unset: { activeAutomationKey: 1, accountActiveSlot: 1 },
      });
    }
  });

  it('keeps aborting active and preserves existing unset fields', () => {
    const update = {
      $set: { status: 'aborting' },
      $unset: { heartbeatAt: 1 },
    };
    expect(addAdmissionGuardReleaseToTerminalUpdate(update)).toBe(update);
  });
});

describe('addSortAtToTerminalUpdate', () => {
  it('sets sortAt from finishedAt on terminal updates', () => {
    const finishedAt = '2026-08-21T04:30:00.000Z';
    expect(addSortAtToTerminalUpdate({
      $set: { status: 'dead', finishedAt },
    })).toEqual({
      $set: {
        status: 'dead',
        finishedAt,
        sortAt: new Date(finishedAt),
      },
    });
  });

  it('skips non-terminal updates', () => {
    const update = { $set: { status: 'running' } };
    expect(addSortAtToTerminalUpdate(update)).toBe(update);
  });
});

describe('addFailureClassificationToTerminalUpdate', () => {
  it('persists CAPTCHA classification with a failed query update', () => {
    expect(addFailureClassificationToTerminalUpdate({
      $set: {
        status: 'failed',
        errorMessage: 'CAPTCHA encountered while enqueueing',
      },
    })).toEqual({
      $set: {
        status: 'failed',
        errorMessage: 'CAPTCHA encountered while enqueueing',
        failureReason: 'captcha',
        failureReasonSource: 'suggested',
        normalizedFailureReason: 'captcha',
      },
    });
  });

  it('does not classify active or successful updates', () => {
    const active = { $set: { status: 'pending', errorMessage: 'CAPTCHA retry' } };
    const success = { $set: { status: 'success' } };

    expect(addFailureClassificationToTerminalUpdate(active)).toBe(active);
    expect(addFailureClassificationToTerminalUpdate(success)).toBe(success);
  });

  it('persists unknown when a terminal writer has no diagnostic text', () => {
    expect(addFailureClassificationToTerminalUpdate({
      $set: { status: 'dead', finishedAt: 'now' },
    })).toEqual({
      $set: {
        status: 'dead',
        finishedAt: 'now',
        failureReason: 'unknown',
        failureReasonSource: 'suggested',
        normalizedFailureReason: 'unknown',
      },
    });
  });

  it('keeps the reason pair aligned when normalized data already exists', () => {
    expect(addFailureClassificationToTerminalUpdate({
      $set: {
        status: 'failed',
        normalizedFailureReason: 'captcha',
      },
    }).$set).toEqual({
      status: 'failed',
      failureReason: 'captcha',
      failureReasonSource: 'suggested',
      normalizedFailureReason: 'captcha',
    });
  });

  it('preserves an explicit operator clear on terminal save data', () => {
    const update = {
      status: 'failed',
      failureReason: null,
      failureReasonSource: 'override',
      normalizedFailureReason: null,
      errorMessage: 'CAPTCHA encountered',
    };

    expect(addFailureClassificationToTerminalUpdate(update)).toBe(update);
  });
});
