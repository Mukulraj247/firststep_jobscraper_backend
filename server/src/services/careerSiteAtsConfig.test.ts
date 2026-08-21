import { describe, expect, it } from 'vitest';
import { detectAtsBoard, looksLikePhenomBoard } from './atsAdapters';
import { normalizeAutomationUrl } from '../utils/automationUrl';

describe('ATS check preserves exact start URL', () => {
  it('does not rewrite Bank of America URLs on save', () => {
    const filtered =
      'https://careers.bankofamerica.com/en-us/job-search?searchstring=United+States&keywords=data';
    expect(normalizeAutomationUrl(filtered)).toBe(filtered);
  });

  it('detects ATS on the exact filtered URL without changing it', () => {
    const filtered =
      'https://careers.bankofamerica.com/en-us/job-search?searchstring=United+States&keywords=data';
    expect(detectAtsBoard(filtered)?.provider).toBe('bankofamerica');
  });

  it('detects Phenom on the exact search-results URL (filters stay on that URL)', () => {
    const url =
      'https://jobs.thecignagroup.com/us/en/search-results?keywords=engineer&location=United%20States';
    expect(looksLikePhenomBoard(url)).toBe(true);
    expect(detectAtsBoard(url)?.provider).toBe('phenom');
  });
});
