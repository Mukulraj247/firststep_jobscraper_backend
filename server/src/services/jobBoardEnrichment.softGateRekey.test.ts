import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findOne, updateOne, deleteOne } = vi.hoisted(() => ({
  findOne: vi.fn(),
  updateOne: vi.fn(),
  deleteOne: vi.fn(),
}));

vi.mock('../models/JobBoardListing', () => ({
  default: {
    findOne,
    updateOne,
    deleteOne,
    find: vi.fn(),
  },
}));

vi.mock('../logger', () => ({
  default: { log: vi.fn() },
}));

import { rekeySoftGateListingToEmployer } from './jobBoardEnrichment';
import { jobUrlKey, normalizeJobUrl } from './jobUrlNormalize';

describe('rekeySoftGateListingToEmployer', () => {
  beforeEach(() => {
    findOne.mockReset();
    updateOne.mockReset();
    deleteOne.mockReset();
  });

  it('merges soft-gate HC row into existing employer-keyed twin', async () => {
    const employer =
      'https://www.amazon.jobs/en/jobs/10528088/applied-scientist-global-risk-intelligence-and-prevention-seller-abuse-prevention';
    const softGate =
      'https://hiringcafe.com/job/applied-scientist-global-risk-intelligence-and-prevention-seller-rsn2lxvo42oe6q7h';
    const winnerId = 'winner-id';
    const softId = 'soft-id';

    findOne.mockResolvedValue({
      _id: winnerId,
      jobUrl: normalizeJobUrl(employer),
      applyUrl: normalizeJobUrl(employer),
      jobUrlKey: jobUrlKey(employer),
      salaryRange: '$142.8k-$193.2k/yr',
      seniorityLevel: 'Senior Level',
      robotMetaIds: ['r1'],
      runIds: ['run1'],
    });
    updateOne.mockResolvedValue({ acknowledged: true });
    deleteOne.mockResolvedValue({ deletedCount: 1 });

    const result = await rekeySoftGateListingToEmployer({
      doc: {
        _id: softId,
        jobUrl: softGate,
        applyUrl: employer,
        jobUrlKey: jobUrlKey(softGate),
        salaryRange: '$142.8',
        robotMetaIds: ['r2'],
        runIds: ['run2'],
        aggregatorPostingUrl: softGate,
      } as any,
      employerUrl: employer,
      aggregatorPostingUrl: softGate,
    });

    expect(result.action).toBe('merged_into');
    if (result.action === 'merged_into') {
      expect(result.winnerId).toBe(winnerId);
      expect(result.jobUrlKey).toBe(jobUrlKey(employer)!);
    }
    expect(deleteOne).toHaveBeenCalledWith({ _id: softId });
    expect(updateOne).toHaveBeenCalled();
  });

  it('rekeys soft-gate row when no employer twin exists', async () => {
    const employer = 'https://boards.greenhouse.io/acme/jobs/999';
    const softGate = 'https://hiringcafe.com/job/software-engineer-acme-abc123';

    findOne.mockResolvedValue(null);
    updateOne.mockResolvedValue({ acknowledged: true });

    const doc: any = {
      _id: 'soft-only',
      jobUrl: softGate,
      applyUrl: employer,
      jobUrlKey: jobUrlKey(softGate),
      robotMetaIds: [],
      runIds: [],
    };

    const result = await rekeySoftGateListingToEmployer({
      doc,
      employerUrl: employer,
      aggregatorPostingUrl: softGate,
    });

    expect(result.action).toBe('rekeyed');
    expect(doc.jobUrl).toBe(normalizeJobUrl(employer));
    expect(doc.jobUrlKey).toBe(jobUrlKey(employer));
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it('noops when current jobUrl is already employer-keyed', async () => {
    const employer = 'https://amazon.jobs/en/jobs/10528088/foo';
    const result = await rekeySoftGateListingToEmployer({
      doc: {
        _id: 'a',
        jobUrl: employer,
        applyUrl: employer,
        jobUrlKey: jobUrlKey(employer),
      } as any,
      employerUrl: employer,
    });
    expect(result.action).toBe('noop');
    expect(findOne).not.toHaveBeenCalled();
  });
});
