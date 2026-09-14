import mongoose from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyRunRetention,
  daysAgo,
  getRetentionSettings,
  shouldPurgeJobListing,
  shouldPurgeOrphanExtracted,
  shouldPurgeRun,
} from './dataRetention';

const now = new Date('2026-08-25T12:00:00.000Z');
/** Explicit policy under test (matches free-tier 3/7/14 defaults). */
const settings = {
  successDays: 3,
  failureDays: 7,
  jobBoardDays: 14,
  extractedOrphanDays: 7,
};

describe('dataRetention policy', () => {
  afterEach(() => {
    delete process.env.RETENTION_ENABLED;
    delete process.env.RETENTION_DRY_RUN;
    delete process.env.RETENTION_RUN_SUCCESS_DAYS;
    delete process.env.RETENTION_RUN_FAILURE_DAYS;
    delete process.env.RETENTION_JOB_BOARD_DAYS;
    delete process.env.RETENTION_EXTRACTED_ORPHAN_DAYS;
  });

  it('defaults to free-tier 3/7/7/14 when env unset', () => {
    const cfg = getRetentionSettings();
    expect(cfg.successDays).toBe(3);
    expect(cfg.failureDays).toBe(7);
    expect(cfg.extractedOrphanDays).toBe(7);
    expect(cfg.jobBoardDays).toBe(14);
    expect(cfg.enabled).toBe(true);
    expect(cfg.dryRun).toBe(false);
  });

  it('classifies active runs as keep-forever', () => {
    expect(classifyRunRetention('running')).toBe('keep');
    expect(classifyRunRetention('queued')).toBe('keep');
    expect(classifyRunRetention('pending')).toBe('keep');
  });

  it('classifies failed and dead as failure retention', () => {
    expect(classifyRunRetention('failed')).toBe('failure');
    expect(classifyRunRetention('dead')).toBe('failure');
  });

  it('classifies success-like terminals as success retention', () => {
    expect(classifyRunRetention('success')).toBe('success');
    expect(classifyRunRetention('completed')).toBe('success');
    expect(classifyRunRetention('aborted')).toBe('success');
  });

  it('keeps a failed run that is 6 days old', () => {
    const sortAt = daysAgo(6, now);
    expect(shouldPurgeRun({ status: 'failed', sortAt }, now, settings)).toBe(false);
  });

  it('purges a success run that is 4 days old', () => {
    const sortAt = daysAgo(4, now);
    expect(shouldPurgeRun({ status: 'success', sortAt }, now, settings)).toBe(true);
  });

  it('keeps a success run that is 2 days old', () => {
    const sortAt = daysAgo(2, now);
    expect(shouldPurgeRun({ status: 'success', sortAt }, now, settings)).toBe(false);
  });

  it('purges a failed run older than 7 days', () => {
    const sortAt = daysAgo(8, now);
    expect(shouldPurgeRun({ status: 'failed', sortAt }, now, settings)).toBe(true);
  });

  it('never purges running automations even if sortAt is old', () => {
    expect(
      shouldPurgeRun({ status: 'running', sortAt: daysAgo(90, now) }, now, settings)
    ).toBe(false);
  });

  it('uses _id timestamp when sortAt is missing', () => {
    const oldId = mongoose.Types.ObjectId.createFromTime(
      Math.floor(daysAgo(10, now).getTime() / 1000)
    );
    expect(shouldPurgeRun({ status: 'success', sortAt: null, _id: oldId }, now, settings)).toBe(
      true
    );
    expect(shouldPurgeRun({ status: 'failed', sortAt: null, _id: oldId }, now, settings)).toBe(
      true
    );
  });

  it('purges job listings last seen more than 14 days ago', () => {
    expect(shouldPurgeJobListing({ lastSeenAt: daysAgo(15, now) }, now, settings)).toBe(true);
    expect(shouldPurgeJobListing({ lastSeenAt: daysAgo(13, now) }, now, settings)).toBe(false);
  });

  it('keeps jobs with no lastSeenAt', () => {
    expect(shouldPurgeJobListing({ lastSeenAt: null }, now, settings)).toBe(false);
  });

  it('never purges extracted rows whose run still exists', () => {
    expect(
      shouldPurgeOrphanExtracted({ createdAt: daysAgo(31, now) }, now, settings, true)
    ).toBe(false);
  });

  it('purges extracted orphans older than 7 days only when run is gone', () => {
    expect(
      shouldPurgeOrphanExtracted({ createdAt: daysAgo(8, now) }, now, settings, false)
    ).toBe(true);
    expect(
      shouldPurgeOrphanExtracted({ createdAt: daysAgo(6, now) }, now, settings, false)
    ).toBe(false);
  });

  it('reads env overrides', () => {
    process.env.RETENTION_DRY_RUN = 'true';
    process.env.RETENTION_RUN_SUCCESS_DAYS = '5';
    process.env.RETENTION_JOB_BOARD_DAYS = '90';
    const cfg = getRetentionSettings();
    expect(cfg.dryRun).toBe(true);
    expect(cfg.successDays).toBe(5);
    expect(cfg.jobBoardDays).toBe(90);
  });
});
