import { describe, expect, it } from 'vitest';
import {
  buildFieldMap,
  encodeFieldSelectorForBackend,
} from '../../../chrome-extension/src/background/fieldMapEncoding';

describe('encodeFieldSelectorForBackend', () => {
  it('encodes fromSchema literals as value@fixed', () => {
    expect(encodeFieldSelectorForBackend('Acme Corp', 'innerText', true)).toBe('Acme Corp@fixed');
  });

  it('encodes attribute=fixed as value@fixed', () => {
    expect(encodeFieldSelectorForBackend('Seattle, WA', 'fixed')).toBe('Seattle, WA@fixed');
  });

  it('keeps CSS selectors with attribute suffixes', () => {
    expect(encodeFieldSelectorForBackend('a.job-link', 'href')).toBe('a.job-link@href');
    expect(encodeFieldSelectorForBackend('h2.title', 'innerText')).toBe('h2.title');
  });
});

describe('buildFieldMap', () => {
  it('saves schema fields as @fixed and skips CSS variants', () => {
    const map = buildFieldMap({
      f1: {
        selector: 'Staff Engineer',
        attribute: 'innerText',
        fromSchema: true,
        semanticType: 'title',
        fallbackSelectors: ['h2.fake'],
      },
      f2: {
        selector: 'a.job-title',
        attribute: 'innerText',
        semanticType: 'title',
        fallbackSelectors: ['h2.title'],
      },
    });
    // Schema + DOM title merge under semantic key "title"
    const title = map.title;
    expect(title).toBeDefined();
    const ranked = Array.isArray(title) ? title : [title];
    expect(ranked).toContain('Staff Engineer@fixed');
    expect(ranked.some((s) => s === 'a.job-title' || s.startsWith('a.job-title'))).toBe(true);
    // Schema entry must not sprout CSS variants from the literal text
    expect(ranked.every((s) => !s.includes('Staff Engineer.') || s.endsWith('@fixed'))).toBe(true);
  });

  it('leaves pure CSS fields unchanged (with optional variants)', () => {
    const map = buildFieldMap({
      company: {
        selector: 'span.company-name',
        attribute: 'innerText',
        semanticType: 'company',
      },
    });
    expect(map.company).toBe('span.company-name');
  });

  it('encodes attribute=fixed without fromSchema', () => {
    const map = buildFieldMap({
      loc: {
        selector: 'Remote',
        attribute: 'fixed',
        label: 'location',
      },
    });
    expect(map.location).toBe('Remote@fixed');
  });
});
