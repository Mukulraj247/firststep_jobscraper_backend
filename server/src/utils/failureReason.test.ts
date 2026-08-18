import { describe, expect, it } from 'vitest';
import {
  applyLayoutChangeSuggestion,
  buildFailureReasonAggregationStages,
  buildNormalizedFailureReasonExpression,
  classifyFailureReason,
  normalizeFailureReason,
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

describe('normalizeFailureReason', () => {
  it('reconciles a CAPTCHA error into the persisted list field when the legacy field is empty', () => {
    expect(
      normalizeFailureReason({
        normalizedFailureReason: null,
        failureReason: null,
        errorMessage: 'CAPTCHA encountered — run paused',
      })
    ).toBe('captcha');
  });

  it('keeps an operator override over automatic classification', () => {
    expect(
      normalizeFailureReason({
        normalizedFailureReason: 'layout_change',
        failureReason: 'layout_change',
        failureReasonSource: 'override',
        errorMessage: 'CAPTCHA encountered',
      })
    ).toBe('layout_change');
  });

  it('keeps an explicit operator clear from being reclassified', () => {
    expect(
      normalizeFailureReason({
        normalizedFailureReason: null,
        failureReason: null,
        failureReasonSource: 'override',
        errorMessage: 'CAPTCHA encountered',
      })
    ).toBeNull();
  });
});

describe('buildNormalizedFailureReasonExpression', () => {
  it('uses errorMessage fallback for legacy CAPTCHA rows when filtering and counting', () => {
    const expression = buildNormalizedFailureReasonExpression();
    const serialized = JSON.stringify(expression);

    expect(serialized).toContain('$normalizedFailureReason');
    expect(serialized).toContain('$failureReason');
    expect(serialized).toContain('$errorMessage');
    expect(serialized).toContain('captcha');
    expect(serialized).toContain('$regexMatch');
  });

  it('preserves an explicit operator clear in the database expression', () => {
    const expression = buildNormalizedFailureReasonExpression();
    const root = expression.$let.in;

    expect(root.$cond[0]).toEqual({
      $and: [
        { $eq: ['$$failure', null] },
        { $eq: ['$$source', 'override'] },
      ],
    });
    expect(root.$cond[1]).toBeNull();
  });
});

describe('buildFailureReasonAggregationStages', () => {
  it('classifies a legacy CAPTCHA before both page filtering and reason counting', () => {
    const stages = buildFailureReasonAggregationStages(['captcha']);

    expect(stages.page).toEqual([
      expect.objectContaining({ $addFields: expect.any(Object) }),
      { $match: { normalizedFailureReason: 'captcha' } },
    ]);
    expect(stages.counts).toEqual([
      expect.objectContaining({ $addFields: expect.any(Object) }),
      {
        $group: {
          _id: { $ifNull: ['$normalizedFailureReason', 'unknown'] },
          count: { $sum: 1 },
        },
      },
    ]);

    const pageClassification = JSON.stringify(stages.page[0]);
    const countClassification = JSON.stringify(stages.counts[0]);
    expect(pageClassification).toBe(countClassification);
    expect(pageClassification).toContain('$errorMessage');
    expect(pageClassification).toContain('captcha');
  });

  it('does not make successful rows display an unknown failure', () => {
    const stages = buildFailureReasonAggregationStages([]);

    expect(stages.page[0].$addFields.normalizedFailureReason)
      .toEqual(buildNormalizedFailureReasonExpression());
  });

  it('includes unclassified rows when the unknown filter is selected', () => {
    const stages = buildFailureReasonAggregationStages(['unknown']);

    expect(stages.page[1]).toEqual({
      $match: { normalizedFailureReason: { $in: ['unknown', null] } },
    });
  });
});
