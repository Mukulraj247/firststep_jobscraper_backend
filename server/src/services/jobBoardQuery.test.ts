import { describe, expect, it } from 'vitest';
import { applyJobBoardListFilters } from './jobBoardQuery';

describe('applyJobBoardListFilters', () => {
  it('filters added date on createdAt, not scraped date', () => {
    const since = new Date('2026-08-18T11:00:00.000Z');
    const match = applyJobBoardListFilters({ ownerId: 'u1' }, { addedSince: since });
    expect(match.createdAt).toEqual({ $gte: since });
    expect(JSON.stringify(match)).not.toContain('"date":');
  });

  it('matches location, work mode, and job type on listing and snapshot fields', () => {
    const match = applyJobBoardListFilters(
      { ownerId: 'u1' },
      { location: 'Bengaluru', workMode: 'Remote', jobType: 'Full time' },
    );
    const and = match.$and as Record<string, unknown>[];
    expect(and.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(and)).toContain('location');
    expect(JSON.stringify(and)).toMatch(/remoteType/i);
    expect(JSON.stringify(and)).toMatch(/employmentType/i);
  });

  it('filters combined aggregator sources', () => {
    const match = applyJobBoardListFilters({ ownerId: 'u1' }, { source: 'aggregator' });
    const and = match.$and as Record<string, unknown>[];
    expect(and).toEqual([{ source: { $in: ['hiring_cafe', 'linkedin'] } }]);
  });
});
