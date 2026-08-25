import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { jobUrlHost, jobUrlKey, normalizeJobUrl } from './jobUrlNormalize';

describe('normalizeJobUrl', () => {
  it('lowercases host and strips www', () => {
    expect(normalizeJobUrl('HTTPS://WWW.Example.COM/jobs/1')).toBe('https://example.com/jobs/1');
  });

  it('strips tracking params and sorts remaining query keys', () => {
    expect(
      normalizeJobUrl('https://example.com/jobs/1?b=2&utm_source=x&a=1&fbclid=zzz')
    ).toBe('https://example.com/jobs/1?a=1&b=2');
  });

  it('strips listing noise params like page/hl/q/location', () => {
    expect(
      normalizeJobUrl('https://example.com/jobs/1?page=3&hl=en-GB&q=Engineer&a=1')
    ).toBe('https://example.com/jobs/1?a=1');
  });

  it('collapses Google Careers list pagination variants to the same path', () => {
    const a =
      'https://www.google.com/about/careers/applications/jobs/results/114533168161137350-staff-software-engineer-full-stack-google-one?hl=en-GB&location=United+States&page=5&q=Software+Engineer';
    const b =
      'https://google.com/about/careers/applications/jobs/results/114533168161137350-staff-software-engineer-full-stack-google-one?hl=en-GB&location=United+States&page=4&q=Software+Engineer';
    expect(normalizeJobUrl(a)).toBe(
      'https://google.com/about/careers/applications/jobs/results/114533168161137350-staff-software-engineer-full-stack-google-one'
    );
    expect(normalizeJobUrl(a)).toBe(normalizeJobUrl(b));
    expect(jobUrlKey(a)).toBe(jobUrlKey(b));
  });

  it('strips trailing slash except root', () => {
    expect(normalizeJobUrl('https://example.com/jobs/1/')).toBe('https://example.com/jobs/1');
    expect(normalizeJobUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('drops hash fragments', () => {
    expect(normalizeJobUrl('https://example.com/jobs/1#section')).toBe('https://example.com/jobs/1');
  });

  it('returns null for non-http schemes and empty input', () => {
    expect(normalizeJobUrl('ftp://example.com/a')).toBeNull();
    expect(normalizeJobUrl('')).toBeNull();
    expect(normalizeJobUrl(null)).toBeNull();
  });

  it('forces www for Ford careers job URLs', () => {
    const apex =
      'https://careers.ford.com/job/brook-park/manager-hr-business-partners/48560/98473354336';
    const www =
      'https://www.careers.ford.com/job/brook-park/manager-hr-business-partners/48560/98473354336';
    expect(normalizeJobUrl(apex)).toBe(www);
    expect(normalizeJobUrl(www)).toBe(www);
    expect(jobUrlKey(apex)).toBe(jobUrlKey(www));
    expect(jobUrlHost(apex)).toBe('careers.ford.com');
  });

  it('canonicalizes Qualcomm and NVIDIA Phenom list URLs onto /careers/job/{id}', () => {
    const qcomList =
      'https://careers.qualcomm.com/careers?start=0&location=united+states&pid=446717433364&sort_by=timestamp&filter_include_remote=0&filter_job_family=software+engineering';
    expect(normalizeJobUrl(qcomList)).toBe(
      'https://careers.qualcomm.com/careers/job/446717433364'
    );
    expect(normalizeJobUrl('https://careers.qualcomm.com/careers/job/446717433364')).toBe(
      'https://careers.qualcomm.com/careers/job/446717433364'
    );
    expect(
      normalizeJobUrl(
        'https://jobs.nvidia.com/careers?start=0&location=united+states&pid=893394926415&sort_by=timestamp'
      )
    ).toBe('https://jobs.nvidia.com/careers/job/893394926415');
  });
});

describe('jobUrlKey', () => {
  it('is stable for equivalent URLs', () => {
    const a = jobUrlKey('https://www.Example.com/jobs/1?utm_source=x');
    const b = jobUrlKey('https://example.com/jobs/1/');
    expect(a).toBe(b);
    expect(a).toBe(createHash('sha256').update('https://example.com/jobs/1').digest('hex'));
  });

  it('differs for different paths', () => {
    expect(jobUrlKey('https://example.com/jobs/1')).not.toBe(jobUrlKey('https://example.com/jobs/2'));
  });
});

describe('jobUrlHost', () => {
  it('returns hostname without www', () => {
    expect(jobUrlHost('https://www.careers.example.com/job/1')).toBe('careers.example.com');
  });
});
