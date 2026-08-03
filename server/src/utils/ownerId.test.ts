import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { ownerIdFilter, ownerIdVariants, normalizeOwnerIdForWrite } from './ownerId';

describe('ownerId helpers', () => {
  it('includes string and numeric variants for numeric-looking ids', () => {
    const variants = ownerIdVariants('42');
    expect(variants).toEqual(expect.arrayContaining(['42', 42]));
  });

  it('includes ObjectId when the id is a valid 24-hex string', () => {
    const id = new mongoose.Types.ObjectId().toString();
    const variants = ownerIdVariants(id);
    expect(variants.some((v) => String(v) === id)).toBe(true);
    expect(variants.some((v) => v instanceof mongoose.Types.ObjectId)).toBe(true);
  });

  it('builds an $in filter for ownership queries', () => {
    const filter = ownerIdFilter('abc');
    expect(filter).toEqual({ userId: { $in: ['abc'] } });
  });

  it('normalizes write ids to strings', () => {
    expect(normalizeOwnerIdForWrite(99)).toBe('99');
    expect(normalizeOwnerIdForWrite('user-1')).toBe('user-1');
  });
});
