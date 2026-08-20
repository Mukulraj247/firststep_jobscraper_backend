import { describe, expect, it } from 'vitest';
import { normalizeEmailList } from './digestRecipients';

describe('normalizeEmailList', () => {
  it('accepts arrays and comma-separated strings', () => {
    expect(normalizeEmailList(['a@x.com', 'b@y.com'])).toEqual(['a@x.com', 'b@y.com']);
    expect(normalizeEmailList('a@x.com, b@y.com;c@z.com')).toEqual([
      'a@x.com',
      'b@y.com',
      'c@z.com',
    ]);
  });

  it('dedupes case-insensitively and drops invalid', () => {
    expect(normalizeEmailList(['Ops@Example.com', 'ops@example.com', 'nope'])).toEqual([
      'Ops@Example.com',
    ]);
  });
});
