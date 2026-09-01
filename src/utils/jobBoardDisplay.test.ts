import { describe, expect, it } from 'vitest';
import {
  companyFromChoppingBlockSlug,
  resolveJobBoardCompany,
  resolveJobBoardLocation,
} from './jobBoardDisplay';

describe('jobBoardDisplay', () => {
  it('resolves Replit from choppingblock posting slug', () => {
    expect(
      companyFromChoppingBlockSlug(
        'https://www.choppingblock.ai/jobs/ai-agent-security-architect-at-replit'
      )
    ).toBe('Replit');
  });

  it('replaces Top AI with slug-derived employer', () => {
    expect(
      resolveJobBoardCompany({
        companyName: 'Top AI',
        aggregatorPostingUrl:
          'https://www.choppingblock.ai/jobs/ai-agent-security-architect-at-replit',
        jobDescription: 'Replit is the agentic software creation platform.',
      })
    ).toBe('Replit');
  });

  it('prefers concrete location over bare remote', () => {
    expect(
      resolveJobBoardLocation({ location: 'remote', remoteType: '' })
    ).toBe('remote');
    expect(
      resolveJobBoardLocation({ location: 'United States', remoteType: 'Remote' })
    ).toBe('United States');
  });
});
