import { describe, expect, it } from 'vitest';
import { scoreJobHrefPath } from '../../../src/shared/jobHrefScore';

describe('scoreJobHrefPath', () => {
  it('ranks a Hiring Cafe posting above the /jobs index', () => {
    const posting = scoreJobHrefPath(
      '/job/senior-building-automation-systems-specialist-siemens-raleigh-north-3kuh829x4a1ug9f6'
    );
    const listing = scoreJobHrefPath('/jobs');
    expect(posting).toBeGreaterThan(listing);
  });

  it('does not treat /jobs as a /job match', () => {
    expect(scoreJobHrefPath('/jobs')).toBeLessThan(scoreJobHrefPath('/job/abc-role-slug-here'));
  });
});
