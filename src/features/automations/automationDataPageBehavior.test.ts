import { describe, expect, it } from 'vitest';
import { buildRunDetailColumns } from './automationDataPageBehavior';

describe('buildRunDetailColumns', () => {
  it('orders key job fields first and drops empty columns', () => {
    const columns = buildRunDetailColumns([
      {
        data: {
          about: '',
          applyUrl: 'https://boards.greenhouse.io/acme/jobs/1',
          jobTitle: 'Engineer',
          companyName: 'Acme',
          zzzField: 'last',
        },
      },
    ]);
    expect(columns[0]).toBe('jobTitle');
    expect(columns).toContain('applyUrl');
    expect(columns).not.toContain('about');
    expect(columns[columns.length - 1]).toBe('zzzField');
  });

  it('keyColumnsOnly hides long-tail fields', () => {
    const columns = buildRunDetailColumns(
      [
        {
          data: {
            jobTitle: 'Engineer',
            benefits: ['401k'],
            about: 'Long text',
          },
        },
      ],
      { keyColumnsOnly: true }
    );
    expect(columns).toEqual(['jobTitle']);
  });
});
