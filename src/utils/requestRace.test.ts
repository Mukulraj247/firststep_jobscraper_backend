import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { DashboardAutomationsResponse } from '../api/automation';
import {
  automationQueryOptions,
  automationQueryKey,
  type AutomationQuery,
} from '../features/automations/automationQueries';
import {
  failureQueryKey,
  failureQueryOptions,
  type FailureQuery,
} from '../features/failures/failureQueries';

const automationResponse = (name: string): DashboardAutomationsResponse => ({
  automations: [
    {
      id: name,
      name,
      targetUrl: 'https://example.com/jobs',
      lastRunTime: null,
      rowsExtracted: 0,
      status: 'success',
      webhookConfigured: false,
      proxyConfigured: false,
    },
  ],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
  summary: {
    totalAutomations: 1,
    activeScheduledCount: 0,
    pausedScheduleCount: 0,
    rowsExtractedTotal: 0,
    successfulCount: 0,
    failedCount: 0,
  },
});

describe('request-race query contracts', () => {
  it('rapid filter changes expose only the newest result', async () => {
    const pending = new Map<string, (value: ReturnType<typeof automationResponse>) => void>();
    const fetcher = vi.fn((query: AutomationQuery) => new Promise<ReturnType<typeof automationResponse>>((resolve) => {
      pending.set(query.q, resolve);
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver(client, automationQueryOptions({
      page: 1,
      pageSize: 10,
      q: 'old',
      id: '',
      tags: [],
      schedule: '',
    }, fetcher));

    const rendered: string[] = [];
    const unsubscribe = observer.subscribe((result) => {
      const name = result.data?.automations[0]?.name;
      if (name) rendered.push(name);
    });

    observer.setOptions(automationQueryOptions({
      page: 1,
      pageSize: 10,
      q: 'new',
      id: '',
      tags: [],
      schedule: '',
    }, fetcher));
    pending.get('new')?.(automationResponse('new'));
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.automations[0]?.name).toBe('new'));
    pending.get('old')?.(automationResponse('old'));
    await Promise.resolve();

    expect(observer.getCurrentResult().data?.automations[0]?.name).toBe('new');
    expect(rendered).not.toContain('old');
    unsubscribe();
    client.clear();
  });

  it('changing a filter from page 4 requests only page 1 for the new filter', async () => {
    const fetcher = vi.fn(async (query: AutomationQuery) => automationResponse(query.q));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver(client, automationQueryOptions({
      page: 4,
      pageSize: 10,
      q: '',
      id: '',
      tags: [],
      schedule: '',
    }, fetcher));
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    fetcher.mockClear();

    observer.setOptions(automationQueryOptions({
      page: 1,
      pageSize: 10,
      q: 'filtered',
      id: '',
      tags: [],
      schedule: '',
    }, fetcher));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, q: 'filtered' }),
      expect.any(AbortSignal),
    );
    expect(fetcher).not.toHaveBeenCalledWith(
      expect.objectContaining({ page: 4, q: 'filtered' }),
      expect.anything(),
    );
    unsubscribe();
    client.clear();
  });

  it('automation stale checks include every active automation filter', () => {
    const query: AutomationQuery = {
      page: 3,
      pageSize: 50,
      q: 'acme',
      id: 'SX123',
      tags: ['priority', 'sales'],
      schedule: '0 * * * *',
    };

    expect(automationQueryKey(query)).toEqual([
      'automations',
      3,
      50,
      'acme',
      'SX123',
      ['priority', 'sales'],
      '0 * * * *',
    ]);
  });

  it('failure keys include page, size, query, ID, status, anomaly, reason, time window, custom range, and healed filter', () => {
    const query: FailureQuery = {
      page: 2,
      pageSize: 25,
      q: 'checkout',
      id: 'SX456',
      status: 'failed',
      anomaly: 'zero_rows',
      reason: 'timeout',
      timeWindow: '6h',
    };

    // Positions 8-10 (timeWindow, from, to) are read by shouldKeepFailurePlaceholder —
    // do not reorder without updating it.
    expect(failureQueryKey(query)).toEqual([
      'failures',
      2,
      25,
      'checkout',
      'SX456',
      'failed',
      'zero_rows',
      'timeout',
      '6h',
      '',
      '',
      true,
    ]);
  });

  it('failure keys carry an explicit custom range and excludeHealed=false', () => {
    const query: FailureQuery = {
      page: 1,
      pageSize: 25,
      q: '',
      id: '',
      status: 'failed',
      anomaly: '',
      reason: '',
      timeWindow: '24h',
      from: '2026-01-01',
      to: '2026-01-07',
      excludeHealed: false,
    };

    const key = failureQueryKey(query);
    expect(key.slice(9)).toEqual(['2026-01-01', '2026-01-07', false]);
  });

  it('passes React Query cancellation signals to both request functions', async () => {
    const automationFetcher = vi.fn(async () => automationResponse('automation'));
    const failureFetcher = vi.fn(async () => ({
      runs: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 1 },
      countsByReason: {},
    }));
    const controller = new AbortController();
    const automation = automationQueryOptions({
      page: 1,
      pageSize: 10,
      q: '',
      id: '',
      tags: [],
      schedule: '',
    }, automationFetcher);
    const failure = failureQueryOptions({
      page: 1,
      pageSize: 25,
      q: '',
      id: '',
      status: 'failed,dead,aborted',
      anomaly: '',
      reason: '',
      timeWindow: '1h',
    }, failureFetcher);

    await automation.queryFn!({ signal: controller.signal } as never);
    await failure.queryFn!({ signal: controller.signal } as never);

    expect(automationFetcher).toHaveBeenCalledWith(expect.any(Object), controller.signal);
    expect(failureFetcher).toHaveBeenCalledWith(expect.any(Object), controller.signal);
  });
});
