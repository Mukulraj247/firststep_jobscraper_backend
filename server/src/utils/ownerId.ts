import mongoose from 'mongoose';

/**
 * Robot.userId is Schema.Types.Mixed and historically stored as string, number,
 * or ObjectId depending on auth path. Match all common representations so
 * tenancy filters do not silently return empty lists.
 */
export function ownerIdVariants(userId: unknown): Array<string | number | mongoose.Types.ObjectId> {
  const variants: Array<string | number | mongoose.Types.ObjectId> = [];
  const seen = new Set<string>();

  const push = (value: string | number | mongoose.Types.ObjectId) => {
    const kind =
      value instanceof mongoose.Types.ObjectId
        ? 'oid'
        : typeof value === 'number'
          ? 'num'
          : 'str';
    const key = `${kind}:${String(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(value);
  };

  if (userId == null) {
    return variants;
  }

  if (typeof userId === 'number' && Number.isFinite(userId)) {
    push(userId);
    push(String(userId));
    return variants;
  }

  if (userId instanceof mongoose.Types.ObjectId) {
    push(userId);
    push(userId.toString());
    return variants;
  }

  const asString = String(
    typeof userId === 'object' && userId !== null && 'toString' in (userId as object)
      ? (userId as { toString: () => string }).toString()
      : userId
  ).trim();

  if (!asString || asString === '[object Object]') {
    return variants;
  }

  push(asString);

  const asNumber = Number(asString);
  if (!Number.isNaN(asNumber) && String(asNumber) === asString) {
    push(asNumber);
  }

  if (/^[a-fA-F0-9]{24}$/.test(asString)) {
    try {
      push(new mongoose.Types.ObjectId(asString));
    } catch {
      // ignore invalid ObjectId construction
    }
  }

  return variants;
}

/** Mongo filter fragment for robots owned by the given user. */
export function ownerIdFilter(userId: unknown): { userId: { $in: Array<string | number | mongoose.Types.ObjectId> } } | { userId: null } {
  const variants = ownerIdVariants(userId);
  if (variants.length === 0) {
    return { userId: null };
  }
  return { userId: { $in: variants } };
}

/** Prefer a stable string when writing new robots. */
export function normalizeOwnerIdForWrite(userId: unknown): string {
  if (userId == null) return '';
  if (typeof userId === 'number' && Number.isFinite(userId)) return String(userId);
  return String(
    typeof userId === 'object' && userId !== null && 'toString' in (userId as object)
      ? (userId as { toString: () => string }).toString()
      : userId
  );
}
