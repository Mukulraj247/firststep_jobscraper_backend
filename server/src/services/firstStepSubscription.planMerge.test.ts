import { describe, expect, it } from 'vitest';
import {
  isSoftStandardPlan,
  mergeFirstStepPlan,
  planTypeRank,
} from './firstStepSubscription';

describe('planTypeRank', () => {
  it('ranks PremiumPlus above Normal Plan', () => {
    expect(planTypeRank('PremiumPlus')).toBeGreaterThan(planTypeRank('Normal Plan'));
    expect(planTypeRank('Premium Plus')).toBe(planTypeRank('PremiumPlus'));
  });
});

describe('isSoftStandardPlan', () => {
  it('treats Normal Plan / unknown / errored as soft', () => {
    expect(isSoftStandardPlan({ subscriptionType: 'Normal Plan', isActive: true, status: 'active', fetchedAt: new Date() })).toBe(true);
    expect(isSoftStandardPlan({ subscriptionType: 'unknown', isActive: null, status: null, fetchedAt: new Date(), error: 'fetch failed' })).toBe(true);
    expect(isSoftStandardPlan(null)).toBe(true);
  });

  it('treats PremiumPlus as confirmed', () => {
    expect(
      isSoftStandardPlan({
        subscriptionType: 'PremiumPlus',
        isActive: true,
        status: 'active',
        fetchedAt: new Date(),
      })
    ).toBe(false);
  });
});

describe('mergeFirstStepPlan', () => {
  const paid = {
    subscriptionType: 'PremiumPlus',
    isActive: true,
    status: 'active',
    fetchedAt: new Date('2026-01-01'),
    error: null as string | null,
  };

  it('keeps PremiumPlus when incoming fetch fails', () => {
    const merged = mergeFirstStepPlan(paid, {
      subscriptionType: 'unknown',
      isActive: null,
      status: null,
      fetchedAt: new Date('2026-09-23'),
      error: 'fetch failed',
    });
    expect(merged.subscriptionType).toBe('PremiumPlus');
  });

  it('keeps PremiumPlus when incoming soft-defaults to Normal Plan', () => {
    const merged = mergeFirstStepPlan(paid, {
      subscriptionType: 'Normal Plan',
      isActive: true,
      status: 'active',
      fetchedAt: new Date('2026-09-23'),
      error: 'no_subscription_row',
    });
    expect(merged.subscriptionType).toBe('PremiumPlus');
  });

  it('allows confirmed downgrade PremiumPlus → Normal Plan', () => {
    const merged = mergeFirstStepPlan(paid, {
      subscriptionType: 'Normal Plan',
      isActive: true,
      status: 'active',
      fetchedAt: new Date('2026-09-23'),
      error: null,
    });
    expect(merged.subscriptionType).toBe('Normal Plan');
  });

  it('upgrades Normal Plan to PremiumPlus', () => {
    const merged = mergeFirstStepPlan(
      {
        subscriptionType: 'Normal Plan',
        isActive: true,
        status: 'active',
        fetchedAt: new Date('2026-09-01'),
      },
      {
        subscriptionType: 'PremiumPlus',
        isActive: true,
        status: 'active',
        fetchedAt: new Date('2026-09-23'),
        error: null,
      }
    );
    expect(merged.subscriptionType).toBe('PremiumPlus');
  });
});
