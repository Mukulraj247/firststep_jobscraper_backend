import { describe, expect, it } from 'vitest';
import { pickBestJobHref, scoreHrefCandidate } from './jobUrlPick';

describe('jobUrlPick', () => {
  it('scores /job/{slug} above /jobs index', () => {
    const posting = scoreHrefCandidate(
      'https://hiringcafe.com/job/senior-engineer-acme-raleigh-abc123',
      'https://hiringcafe.com'
    );
    const index = scoreHrefCandidate('https://hiringcafe.com/jobs', 'https://hiringcafe.com');
    expect(posting).toBeGreaterThan(index);
  });

  it('pickBestJobHref prefers posting URLs', () => {
    const picked = pickBestJobHref(
      [
        'https://hiringcafe.com/jobs',
        'https://hiringcafe.com/job/senior-engineer-acme-abc123',
        '/search',
      ],
      'https://hiringcafe.com'
    );
    expect(picked).toBe('https://hiringcafe.com/job/senior-engineer-acme-abc123');
  });
});
