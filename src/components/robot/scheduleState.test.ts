import { describe, expect, it } from 'vitest';
import {
  buildScheduleSavePayload,
  closedScheduleModalState,
  deriveScheduleModalState,
} from './ScheduleModal';
import {
  applyCronBuilderExternalProps,
  shouldNotifyCronBuilderChange,
  type CronBuilderValue,
} from './CronBuilder';

describe('ScheduleModal scheduling state', () => {
  it('opens a paused schedule as paused with its cron preserved', () => {
    expect(deriveScheduleModalState({
      currentCron: '*/30 * * * *',
      currentTimezone: 'America/New_York',
      currentEnabled: false,
      currentPaused: true,
    })).toEqual({
      mode: 'paused',
      cronValue: {
        cron: '*/30 * * * *',
        timezone: 'America/New_York',
      },
    });
  });

  it('saves an unchanged paused schedule without resuming it', () => {
    const initialState = deriveScheduleModalState({
      currentCron: '0 */2 * * *',
      currentTimezone: 'UTC',
      currentEnabled: false,
      currentPaused: true,
    });

    expect(buildScheduleSavePayload(initialState, 'UTC')).toEqual({
      enabled: false,
      cron: '0 */2 * * *',
      timezone: 'UTC',
    });
  });

  it('distinguishes disabled schedules from paused schedules', () => {
    expect(deriveScheduleModalState({
      currentCron: null,
      currentEnabled: false,
    }).mode).toBe('disabled');
    expect(deriveScheduleModalState({
      currentCron: '0 9 * * 1-5',
      currentEnabled: false,
    }).mode).toBe('paused');
  });

  it('clears leftover schedule state when the modal closes', () => {
    expect(closedScheduleModalState()).toEqual({
      mode: 'disabled',
      cronValue: null,
    });
  });
});

describe('CronBuilder change notification', () => {
  it('does not trigger an update loop for newly allocated equivalent values', () => {
    const parentRenders = [
      { cron: '*/15 * * * *', timezone: 'UTC' },
      { cron: '*/15 * * * *', timezone: 'UTC' },
      { cron: '*/15 * * * *', timezone: 'UTC' },
    ];

    expect(parentRenders.map((value) => shouldNotifyCronBuilderChange(
      value.cron,
      value.timezone,
      '*/15 * * * *',
      'UTC',
    ))).toEqual([false, false, false]);
  });

  it('notifies only when a primitive cron or timezone changes', () => {
    expect(shouldNotifyCronBuilderChange(
      '*/30 * * * *',
      'UTC',
      '*/15 * * * *',
      'UTC',
    )).toBe(true);
    expect(shouldNotifyCronBuilderChange(
      '*/15 * * * *',
      'Europe/London',
      '*/15 * * * *',
      'UTC',
    )).toBe(true);
  });

  it('does not overwrite incoming props B with leftover generated cron A', () => {
    const leftoverA = { cron: '*/15 * * * *', timezone: 'UTC' };
    const incomingB = { cron: '0 * * * *', timezone: 'America/New_York' };
    const notifications: CronBuilderValue[] = [];

    let generatedCron = leftoverA.cron;
    let internalTimezone = leftoverA.timezone;
    let lastSyncedCron: string | undefined = leftoverA.cron;
    let lastSyncedTimezone: string | undefined = leftoverA.timezone;
    let propCron: string | undefined = leftoverA.cron;
    let propTimezone: string | undefined = leftoverA.timezone;

    propCron = incomingB.cron;
    propTimezone = incomingB.timezone;

    for (let i = 0; i < 25; i++) {
      const next = applyCronBuilderExternalProps({
        generatedCron,
        internalTimezone,
        propCron,
        propTimezone,
        lastSyncedCron,
        lastSyncedTimezone,
      });
      generatedCron = next.generatedCron;
      internalTimezone = next.internalTimezone;
      lastSyncedCron = next.lastSyncedCron;
      lastSyncedTimezone = next.lastSyncedTimezone;
      if (next.notify) {
        notifications.push(next.notify);
        propCron = next.notify.cron;
        propTimezone = next.notify.timezone;
        continue;
      }
      break;
    }

    expect(notifications.length).toBeLessThan(25);
    expect(notifications.map((value) => value.cron)).not.toContain(leftoverA.cron);
    expect(generatedCron).toBe(incomingB.cron);
    expect(internalTimezone).toBe(incomingB.timezone);
    expect(propCron).toBe(incomingB.cron);
    expect(propTimezone).toBe(incomingB.timezone);
  });

  it('notifies when the user changes cron after props have synced', () => {
    const synced = applyCronBuilderExternalProps({
      generatedCron: '0 * * * *',
      internalTimezone: 'America/New_York',
      propCron: '0 * * * *',
      propTimezone: 'America/New_York',
      lastSyncedCron: '0 * * * *',
      lastSyncedTimezone: 'America/New_York',
    });
    expect(synced.notify).toBeNull();

    const edited = applyCronBuilderExternalProps({
      generatedCron: '*/30 * * * *',
      internalTimezone: 'America/New_York',
      propCron: '0 * * * *',
      propTimezone: 'America/New_York',
      lastSyncedCron: '0 * * * *',
      lastSyncedTimezone: 'America/New_York',
    });
    expect(edited.notify).toEqual({
      cron: '*/30 * * * *',
      timezone: 'America/New_York',
    });
  });
});
