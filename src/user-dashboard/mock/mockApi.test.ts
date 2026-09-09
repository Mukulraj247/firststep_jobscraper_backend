import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  filterFeedJobs,
  resetPortalState,
  subscribe,
  saveJob,
  submitClusterRequest,
  loginMock,
  listFeed,
} from './mockApi';
import { MOCK_JOBS } from './mockJobs';
import { MARCUS_SUBSCRIPTIONS, PRIYA_SUBSCRIPTIONS } from './mockPersonas';
import type { FeedFilters } from '../types';

describe('mockApi feed filters', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
    resetPortalState();
  });

  it('filters H-1B sponsor-friendly jobs', () => {
    const filters: FeedFilters = { h1bSponsorFriendly: true };
    const result = filterFeedJobs(MOCK_JOBS, 'all', PRIYA_SUBSCRIPTIONS, filters);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((j) => j.h1bEligible)).toBe(true);
  });

  it('filters FY2026 filing match jobs', () => {
    const filters: FeedFilters = { h1bFy2026Match: true };
    const result = filterFeedJobs(MOCK_JOBS, 'all', MARCUS_SUBSCRIPTIONS, filters);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((j) => j.h1bFy2026Match)).toBe(true);
  });

  it('respects delivery window cutoff', () => {
    const oldJob = {
      ...MOCK_JOBS[0],
      id: 'job-old',
      lastSeenAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      postedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    };
    const jobs = [oldJob, ...MOCK_JOBS.slice(1)];
    const result = filterFeedJobs(jobs, 'sub-marcus-google', MARCUS_SUBSCRIPTIONS, {}, Date.now());
    expect(result.find((j) => j.id === 'job-old')).toBeUndefined();
  });

  it('subscribe adds active subscription', async () => {
    await loginMock('priya');
    const sub = await subscribe('cluster-meta', 'plan-standard', '2h');
    expect(sub.status).toBe('active');
    expect(sub.clusterName).toBe('Meta Careers');
  });

  it('saveJob persists saved id', async () => {
    await loginMock('priya');
    await saveJob('job-003');
    const feed = await listFeed('all', {});
    const saved = feed.jobs.find((j) => j.id === 'job-003');
    expect(saved?.saved).toBe(true);
  });

  it('submitClusterRequest creates submitted request', async () => {
    await loginMock('priya');
    const req = await submitClusterRequest({
      title: 'Test cluster',
      industries: ['Tech'],
      locations: ['NYC'],
      roles: ['Engineer'],
    });
    expect(req.status).toBe('submitted');
    expect(req.title).toBe('Test cluster');
  });
});
