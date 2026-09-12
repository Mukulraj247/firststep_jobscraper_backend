import PortalUser, { FirstStepPlanSnapshot } from '../models/PortalUser';
import type { ScoutXRole } from './scoutxAuth0';

export async function upsertPortalUser(opts: {
  auth0Sub: string;
  email: string;
  name?: string | null;
  scoutxRoles: ScoutXRole[];
  firstStepRole?: string | null;
  firstStepPlan?: FirstStepPlanSnapshot | null;
}) {
  const update: Record<string, unknown> = {
    email: opts.email.toLowerCase(),
    name: opts.name || null,
    scoutxRoles: opts.scoutxRoles,
    firstStepRole: opts.firstStepRole || null,
  };
  if (opts.firstStepPlan) {
    update.firstStepPlan = opts.firstStepPlan;
  }

  return PortalUser.findOneAndUpdate(
    { auth0Sub: opts.auth0Sub },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
