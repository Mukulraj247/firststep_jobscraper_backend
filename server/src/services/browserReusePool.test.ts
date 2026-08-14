import { afterEach, describe, expect, it } from 'vitest';
import { shouldBlockRequest } from './browserReusePool';

describe('shouldBlockRequest', () => {
  afterEach(() => {
    delete process.env.LOW_MEMORY_MODE;
  });

  it('never blocks the main document even when the URL contains "analytics"', () => {
    const jpmc =
      'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?keyword=data+analytics&location=United+States';
    expect(shouldBlockRequest(jpmc, 'document')).toBe(false);
  });

  it('still blocks images, fonts, and media', () => {
    expect(shouldBlockRequest('https://cdn.example.com/a.png', 'image')).toBe(true);
    expect(shouldBlockRequest('https://cdn.example.com/a.woff2', 'font')).toBe(true);
    expect(shouldBlockRequest('https://cdn.example.com/a.mp4', 'media')).toBe(true);
  });

  it('blocks known tracker hosts for scripts/xhr without matching job keywords', () => {
    expect(
      shouldBlockRequest('https://www.google-analytics.com/analytics.js', 'script')
    ).toBe(true);
    expect(shouldBlockRequest('https://connect.facebook.net/en_US/fbevents.js', 'script')).toBe(
      true
    );
    expect(
      shouldBlockRequest(
        'https://jpmc.fa.oraclecloud.com/hcmUI/api/search?keyword=data+analytics',
        'xhr'
      )
    ).toBe(false);
  });
});
