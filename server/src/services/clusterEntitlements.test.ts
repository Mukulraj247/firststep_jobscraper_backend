import { describe, expect, it } from 'vitest';
import {
  displayPlanType,
  getEntitlements,
  isAllowedWindow,
  parseClusterWindow,
  planIncludedSlots,
  resolveSubscribedSlots,
  windowCutoff,
} from './clusterEntitlements';

describe('getEntitlements', () => {
  it('maps Premium Plus to 2 clusters and all windows', () => {
    const e = getEntitlements({
      subscriptionType: 'Premium Plus',
      isActive: true,
      status: 'active',
      fetchedAt: new Date(),
    });
    expect(e.maxActiveClusters).toBe(2);
    expect(e.allowedWindows).toEqual(['1h', '12h', '24h']);
    expect(e.source).toBe('first_step');
  });

  it('maps First Step PremiumPlus key to 2 clusters', () => {
    const e = getEntitlements({
      subscriptionType: 'PremiumPlus',
      isActive: true,
      status: 'active',
      fetchedAt: new Date(),
    });
    expect(e.maxActiveClusters).toBe(2);
    expect(e.allowedWindows).toEqual(['1h', '12h', '24h']);
    expect(e.source).toBe('first_step');
  });

  it('maps Premium+ alias to 2 clusters', () => {
    const e = getEntitlements({
      subscriptionType: 'Premium+',
      isActive: true,
      status: 'active',
      fetchedAt: new Date(),
    });
    expect(e.maxActiveClusters).toBe(2);
    expect(e.source).toBe('first_step');
  });

  it('maps Normal Plan / Standard to 0 included slots', () => {
    const e = getEntitlements({
      subscriptionType: 'Normal Plan',
      isActive: true,
      status: 'active',
      fetchedAt: new Date(),
    });
    expect(e.maxActiveClusters).toBe(0);
    expect(e.allowedWindows).toEqual([]);
    expect(e.source).toBe('first_step');
  });

  it('returns zero for inactive plans', () => {
    const e = getEntitlements({
      subscriptionType: 'Premium Plus',
      isActive: false,
      status: 'cancelled',
      fetchedAt: new Date(),
    });
    expect(e.maxActiveClusters).toBe(0);
    expect(e.allowedWindows).toEqual([]);
    expect(e.source).toBe('inactive');
  });

  it('returns zero for unknown type', () => {
    const e = getEntitlements({
      subscriptionType: 'unknown',
      isActive: null,
      status: null,
      fetchedAt: new Date(),
      error: 'http_500',
    });
    expect(e.maxActiveClusters).toBe(0);
    expect(e.source).toBe('unknown');
  });

  it('returns zero for unmapped types (no conservative 1-slot default)', () => {
    const e = getEntitlements({
      subscriptionType: 'SomeFuturePlan',
      isActive: true,
      status: 'active',
      fetchedAt: new Date(),
    });
    expect(e.maxActiveClusters).toBe(0);
    expect(e.source).toBe('default');
  });
});

describe('displayPlanType', () => {
  it('normalizes PremiumPlus to Premium Plus', () => {
    expect(displayPlanType('PremiumPlus')).toBe('Premium Plus');
    expect(displayPlanType('Premium Plus')).toBe('Premium Plus');
  });

  it('maps Normal Plan and empty to Standard', () => {
    expect(displayPlanType('Normal Plan')).toBe('Standard');
    expect(displayPlanType(null)).toBe('Standard');
    expect(displayPlanType('')).toBe('Standard');
  });

  it('maps all First Step plan keys to display labels', () => {
    expect(displayPlanType('Essentials')).toBe('Essentials');
    expect(displayPlanType('Elite')).toBe('Elite');
    expect(displayPlanType('FalconLite')).toBe('Falcon Lite');
    expect(displayPlanType('Falcon')).toBe('Falcon');
    expect(displayPlanType('Premium')).toBe('Premium');
    expect(displayPlanType('Premium Plan')).toBe('Premium');
  });
});

describe('getEntitlements First Step catalog', () => {
  it('maps Essentials / Elite / FalconLite / Premium to 0 included', () => {
    for (const type of ['Essentials', 'Elite', 'FalconLite', 'Premium', 'Enterprise']) {
      const e = getEntitlements({
        subscriptionType: type,
        isActive: true,
        status: 'active',
        fetchedAt: new Date(),
      });
      expect(e.maxActiveClusters).toBe(0);
      expect(e.allowedWindows).toEqual([]);
      expect(e.source).toBe('first_step');
    }
  });

  it('maps Falcon like Premium Plus', () => {
    const e = getEntitlements({
      subscriptionType: 'Falcon',
      isActive: true,
      status: 'active',
      fetchedAt: new Date(),
    });
    expect(e.maxActiveClusters).toBe(2);
    expect(e.allowedWindows).toEqual(['1h', '12h', '24h']);
  });
});

describe('planIncludedSlots + resolveSubscribedSlots', () => {
  const ppPlan = {
    subscriptionType: 'Premium Plus',
    isActive: true,
    status: 'active',
    fetchedAt: new Date(),
  };
  const essentialsPlan = {
    subscriptionType: 'Essentials',
    isActive: true,
    status: 'active',
    fetchedAt: new Date(),
  };

  it('planIncludedSlots is 2 for Premium Plus and 0 for Essentials', () => {
    expect(planIncludedSlots(ppPlan)).toBe(2);
    expect(planIncludedSlots(essentialsPlan)).toBe(0);
  });

  it('Premium Plus defaults subscription on with 2 slots (no Start needed)', () => {
    const r = resolveSubscribedSlots({ plan: ppPlan });
    expect(r.subscriptionOn).toBe(true);
    expect(r.planIncludedSlots).toBe(2);
    expect(r.subscribedSlots).toBe(2);
    expect(r.allowedWindows).toEqual(['1h', '12h', '24h']);
  });

  it('Essentials defaults subscription off with 0 slots', () => {
    const r = resolveSubscribedSlots({ plan: essentialsPlan });
    expect(r.subscriptionOn).toBe(false);
    expect(r.subscribedSlots).toBe(0);
  });

  it('ops allotment overrides plan default when subscription on', () => {
    const r = resolveSubscribedSlots({
      plan: essentialsPlan,
      clusterServiceStartedAt: new Date(),
      adminClusterLimit: 10,
    });
    expect(r.subscriptionOn).toBe(true);
    expect(r.subscribedSlots).toBe(10);
  });

  it('opt-out turns Premium Plus subscription off', () => {
    const r = resolveSubscribedSlots({
      plan: ppPlan,
      clusterServiceOptOut: true,
      clusterServiceStartedAt: new Date(),
    });
    expect(r.subscriptionOn).toBe(false);
    expect(r.subscribedSlots).toBe(0);
  });

  it('clamps allotment to 50', () => {
    const r = resolveSubscribedSlots({
      plan: ppPlan,
      adminClusterLimit: 500,
    });
    expect(r.subscribedSlots).toBe(50);
  });

  it('allows zero allotment when ops sets adminClusterLimit to 0', () => {
    const r = resolveSubscribedSlots({
      plan: ppPlan,
      adminClusterLimit: 0,
    });
    expect(r.subscriptionOn).toBe(true);
    expect(r.subscribedSlots).toBe(0);
  });
});

describe('window helpers', () => {
  it('parses known windows and falls back', () => {
    expect(parseClusterWindow('1h')).toBe('1h');
    expect(parseClusterWindow('12h')).toBe('12h');
    expect(parseClusterWindow('bogus')).toBe('24h');
  });

  it('checks allowed windows against entitlements', () => {
    const e = getEntitlements({
      subscriptionType: 'Premium Plus',
      isActive: true,
      status: 'active',
      fetchedAt: new Date(),
    });
    expect(isAllowedWindow(e, '12h')).toBe(true);
    expect(isAllowedWindow(e, '1h')).toBe(true);
  });

  it('Premium plan has no plan windows; ops allotment grants all windows', () => {
    const e = getEntitlements({
      subscriptionType: 'Premium',
      isActive: true,
      status: 'active',
      fetchedAt: new Date(),
    });
    expect(isAllowedWindow(e, '12h')).toBe(false);
    const r = resolveSubscribedSlots({
      plan: {
        subscriptionType: 'Premium',
        isActive: true,
        status: 'active',
        fetchedAt: new Date(),
      },
      clusterServiceStartedAt: new Date(),
      adminClusterLimit: 5,
    });
    expect(isAllowedWindow(r, '1h')).toBe(true);
  });

  it('computes cutoff from window', () => {
    const now = Date.parse('2026-01-15T12:00:00.000Z');
    expect(windowCutoff('1h', now).toISOString()).toBe('2026-01-15T11:00:00.000Z');
    expect(windowCutoff('12h', now).toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});
