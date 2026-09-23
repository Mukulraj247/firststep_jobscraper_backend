import { getScoutXOpsUserId } from './scoutxAuth0';
import { normalizeOwnerIdForWrite } from '../utils/ownerId';

/**
 * Portal users do not own job-board rows. All board queries are scoped to the
 * pinned ScoutX ops owner (same as the public job board).
 */
export function getPortalJobBoardOwnerId(): string {
  return normalizeOwnerIdForWrite(getScoutXOpsUserId());
}
