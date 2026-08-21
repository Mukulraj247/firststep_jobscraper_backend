import { describe, it, expect } from 'vitest';
import {
  applyLegacyJobAliases,
  buildCanonicalJobDataSync,
  CANONICAL_JOB_CREATION_TYPE,
  hasCanonicalExtractedShape,
  pickPostedDateFromRow,
} from './canonicalJobRecord';
import { baseKeyForJobId, categoryCodeFromJobTitle } from './jobIdGenerator';

describe('applyLegacyJobAliases', () => {
  it('fills canonical keys from legacy scrape keys without removing originals', () => {
    const out = applyLegacyJobAliases({
      company: 'Acme',
      title: 'Engineer',
      url: 'https://jobs.example/1',
      description: 'Do things',
    });
    expect(out.companyName).toBe('Acme');
    expect(out.jobTitle).toBe('Engineer');
    expect(out.jobUrl).toBe('https://jobs.example/1');
    expect(out.jobDescription).toBe('Do things');
    expect(out.company).toBe('Acme');
  });

  it('does not overwrite existing canonical values', () => {
    const out = applyLegacyJobAliases({
      companyName: 'KeepMe',
      company: 'Other',
    });
    expect(out.companyName).toBe('KeepMe');
  });
  it('fills location, salary, employment, and remote from legacy keys', () => {
    const out = applyLegacyJobAliases({
      city: 'Austin, TX',
      salary: '$120k–$150k',
      job_type: 'Full-time',
      remote_type: 'Hybrid',
    });
    expect(out.location).toBe('Austin, TX');
    expect(out.salaryRange).toBe('$120k–$150k');
    expect(out.employmentType).toBe('Full-time');
    expect(out.remoteType).toBe('Hybrid');
  });
});

describe('buildCanonicalJobDataSync', () => {
  const created = new Date('2026-02-05T12:00:00.000Z');

  it('sets insertDefaults status to pending regardless of stray data.status', () => {
    const row = buildCanonicalJobDataSync(
      { jobTitle: 'X', status: 'active' } as Record<string, unknown>,
      { createdAt: created, jobId: 'AB01FE001', insertDefaults: true }
    );
    expect(row.status).toBe('pending');
  });

  it('preserves non-pending status when insertDefaults is false', () => {
    const row = buildCanonicalJobDataSync(
      { jobTitle: 'X', status: 'active', jobUrl: 'https://x' } as Record<string, unknown>,
      { createdAt: created, jobId: 'AB01FE002', insertDefaults: false }
    );
    expect(row.status).toBe('active');
  });

  it('defaults string fields to empty and jobExperience to 0', () => {
    const row = buildCanonicalJobDataSync({}, { createdAt: created, jobId: 'XX01FE003', insertDefaults: true });
    expect(row.jobUrl).toBe('');
    expect(row.jobTitle).toBe('');
    expect(row.jobExperience).toBe(0);
    expect(row.isFlagged).toBe(false);
    expect(row.location).toBe('');
    expect(row.salaryRange).toBe('');
    expect(row.employmentType).toBe('');
    expect(row.remoteType).toBe('');
    expect(row.job_creation_type).toBe(CANONICAL_JOB_CREATION_TYPE);
  });

  it('persists location and salaryRange when present', () => {
    const row = buildCanonicalJobDataSync(
      {
        jobTitle: 'SDE',
        location: 'Remote',
        salary: '$180k',
        employment_type: 'Full-time',
        remote_type: 'Remote',
      } as Record<string, unknown>,
      { createdAt: created, jobId: 'SE01FE004', insertDefaults: true }
    );
    expect(row.location).toBe('Remote');
    expect(row.salaryRange).toBe('$180k');
    expect(row.employmentType).toBe('Full-time');
    expect(row.remoteType).toBe('Remote');
  });

  it('persists description sections and HC-rich fields', () => {
    const row = buildCanonicalJobDataSync(
      {
        jobTitle: 'Engineer',
        about: 'We build things',
        responsibilities: ['Ship features', 'Mentor juniors', 'Own on-call'],
        minimumQualifications: ['5+ years', "Bachelor's degree"],
        preferredQualifications: ["Master's preferred"],
        benefits: ['401(k) matching', 'Visa sponsorship'],
        skills: ['Go', 'AWS'],
        certifications: ['AWS SAP'],
        seniorityLevel: 'Senior Level',
        roleType: 'Individual Contributor',
        educationRequirement: "Bachelor's degree (required)",
        visaSponsorship: 'yes',
        companyEmployeeCount: 500,
        companyFoundedYear: 2012,
      } as Record<string, unknown>,
      { createdAt: created, jobId: 'AB01FE005', insertDefaults: true }
    );
    expect(row.about).toBe('We build things');
    expect(row.responsibilities).toEqual(['Ship features', 'Mentor juniors', 'Own on-call']);
    expect(row.minimumQualifications).toEqual(['5+ years', "Bachelor's degree"]);
    expect(row.preferredQualifications).toEqual(["Master's preferred"]);
    expect(row.benefits).toEqual(['401(k) matching', 'Visa sponsorship']);
    expect(row.skills).toEqual(['Go', 'AWS']);
    expect(row.certifications).toEqual(['AWS SAP']);
    expect(row.seniorityLevel).toBe('Senior Level');
    expect(row.roleType).toBe('Individual Contributor');
    expect(row.educationRequirement).toBe("Bachelor's degree (required)");
    expect(row.visaSponsorship).toBe('yes');
    expect(row.companyEmployeeCount).toBe(500);
    expect(row.companyFoundedYear).toBe(2012);
  });
});

describe('hasCanonicalExtractedShape', () => {
  it('returns true only when jobId, status, and job_creation_type are present', () => {
    expect(
      hasCanonicalExtractedShape({
        jobId: 'SA16DE452',
        status: 'pending',
        job_creation_type: CANONICAL_JOB_CREATION_TYPE,
      })
    ).toBe(true);
    expect(
      hasCanonicalExtractedShape({ jobId: '', status: 'pending', job_creation_type: CANONICAL_JOB_CREATION_TYPE })
    ).toBe(false);
    expect(hasCanonicalExtractedShape({ jobId: 'X', status: 'pending', job_creation_type: 'job_collector' })).toBe(
      false
    );
    expect(hasCanonicalExtractedShape({ jobId: 'X', status: 'pending' })).toBe(false);
    expect(hasCanonicalExtractedShape({ company: 'x' })).toBe(false);
  });
});

describe('pickPostedDateFromRow', () => {
  it('uses posted fields when parseable', () => {
    const d = pickPostedDateFromRow({ datePosted: '2025-01-02' }, new Date('2026-02-05T12:00:00.000Z'));
    expect(d.toISOString().slice(0, 10)).toBe('2025-01-02');
  });

  it('falls back to createdAt when posted date is in the future', () => {
    const created = new Date('2026-08-10T08:00:00.000Z');
    const now = new Date('2026-08-18T12:00:00.000Z');
    const d = pickPostedDateFromRow({ date: '2026-12-01T00:00:00.000Z' }, created, now.getTime());
    expect(d.toISOString()).toBe(created.toISOString());
  });
});

describe('jobIdGenerator helpers', () => {
  it('categoryCodeFromJobTitle uses first letters of first two words', () => {
    expect(categoryCodeFromJobTitle('Software Engineer III')).toBe('SE');
  });

  it('baseKeyForJobId matches CC + DD + month code', () => {
    expect(baseKeyForJobId('Software Engineer', new Date('2026-12-16T00:00:00.000Z'))).toBe('SE16DE');
  });
});
