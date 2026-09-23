import { describe, expect, it } from 'vitest';
import { mapScoutXCategoryToFirstStep } from './firstStepSubscription';

describe('mapScoutXCategoryToFirstStep', () => {
  it('returns exact First Step categories unchanged', () => {
    expect(mapScoutXCategoryToFirstStep({ jobCategory: 'QA' })).toBe('QA');
    expect(mapScoutXCategoryToFirstStep({ jobCategory: 'Health Care' })).toBe('Health Care');
    expect(mapScoutXCategoryToFirstStep({ jobCategory: 'Service Now' })).toBe('Service Now');
  });

  it('maps legacy Others to Other 1', () => {
    expect(mapScoutXCategoryToFirstStep({ jobCategory: 'Others' })).toBe('Other 1');
  });

  it('infers from title / frozen categories', () => {
    expect(
      mapScoutXCategoryToFirstStep({
        title: 'Senior Software Engineer',
        frozenCategories: ['Software Engineering'],
      }),
    ).toBe('Software Developer');
    expect(mapScoutXCategoryToFirstStep({ title: 'QA Automation Engineer' })).toBe('QA');
    expect(mapScoutXCategoryToFirstStep({ title: 'SAP Consultant' })).toBe('SAP');
  });

  it('never returns a category outside the deployed dropdown', () => {
    const allowed = new Set([
      'Full Stack Developer',
      'Software Developer',
      'Data Scientist',
      'Data Analyst',
      'Data Engineer',
      'Network Security Engineer',
      'Application Security Engineer',
      'Cloud Security Engineer',
      'Cyber Security Analyst',
      'DevOps Engineer',
      'Product Management',
      'Mechanical Engineer',
      'Business Analyst',
      'AI ML Engineer',
      'Salesforce Developer',
      'QA',
      'Health Care',
      'SAP',
      'Electrical',
      'Service Now',
      'Finance',
      'Other 1',
      'Other 2',
      'Other 3',
      'Other 4',
      'Other 5',
    ]);
    const result = mapScoutXCategoryToFirstStep({
      title: 'Chief Happiness Officer',
      frozenCategories: ['Unknown Role'],
    });
    expect(allowed.has(result)).toBe(true);
    expect(result).toBe('Other 1');
  });
});
