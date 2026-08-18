import { describe, expect, it } from 'vitest';
import { nextTrackedRunStatus, shouldRefreshRunDetails } from './runDetailsPolling';

describe('shouldRefreshRunDetails', () => {
  it('refreshes rows and logs when an active run becomes terminal', () => {
    expect(shouldRefreshRunDetails('running', 'completed')).toBe(true);
    expect(shouldRefreshRunDetails('queued', 'failed')).toBe(true);
  });

  it('does not refresh details for active-to-active or terminal-to-terminal updates', () => {
    expect(shouldRefreshRunDetails('queued', 'running')).toBe(false);
    expect(shouldRefreshRunDetails('completed', 'completed')).toBe(false);
  });

  it('keeps the prior active status when a poll fails', () => {
    const statusAfterFailure = nextTrackedRunStatus('running', null);
    expect(statusAfterFailure).toBe('running');
    expect(shouldRefreshRunDetails(statusAfterFailure, 'completed')).toBe(true);
  });
});
