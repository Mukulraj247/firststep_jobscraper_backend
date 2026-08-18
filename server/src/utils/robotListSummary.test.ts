import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/automationScheduler', () => ({
  resolveEffectiveScheduleState: (r: any) => r.schedule || { enabled: false },
}));

import {
  buildRecordingsSummary,
  buildRobotListSummary,
  classifyLastRunStatus,
  formatScheduleLabel,
  humanizeCronLabel,
  pickLatestRun,
} from './robotListSummary';

describe('humanizeCronLabel', () => {
  it('maps known cron expressions', () => {
    expect(humanizeCronLabel('0 0 * * *')).toBe('Every day');
    expect(humanizeCronLabel('0 * * * *')).toBe('Every hour');
  });

  it('falls back to raw cron for unknown expressions', () => {
    expect(humanizeCronLabel('5 4 * * *')).toBe('5 4 * * *');
  });
});

describe('formatScheduleLabel', () => {
  it('returns Off when disabled or empty', () => {
    expect(formatScheduleLabel({ enabled: false, cron: '0 9 * * *' })).toBe('Every day');
    expect(formatScheduleLabel({ enabled: true, cron: '' })).toBe('Off');
  });

  it('returns human label when enabled', () => {
    expect(formatScheduleLabel({ enabled: true, cron: '0 9 * * *' })).toBe('0 9 * * *');
    expect(formatScheduleLabel({ enabled: true, cron: '0 0 * * *' })).toBe('Every day');
  });
});

describe('classifyLastRunStatus', () => {
  it('groups statuses into summary buckets', () => {
    expect(classifyLastRunStatus('completed')).toBe('succeeded');
    expect(classifyLastRunStatus('failed')).toBe('failed');
    expect(classifyLastRunStatus('scheduled')).toBe('active');
    expect(classifyLastRunStatus(null)).toBe('idle');
  });
});

describe('buildRecordingsSummary', () => {
  it('aggregates counts across robots', () => {
    const summary = buildRecordingsSummary(
      [
        { schedule: { enabled: true, cron: '0 0 * * *', label: 'Every day' }, lastRun: { status: 'completed', startedAt: null, finishedAt: null } },
        { schedule: { enabled: false, cron: null, label: 'Off' }, lastRun: { status: 'failed', startedAt: null, finishedAt: null } },
        { schedule: { enabled: false, cron: null, label: 'Off' }, lastRun: null },
      ],
      3
    );
    expect(summary).toEqual({
      total: 3,
      succeeded: 1,
      failed: 1,
      scheduled: 1,
      idle: 1,
    });
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
      schedule: { enabled: true, cron: '0 * * * *', label: 'Every hour' },
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
    expect(summary.schedule).toEqual({ enabled: false, cron: null, label: 'Off' });
    expect(summary.lastRun).toBeNull();
  });
});
