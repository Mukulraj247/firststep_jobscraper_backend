import { describe, expect, it } from 'vitest';
import { isAggregatorApplyHost, isEmployerApplyHref } from './aggregatorHosts';

describe('aggregatorHosts', () => {
  it('isAggregatorApplyHost detects aggregator boards', () => {
    expect(isAggregatorApplyHost('www.choppingblock.ai')).toBe(true);
    expect(isAggregatorApplyHost('aidevboard.com')).toBe(true);
    expect(isAggregatorApplyHost('greenhouse.io')).toBe(false);
  });

  it('isEmployerApplyHref accepts employer URLs only', () => {
    expect(isEmployerApplyHref('https://boards.greenhouse.io/acme/jobs/1')).toBe(true);
    expect(isEmployerApplyHref('https://hiring.cafe/job/abc')).toBe(false);
  });
});
