import { describe, expect, it } from 'vitest';
import {
  HIRING_CAFE_ENRICHMENT_EXHAUSTED,
  HIRING_CAFE_ENRICHMENT_MAX_ATTEMPTS,
  hiringCafeEnrichmentBackoffMs,
  isHiringCafeBoardReady,
  isSkillsDumpDescription,
  shouldRequeueHiringCafeAfterAttempt,
} from './hiringCafeEnrichmentPolicy';

describe('isSkillsDumpDescription', () => {
  it('rejects comma-separated skill lists without JD prose', () => {
    const dump =
      'MagicDraw, Cameo Systems Modeler, Teamwork Cloud Server, Java, Spring Boot, Python, VS Code IDE, JavaScript, React, Angular, Node.js, Tekton pipelines, Jenkins, OpenShift, Google Cloud Platform (GCP), Terraform, Github Actions, Docker, Pandas, NumPy, TensorFlow, Cloud Run, Compute Engine, Cloud Storage, Firestore, HTML, CSS, 42Crunch, FOSSA, Cycode, SonarQube, Git, JIRA, Kubernetes, SQL, NoSQL, VIATRA';
    expect(isSkillsDumpDescription(dump)).toBe(true);
  });

  it('keeps real job description prose', () => {
    const jd = [
      'We are looking for a Senior Full Stack Developer to join our platform team.',
      'Responsibilities include building APIs with Spring Boot and React frontends.',
      'Requirements: 5+ years of experience with Java and cloud deployments on GCP.',
      'You will collaborate with product and design on roadmap delivery.',
    ].join(' ');
    expect(isSkillsDumpDescription(jd)).toBe(false);
  });
});

describe('isHiringCafeBoardReady', () => {
  const realJd = [
    'We are looking for a Senior Full Stack Developer to join our platform team.',
    'Responsibilities include building APIs with Spring Boot and React frontends.',
    'Requirements: 5+ years of experience with Java and cloud deployments on GCP.',
    'You will collaborate with product and design on roadmap delivery.',
  ].join(' ');

  it('requires real employer apply URL', () => {
    expect(
      isHiringCafeBoardReady({
        title: 'Sr. Full Stack Developer',
        companyName: 'Acme',
        description: realJd,
        applyUrl: 'https://hiring.cafe/job/sr-full-stack-developer',
        jobUrl: 'https://hiring.cafe/job/sr-full-stack-developer',
      })
    ).toBe(false);

    expect(
      isHiringCafeBoardReady({
        title: 'Sr. Full Stack Developer',
        companyName: 'Acme',
        description: realJd,
        applyUrl: 'https://boards.greenhouse.io/acme/jobs/123',
        jobUrl: 'https://hiring.cafe/job/sr-full-stack-developer',
      })
    ).toBe(true);
  });

  it('rejects skills-dump description even with apply URL', () => {
    const dump =
      'MagicDraw, Cameo Systems Modeler, Java, Spring Boot, Python, React, Angular, Node.js, Docker, Kubernetes, SQL, NoSQL, Terraform, Jenkins';
    expect(
      isHiringCafeBoardReady({
        title: 'Sr. Full Stack Developer',
        companyName: 'Acme',
        description: dump,
        applyUrl: 'https://boards.greenhouse.io/acme/jobs/123',
        jobUrl: 'https://hiring.cafe/job/sr-full-stack-developer',
      })
    ).toBe(false);
  });
});

describe('hiringCafeEnrichmentBackoffMs', () => {
  it('uses stepped backoff then ~24h, never more than 10 attempts', () => {
    expect(HIRING_CAFE_ENRICHMENT_MAX_ATTEMPTS).toBe(10);
    expect(hiringCafeEnrichmentBackoffMs(1)).toBe(15 * 60_000);
    expect(hiringCafeEnrichmentBackoffMs(2)).toBe(60 * 60_000);
    expect(hiringCafeEnrichmentBackoffMs(3)).toBe(3 * 60 * 60_000);
    expect(hiringCafeEnrichmentBackoffMs(4)).toBe(6 * 60 * 60_000);
    expect(hiringCafeEnrichmentBackoffMs(5)).toBe(12 * 60 * 60_000);
    expect(hiringCafeEnrichmentBackoffMs(6)).toBe(24 * 60 * 60_000);
    expect(hiringCafeEnrichmentBackoffMs(10)).toBe(24 * 60 * 60_000);
  });
});

describe('shouldRequeueHiringCafeAfterAttempt', () => {
  it('requeues while under max attempts, exhausts at 10', () => {
    expect(shouldRequeueHiringCafeAfterAttempt(1)).toBe(true);
    expect(shouldRequeueHiringCafeAfterAttempt(9)).toBe(true);
    expect(shouldRequeueHiringCafeAfterAttempt(10)).toBe(false);
    expect(HIRING_CAFE_ENRICHMENT_EXHAUSTED).toBe('hiring_cafe_enrichment_exhausted');
  });
});
