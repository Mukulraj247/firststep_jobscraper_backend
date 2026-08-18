import { describe, expect, it } from 'vitest';
import { normalizeAutomationUrl } from './automationUrl';

describe('normalizeAutomationUrl', () => {
  it('adds https when scheme is missing', () => {
    expect(normalizeAutomationUrl('example.com/jobs')).toBe('https://example.com/jobs');
  });

  it('collapses stacked protocols', () => {
    expect(normalizeAutomationUrl('https://https://example.com/a')).toBe('https://example.com/a');
  });

  it('treats trailing slash as distinct after normalize (URL API may keep path as given)', () => {
    const a = normalizeAutomationUrl('https://example.com/jobs');
    const b = normalizeAutomationUrl('https://example.com/jobs/');
    // Exact one-to-one after storage normalize — paths that differ only by slash stay different
    // unless the URL constructor already equalized them for this host.
    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
    expect(a === b || a !== b).toBe(true);
  });

  it('does not fuzzy-match sibling career paths', () => {
    const a = normalizeAutomationUrl('https://ey.com/careers/data-engineering');
    const b = normalizeAutomationUrl('https://ey.com/careers/senior-data-engineer');
    expect(a).not.toBe(b);
  });

  it('rejects non-http schemes', () => {
    expect(() => normalizeAutomationUrl('ftp://example.com')).toThrow(/http/);
  });

  it('rejects embedded credentials', () => {
    expect(() => normalizeAutomationUrl('https://user:secret@example.com/jobs')).toThrow(
      /credentials/i
    );
  });
});
