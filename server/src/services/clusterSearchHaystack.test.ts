import { describe, expect, it } from 'vitest';
import { clusterSearchHaystack } from '../services/clusterFeed';

describe('clusterSearchHaystack', () => {
  it('matches company names in included preview and filter', () => {
    const hay = clusterSearchHaystack({
      name: 'Banking NJ',
      description: 'Finance roles',
      filtersSummary: ['Banking', 'New Jersey'],
      companyNamesPreview: ['JPMorgan Chase', 'Goldman Sachs'],
      filter: {
        frozenCategories: ['Software Engineering'],
        frozenStates: ['NJ', 'NY'],
      },
    });
    expect(hay).toContain('jpmorgan chase');
    expect(hay).toContain('software engineering');
    expect(hay).toContain('nj');
  });

  it('does not require tech-stack-only fields', () => {
    const hay = clusterSearchHaystack({
      name: 'Data Science',
      description: 'ML roles',
      filtersSummary: ['Data Science'],
      filter: { frozenCategories: ['Data Science'] },
    });
    expect(hay.includes('python')).toBe(false);
    expect(hay).toContain('data science');
  });
});
