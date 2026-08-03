import { describe, expect, it } from 'vitest';
import { normalizeUrl, isValidHttpUrl } from './url';

describe('normalizeUrl', () => {
  it('adds https when scheme missing', () => {
    expect(normalizeUrl('careers.example.com/jobs')).toBe('https://careers.example.com/jobs');
  });
  it('preserves https', () => {
    expect(normalizeUrl('https://x.com')).toBe('https://x.com');
  });
});

describe('isValidHttpUrl', () => {
  it('accepts http(s)', () => {
    expect(isValidHttpUrl('https://example.com')).toBe(true);
    expect(isValidHttpUrl('not a url')).toBe(false);
  });
});
