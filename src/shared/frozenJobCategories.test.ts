import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  FROZEN_JOB_CATEGORIES,
  MAX_FROZEN_CATEGORY_FILTERS,
  canonicalFrozenCategory,
  normalizeFrozenCategoryFilter,
} from './frozenJobCategories';

describe('frozen job category taxonomy', () => {
  it('holds the frozen 30 categories with no duplicates', () => {
    expect(FROZEN_JOB_CATEGORIES).toHaveLength(30);
    expect(new Set(FROZEN_JOB_CATEGORIES).size).toBe(30);
  });

  it('matches the tagger sidecar taxonomy in audit.py', () => {
    const auditPath = path.resolve(
      process.cwd(),
      'job-tagger/backend/classifier/audit.py',
    );
    if (!fs.existsSync(auditPath)) {
      // job-tagger is an optional sidecar; skip rather than fail a partial checkout.
      return;
    }
    const source = fs.readFileSync(auditPath, 'utf8');
    const block = source.match(/FROZEN_CATEGORIES[^=]*=\s*\(([\s\S]*?)\)/);
    expect(block, 'FROZEN_CATEGORIES tuple not found in audit.py').toBeTruthy();
    const pythonNames = [...(block![1].matchAll(/"([^"]+)"/g))].map((m) => m[1]);
    expect(pythonNames).toEqual([...FROZEN_JOB_CATEGORIES]);
  });

  it('canonicalizes case and slash spacing', () => {
    expect(canonicalFrozenCategory('backend development')).toBe('Backend Development');
    expect(canonicalFrozenCategory('  DEVOPS ')).toBe('DevOps');
    expect(canonicalFrozenCategory('qa/testing')).toBe('QA / Testing');
    expect(canonicalFrozenCategory('QA  /  Testing')).toBe('QA / Testing');
    expect(canonicalFrozenCategory('ui / ux design')).toBe('UI/UX Design');
    expect(canonicalFrozenCategory('blockchain/web3')).toBe('Blockchain / Web3');
  });

  it('rejects names outside the taxonomy', () => {
    expect(canonicalFrozenCategory('Underwater Welding')).toBeNull();
    expect(canonicalFrozenCategory('')).toBeNull();
  });
});

describe('normalizeFrozenCategoryFilter', () => {
  it('parses comma-separated values and repeated params alike', () => {
    expect(normalizeFrozenCategoryFilter('DevOps,Data Science')).toEqual([
      'DevOps',
      'Data Science',
    ]);
    expect(normalizeFrozenCategoryFilter(['DevOps', 'Data Science'])).toEqual([
      'DevOps',
      'Data Science',
    ]);
    expect(normalizeFrozenCategoryFilter(['DevOps,AI Engineer', 'Data Science'])).toEqual([
      'DevOps',
      'Data Science',
      'AI Engineer',
    ]);
  });

  it('returns taxonomy order so the count cache key is stable regardless of input order', () => {
    const forward = normalizeFrozenCategoryFilter('DevOps,Backend Development');
    const reversed = normalizeFrozenCategoryFilter('Backend Development,DevOps');
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(['Backend Development', 'DevOps']);
  });

  it('drops unknown, blank, and duplicate entries', () => {
    expect(normalizeFrozenCategoryFilter('DevOps,,Not A Category,devops')).toEqual(['DevOps']);
    expect(normalizeFrozenCategoryFilter('')).toEqual([]);
    expect(normalizeFrozenCategoryFilter(undefined)).toEqual([]);
    expect(normalizeFrozenCategoryFilter(null)).toEqual([]);
  });

  it('caps the selection so the $in list cannot grow unbounded', () => {
    const all = normalizeFrozenCategoryFilter(FROZEN_JOB_CATEGORIES.join(','));
    expect(all).toHaveLength(MAX_FROZEN_CATEGORY_FILTERS);
  });
});
