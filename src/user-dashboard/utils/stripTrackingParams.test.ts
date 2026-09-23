import { describe, expect, it } from 'vitest';
import { stripTrackingParams } from '../utils/stripTrackingParams';

describe('stripTrackingParams', () => {
  it('removes source and keeps path identity', () => {
    expect(
      stripTrackingParams('https://careers.example.com/job/123?source=hiringcave&foo=1'),
    ).toBe('https://careers.example.com/job/123?foo=1');
  });

  it('removes linkedin-style source', () => {
    expect(stripTrackingParams('https://jobs.example.com/x?source=linkedin')).toBe(
      'https://jobs.example.com/x',
    );
  });

  it('returns empty for blank input', () => {
    expect(stripTrackingParams('')).toBe('');
    expect(stripTrackingParams(null)).toBe('');
  });
});
