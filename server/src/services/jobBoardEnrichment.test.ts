import { describe, expect, it } from 'vitest';
import {
  buildListSnapshot,
  contentHashFromFields,
  isListRowComplete,
  pickCanonicalJobUrl,
} from './jobBoardEnrichment';
import { jobUrlKey } from './jobUrlNormalize';

describe('jobBoardEnrichment helpers', () => {
  it('buildListSnapshot maps canonical fields', () => {
    const snap = buildListSnapshot({
      jobTitle: 'Engineer',
      companyName: 'Acme',
      jobDescription: 'x'.repeat(450),
      location: 'Remote',
      jobExperience: '3',
      benefits: ['401(k) matching'],
      seniorityLevel: 'Senior Level',
      educationRequirement: "Bachelor's degree (required)",
      visaSponsorship: 'yes',
      certifications: ['PMP'],
      companyEmployeeCount: 250,
      companyFoundedYear: 2015,
    });
    expect(snap.jobTitle).toBe('Engineer');
    expect(snap.jobExperience).toBe(3);
    expect(snap.benefits).toEqual(['401(k) matching']);
    expect(snap.seniorityLevel).toBe('Senior Level');
    expect(snap.visaSponsorship).toBe('yes');
    expect(snap.certifications).toEqual(['PMP']);
    expect(snap.companyEmployeeCount).toBe(250);
    expect(snap.companyFoundedYear).toBe(2015);
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
    expect(picked.applyUrl).toBe('https://boards.greenhouse.io/stripe/jobs/12345');
  });

  it('pickCanonicalJobUrl prefers explicit applyUrl over hiring cafe jobUrl', () => {
    const picked = pickCanonicalJobUrl({
      jobUrl: 'https://hiring.cafe/job/abc123',
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/999',
    });
    expect(picked.jobUrl).toBe('https://boards.greenhouse.io/acme/jobs/999');
    expect(picked.applyUrl).toBe('https://boards.greenhouse.io/acme/jobs/999');
  });

  it('pickCanonicalJobUrl never uses hiring cafe as board identity', () => {
    const picked = pickCanonicalJobUrl({
      jobUrl: 'https://hiringcafe.com/job/only-hc-posting',
    });
    expect(picked.jobUrl).toBeNull();
    expect(picked.applyUrl).toBeNull();
  });

  it('pickCanonicalJobUrl dedupes two Hiring Cafe rows that share one employer apply URL', () => {
    const a = pickCanonicalJobUrl({
      jobUrl: 'https://hiringcafe.com/job/posting-a',
      applyUrl:
        'https://wilhelmsen.wd3.myworkdayjobs.com/wilhelmsen/job/Chennai/Software-Engineer_JOBREQ_12579-1?utm_source=hc&utm_medium=a',
    });
    const b = pickCanonicalJobUrl({
      jobUrl: 'https://hiringcafe.com/job/posting-b',
      applyUrl:
        'https://wilhelmsen.wd3.myworkdayjobs.com/wilhelmsen/job/Chennai/Software-Engineer_JOBREQ_12579-1?utm_source=hc&utm_medium=b',
    });
    expect(a.jobUrl).toBeTruthy();
    expect(jobUrlKey(a.jobUrl)).toBe(jobUrlKey(b.jobUrl));
    expect(String(a.jobUrl)).not.toMatch(/hiringcafe/i);
  });

  it('isListRowComplete accepts hiring_cafe rows without location when description is long', () => {
    expect(
      isListRowComplete(
        {
          jobTitle: 'Engineer',
          companyName: 'Acme',
          jobDescription: 'x'.repeat(450),
          location: '',
        },
        { source: 'hiring_cafe' }
      )
    ).toBe(true);
    expect(
      isListRowComplete({
        jobTitle: 'Engineer',
        companyName: 'Acme',
        jobDescription: 'x'.repeat(450),
        location: '',
      })
    ).toBe(false);
  });
});
