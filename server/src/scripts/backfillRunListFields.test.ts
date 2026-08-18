import { describe, expect, it } from 'vitest';
import { buildRunListFieldBackfill } from './backfillRunListFields';

describe('buildRunListFieldBackfill', () => {
  it('reports a dry-run update for legacy CAPTCHA and missing list fields', () => {
    const result = buildRunListFieldBackfill({
      _id: 'abc',
      runId: 'run-1',
      runByUserId: 'owner-1',
      startedAt: '2026-08-17T10:00:00.000Z',
      errorMessage: 'CAPTCHA encountered',
    });

    expect(result.malformed).toEqual([]);
    expect(result.set).toMatchObject({
      ownerId: 'owner-1',
      normalizedFailureReason: 'captcha',
      originalRunId: 'run-1',
      retrySequence: 0,
    });
    expect(result.set.sortAt).toEqual(new Date('2026-08-17T10:00:00.000Z'));
  });

  it('does not overwrite an already normalized reason', () => {
    expect(
      buildRunListFieldBackfill({
        _id: 'abc',
        runId: 'run-1',
        normalizedFailureReason: 'layout_change',
        errorMessage: 'CAPTCHA encountered',
      }).set.normalizedFailureReason
    ).toBeUndefined();
  });

  it('uses the known lineage root for a retry instead of its immediate parent', () => {
    expect(
      buildRunListFieldBackfill({
        _id: 'abc',
        runId: 'retry-2',
        retryOfRunId: 'retry-1',
        retryRootRunId: 'original',
      }).set
    ).toMatchObject({ originalRunId: 'original', retrySequence: 1 });
  });
});
