import { describe, expect, it } from 'vitest';
import { boardMatch } from './jobs';

describe('boardMatch', () => {
  it('uses index-friendly owner/status/method filters without $expr strLenCP', () => {
    const match = boardMatch('owner-1');
    expect(match.ownerId).toBe('owner-1');
    expect(match.status).toBe('ready');
    expect(match['enrichment.method']).toEqual({
      $in: ['ats', 'scrape.do', 'browser', 'list', 'llm'],
    });
    const serialized = JSON.stringify(match);
    expect(serialized).not.toContain('$expr');
    expect(serialized).not.toContain('$strLenCP');
  });
});
