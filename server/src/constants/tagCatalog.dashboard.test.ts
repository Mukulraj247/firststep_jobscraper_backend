import { describe, expect, it } from 'vitest';
import {
  getJobCategoryDashboardTags,
  getRoleDashboardTags,
  JOB_CATEGORY_TAG_NAMESPACES,
} from '../constants/tagCatalog';

describe('getJobCategoryDashboardTags', () => {
  it('returns the full job-category catalog, not the old curated subset', () => {
    const tags = getJobCategoryDashboardTags();

    expect(tags.length).toBeGreaterThan(20);
    expect(tags.some((tag) => tag.tag === 'role:Data Analyst')).toBe(true);
    expect(tags.some((tag) => tag.tag === 'role:Software Engineer')).toBe(true);
    expect(tags.some((tag) => tag.tag === 'function:Engineering')).toBe(true);
    expect(tags.every((tag) => JOB_CATEGORY_TAG_NAMESPACES.includes(tag.namespace))).toBe(true);
    expect(new Set(tags.map((tag) => tag.tag)).size).toBe(tags.length);
  });
});

describe('getRoleDashboardTags', () => {
  it('returns only job title / role tags for the dashboard grid', () => {
    const tags = getRoleDashboardTags();

    expect(tags.length).toBeGreaterThan(20);
    expect(tags.every((tag) => tag.namespace === 'role')).toBe(true);
    expect(tags.some((tag) => tag.tag === 'role:Cloud Architect')).toBe(true);
    expect(tags.some((tag) => tag.tag === 'function:Engineering')).toBe(false);
  });
});
