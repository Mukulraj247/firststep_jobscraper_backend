import { describe, expect, it } from 'vitest';
import { fixGoogleCareersJobsUrl } from './googleCareersUrl';

describe('fixGoogleCareersJobsUrl', () => {
  it('collapses duplicate /jobs/jobs/results/ to /jobs/results/', () => {
    const bad =
      'https://www.google.com/about/careers/applications/jobs/jobs/results/109239242911032006-senior-software-engineer-aiml-infrastructure?q=ml';
    const fixed = fixGoogleCareersJobsUrl(bad);
    expect(fixed).toBe(
      'https://www.google.com/about/careers/applications/jobs/results/109239242911032006-senior-software-engineer-aiml-infrastructure?q=ml'
    );
  });

  it('collapses /jobs/results/jobs/results/ from trailing-slash base join', () => {
    const bad =
      'https://www.google.com/about/careers/applications/jobs/results/jobs/results/109239242911032006-senior-software-engineer-aiml-infrastructure?q=ml';
    const fixed = fixGoogleCareersJobsUrl(bad);
    expect(fixed).toBe(
      'https://www.google.com/about/careers/applications/jobs/results/109239242911032006-senior-software-engineer-aiml-infrastructure?q=ml'
    );
  });

  it('leaves correct URLs unchanged', () => {
    const ok =
      'https://www.google.com/about/careers/applications/jobs/results/122072975632409286-senior-asic-power-delivery-engineer?q=Senior%20ASIC';
    expect(fixGoogleCareersJobsUrl(ok)).toBe(ok);
  });

  it('ignores non-Google hosts', () => {
    const u = 'https://example.com/about/careers/applications/jobs/jobs/results/foo';
    expect(fixGoogleCareersJobsUrl(u)).toBe(u);
  });
});
