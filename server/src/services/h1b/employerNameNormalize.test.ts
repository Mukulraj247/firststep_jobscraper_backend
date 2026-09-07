import { describe, expect, it } from 'vitest';
import {
  employerNameNormalize,
  levenshteinRatio,
  tokenJaccard,
} from './employerNameNormalize';

describe('employerNameNormalize', () => {
  it('strips legal suffixes and punctuation', () => {
    const n = employerNameNormalize('AMAZON.COM SERVICES LLC');
    expect(n.key).toBe('amazoncomservices');
    expect(n.normalized).toContain('amazon');
    expect(n.tokens).toContain('amazon');
  });

  it('strips Inc / Corporation', () => {
    const n = employerNameNormalize('META PLATFORMS, INC.');
    expect(n.key).toBe('metaplatforms');
    expect(n.tokens).toContain('meta');
    expect(n.tokens).toContain('platforms');
  });

  it('strips leading THE', () => {
    const n = employerNameNormalize('The Walt Disney Company');
    expect(n.normalized.startsWith('the ')).toBe(false);
    expect(n.tokens).toContain('walt');
  });

  it('handles empty', () => {
    expect(employerNameNormalize('').key).toBe('');
  });
});

describe('tokenJaccard', () => {
  it('scores overlapping tokens', () => {
    expect(tokenJaccard(['google', 'llc'], ['google'])).toBeGreaterThan(0.4);
    expect(tokenJaccard(['oracle'], ['wave'])).toBe(0);
  });
});

describe('levenshteinRatio', () => {
  it('is high for near matches', () => {
    expect(levenshteinRatio('jpmorganchase', 'jpmorgan')).toBeGreaterThan(0.6);
    expect(levenshteinRatio('abc', 'xyz')).toBeLessThan(0.3);
  });
});
