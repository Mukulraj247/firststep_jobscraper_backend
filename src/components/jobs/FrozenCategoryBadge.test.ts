import { describe, expect, it } from 'vitest';
import { FROZEN_JOB_CATEGORIES } from '../../shared/frozenJobCategories';
import {
  CATEGORY_COLORS,
  MAX_VISIBLE_FROZEN_CATEGORIES,
  frozenCategoriesFromJob,
} from './FrozenCategoryBadge';

describe('frozen category badge colors', () => {
  it('gives every taxonomy category its own explicit color (no gray fallback)', () => {
    const missing = FROZEN_JOB_CATEGORIES.filter((name) => !CATEGORY_COLORS[name]);
    expect(missing).toEqual([]);
  });

  it('does not define colors for names outside the taxonomy', () => {
    const known = new Set<string>(FROZEN_JOB_CATEGORIES);
    expect(Object.keys(CATEGORY_COLORS).filter((name) => !known.has(name))).toEqual([]);
  });
});

describe('frozenCategoriesFromJob', () => {
  it('reads, trims, and caps the stored categories', () => {
    expect(
      frozenCategoriesFromJob({ frozenCategories: ['  DevOps  ', 'Data Science'] }),
    ).toEqual(['DevOps', 'Data Science']);
    expect(
      frozenCategoriesFromJob({ frozenCategories: ['A', 'B', 'C'] }),
    ).toHaveLength(MAX_VISIBLE_FROZEN_CATEGORIES);
  });

  it('drops blanks and tolerates a missing or non-array field', () => {
    expect(frozenCategoriesFromJob({ frozenCategories: ['', '   ', 'DevOps'] })).toEqual([
      'DevOps',
    ]);
    expect(frozenCategoriesFromJob({})).toEqual([]);
    expect(frozenCategoriesFromJob({ frozenCategories: 'DevOps' })).toEqual([]);
  });

  it('honors an explicit limit override', () => {
    expect(frozenCategoriesFromJob({ frozenCategories: ['A', 'B', 'C'] }, 3)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });
});
