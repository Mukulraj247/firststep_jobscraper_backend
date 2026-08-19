import { describe, expect, it } from 'vitest';
import {
  dashboardDigitalOceanQueryKey,
  dashboardDigitalOceanQueryOptions,
  dashboardMetricsQueryKey,
  dashboardMetricsQueryOptions,
  dashboardQueryKeys,
} from './dashboardQueries';

describe('dashboard query keys', () => {
  it('keeps metrics and DigitalOcean as independent caches under one dashboard root', () => {
    expect(dashboardQueryKeys.all).toEqual(['dashboard']);
    expect(dashboardMetricsQueryKey({ window: '6h', date: null })).toEqual([
      'dashboard',
      'metrics',
      '6h',
      '',
    ]);
    expect(dashboardDigitalOceanQueryKey({ window: '6h', date: '2026-08-18' })).toEqual([
      'dashboard',
      'digital-ocean',
      '6h',
      '2026-08-18',
    ]);
  });
});

describe('dashboard query options', () => {
  it('keeps previous metrics visible while the window changes', () => {
    const options = dashboardMetricsQueryOptions({ window: '6h', date: null });
    expect(typeof options.placeholderData).toBe('function');
    const placeholder = options.placeholderData;
    if (typeof placeholder !== 'function') return;
    const previous = { totals: { runs: 49 } };
    expect(placeholder(previous as never, undefined as never)).toBe(previous);
  });

  it('loads DigitalOcean independently so KPI cards do not wait on droplet charts', () => {
    const metricsKey = dashboardMetricsQueryOptions({ window: '6h', date: null }).queryKey;
    const doKey = dashboardDigitalOceanQueryOptions({ window: '6h', date: null }).queryKey;
    expect(metricsKey).not.toEqual(doKey);
    expect(doKey[1]).toBe('digital-ocean');
  });
});
