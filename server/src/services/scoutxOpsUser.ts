import User from '../models/User';
import {
  getScoutXOpsUserId,
  extractEmailFromAuth0Payload,
  extractSubFromAuth0Payload,
} from './scoutxAuth0';

/**
 * Resolve the single ops Mongo user that owns all scrapers / job board / runs.
 * NEVER creates a new maxun_users row — a second _id would orphan all automations.
 */
export async function resolveOpsMongoUser(opts: {
  email?: string | null;
  auth0Sub?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<{ id: string; email: string; auth0Sub?: string | null } | null> {
  const opsId = getScoutXOpsUserId();
  const email =
    (opts.email && opts.email.trim().toLowerCase()) ||
    extractEmailFromAuth0Payload(opts.payload) ||
    null;
  const auth0Sub = opts.auth0Sub || extractSubFromAuth0Payload(opts.payload);

  // Prefer pinned ops owner document.
  let user = await User.findById(opsId);
  if (!user && email) {
    user = await User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') });
  }
  if (!user && auth0Sub) {
    user = await User.findOne({ auth0Sub });
  }

  if (!user) {
    return null;
  }

  // Soft-link Auth0 sub on the SAME document only (never migrate ownership).
  if (auth0Sub && !(user as any).auth0Sub) {
    try {
      (user as any).auth0Sub = auth0Sub;
      await user.save();
    } catch (err) {
      console.warn('Could not persist auth0Sub on ops user (non-fatal):', err);
    }
  }

  const id = String((user as any)._id || (user as any).id);
  if (id !== opsId) {
    // Safety: if email matched a different row somehow, refuse to use it for ops
    // and fall back to the pinned ops id lookup only.
    console.error(
      `ScoutX Auth0: email matched user ${id} but SCOUTX_OPS_USER_ID is ${opsId}. Refusing to switch ownership.`
    );
    const pinned = await User.findById(opsId);
    if (!pinned) return null;
    return {
      id: opsId,
      email: String((pinned as any).email || ''),
      auth0Sub: (pinned as any).auth0Sub || auth0Sub,
    };
  }

  return {
    id,
    email: String((user as any).email || email || ''),
    auth0Sub: (user as any).auth0Sub || auth0Sub,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
