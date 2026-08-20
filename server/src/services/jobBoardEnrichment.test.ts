import { describe, expect, it } from 'vitest';
import {
  buildListSnapshot,
  contentHashFromFields,
  isListRowComplete,
  pickCanonicalJobUrl,
} from './jobBoardEnrichment';

describe('jobBoardEnrichment helpers', () => {
  it('buildListSnapshot maps canonical fields', () => {
    const snap = buildListSnapshot({
      jobTitle: 'Engineer',
      companyName: 'Acme',
      jobDescription: 'x'.repeat(450),
      location: 'Remote',
      jobExperience: '3',
    });
    expect(snap.jobTitle).toBe('Engineer');
    expect(snap.jobExperience).toBe(3);
    expect(isListRowComplete(snap)).toBe(true);
  });

  it('isListRowComplete rejects short descriptions', () => {
    expect(
      isListRowComplete({
        jobTitle: 'A',
        companyName: 'B',
        location: 'C',
        jobDescription: 'short',
      })
    ).toBe(false);
  });

  it('contentHashFromFields is stable', () => {
    const a = contentHashFromFields({ jobTitle: 'T', companyName: 'C', jobDescription: 'D' });
    const b = contentHashFromFields({ jobTitle: 'T', companyName: 'C', jobDescription: 'D' });
    const c = contentHashFromFields({ jobTitle: 'T', companyName: 'C', jobDescription: 'E' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('pickCanonicalJobUrl prefers an ATS apply URL over an aggregator URL', () => {
    const picked = pickCanonicalJobUrl({
      jobUrl: 'https://jobs.example.com/posting/abc?utm_source=x',
      applyUrl: 'https://boards.greenhouse.io/stripe/jobs/12345',
    });
    expect(picked.jobUrl).toBe('https://boards.greenhouse.io/stripe/jobs/12345');
    expect(picked.applyUrl).toBe('https://jobs.example.com/posting/abc');
  });
});
