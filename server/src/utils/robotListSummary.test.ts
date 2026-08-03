import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/automationScheduler', () => ({
  resolveEffectiveScheduleState: (r: any) => r.schedule || { enabled: false },
}));

import { buildRobotListSummary, pickLatestRun, formatScheduleLabel } from './robotListSummary';

describe('formatScheduleLabel', () => {
  it('returns Off when disabled or empty', () => {
    expect(formatScheduleLabel({ enabled: false, cron: '0 9 * * *' })).toBe('Off');
    expect(formatScheduleLabel({ enabled: true, cron: '' })).toBe('Off');
  });

  it('returns cron string when enabled', () => {
    expect(formatScheduleLabel({ enabled: true, cron: '0 9 * * *' })).toBe('0 9 * * *');
  });
});

describe('pickLatestRun', () => {
  it('picks newest by startedAt then _id', () => {
    const run = pickLatestRun([
      { status: 'success', startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:01:00.000Z', _id: 'a' },
      { status: 'failed', startedAt: '2024-01-02T00:00:00.000Z', finishedAt: '2024-01-02T00:01:00.000Z', _id: 'b' },
    ]);
    expect(run?.status).toBe('failed');
  });

  it('returns null for empty', () => {
    expect(pickLatestRun([])).toBeNull();
  });
});

describe('buildRobotListSummary', () => {
  it('maps meta without including workflow', () => {
    const summary = buildRobotListSummary(
      {
        recording_meta: {
          id: 'r1',
          name: 'naukri',
          type: 'scrape',
          url: 'https://example.com',
          updatedAt: '1/1/2024',
          params: [],
        },
        recording: { workflow: [{ where: {}, what: [] }] },
        schedule: { enabled: true, cron: '0 * * * *' },
      },
      { status: 'running', startedAt: 'x', finishedAt: null }
    );
    expect(summary).toEqual({
      id: 'r1',
      name: 'naukri',
      type: 'scrape',
      url: 'https://example.com',
      updatedAt: '1/1/2024',
      params: [],
      schedule: { enabled: true, label: '0 * * * *' },
      lastRun: { status: 'running', startedAt: 'x', finishedAt: null },
    });
    expect((summary as any).recording).toBeUndefined();
    expect((summary as any).workflow).toBeUndefined();
  });

  it('defaults type to extract when missing', () => {
    const summary = buildRobotListSummary(
      { recording_meta: { id: 'r2', name: 'IT', updatedAt: '', params: [] }, recording: { workflow: [] }, schedule: null },
      null
    );
    expect(summary.type).toBe('extract');
    expect(summary.schedule).toEqual({ enabled: false, label: 'Off' });
    expect(summary.lastRun).toBeNull();
  });
});
