import { describe, expect, it } from 'vitest';
import {
  isSlotLocked,
  pickSlotsBannerBody,
  planIncludedClusterCount,
} from './SlotLock';
import type { PortalEntitlements } from '../types';

function ents(partial: Partial<PortalEntitlements>): PortalEntitlements {
  return {
    subscriptionType: 'Essentials',
    isActive: true,
    maxActiveClusters: 0,
    allowedWindows: [],
    activeClusterCount: 0,
    availableSlots: 0,
    ...partial,
  };
}

describe('isSlotLocked', () => {
  it('locks when subscription has not been started by admin', () => {
    expect(
      isSlotLocked(
        ents({
          clusterServiceStarted: false,
          subscribedSlots: 0,
          availableSlots: 0,
        })
      )
    ).toBe(true);
  });

  it('locks Essentials-style users with no allotment even if fields look empty', () => {
    expect(
      isSlotLocked(
        ents({
          subscriptionType: 'Essentials',
          clusterServiceStarted: false,
          maxActiveClusters: 0,
          subscribedSlots: 0,
          availableSlots: 0,
        })
      )
    ).toBe(true);
  });

  it('unlocks when subscription is on and free slots remain', () => {
    expect(
      isSlotLocked(
        ents({
          clusterServiceStarted: true,
          subscribedSlots: 2,
          maxActiveClusters: 2,
          availableSlots: 2,
          activeClusterCount: 0,
        })
      )
    ).toBe(false);
  });

  it('locks when subscription is on but allotment is exhausted', () => {
    expect(
      isSlotLocked(
        ents({
          clusterServiceStarted: true,
          subscribedSlots: 2,
          maxActiveClusters: 2,
          availableSlots: 0,
          activeClusterCount: 2,
        })
      )
    ).toBe(true);
  });

  it('locks when subscription is on but admin allotted zero slots', () => {
    expect(
      isSlotLocked(
        ents({
          clusterServiceStarted: true,
          subscribedSlots: 0,
          maxActiveClusters: 0,
          availableSlots: 0,
        })
      )
    ).toBe(true);
  });

  it('returns false when entitlements are missing', () => {
    expect(isSlotLocked(null)).toBe(false);
    expect(isSlotLocked(undefined)).toBe(false);
  });
});

describe('pickSlotsBannerBody', () => {
  it('does not claim Essentials includes free slots — credits ops allotment', () => {
    const body = pickSlotsBannerBody({
      entitlements: ents({
        subscriptionType: 'Essentials',
        subscriptionTypeDisplay: 'Essentials',
        planIncludedSlots: 0,
        includedSlots: 0,
        subscribedSlots: 1,
        clusterServiceStarted: true,
      }),
      remaining: 1,
      used: 0,
      allotment: 1,
    });
    expect(body).toContain('Ops assigned you 1 cluster slot');
    expect(body).not.toMatch(/Essentials includes/i);
    expect(body).not.toMatch(/free slot/i);
  });

  it('describes Premium Plus as plan-included, not free', () => {
    const body = pickSlotsBannerBody({
      entitlements: ents({
        subscriptionType: 'Premium Plus',
        planIncludedSlots: 2,
        includedSlots: 2,
        subscribedSlots: 2,
        clusterServiceStarted: true,
      }),
      remaining: 2,
      used: 0,
      allotment: 2,
    });
    expect(body).toContain('Premium Plus includes 2 clusters in your plan');
    expect(body).not.toMatch(/free slot/i);
  });

  it('planIncludedClusterCount is 0 for Essentials and 2 for Premium Plus fields', () => {
    expect(planIncludedClusterCount(ents({ planIncludedSlots: 0, includedSlots: 0 }))).toBe(0);
    expect(planIncludedClusterCount(ents({ planIncludedSlots: 2, includedSlots: 2 }))).toBe(2);
  });
});
