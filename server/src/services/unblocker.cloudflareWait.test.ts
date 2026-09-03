import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  detectCloudflareChallengeType,
  tryClickCloudflareTurnstile,
  solveCloudflareChallenge,
} from './unblocker.cloudflareSolve';
import { waitForCloudflareToClear } from './unblocker';

vi.mock('../logger', () => ({
  default: { log: vi.fn() },
}));

describe('waitForCloudflareToClear', () => {
  it('returns false when the page is closed during the challenge poll (does not throw browser_closed)', async () => {
    const page = {
      isClosed: () => true,
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(null),
      title: vi.fn().mockResolvedValue('Just a moment...'),
      innerText: vi.fn().mockResolvedValue('checking your browser'),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockRejectedValue(
        new Error('page.waitForTimeout: Target page, context or browser has been closed')
      ),
      url: vi.fn().mockReturnValue('https://jobs.uber.com/'),
      locator: vi.fn(),
      mouse: { click: vi.fn() },
    } as any;

    await expect(
      waitForCloudflareToClear(page, { timeoutMs: 5_000, pollMs: 50, solveInteractive: false })
    ).resolves.toBe(false);
  });
});

describe('detectCloudflareChallengeType', () => {
  it('returns interactive when a Turnstile challenge-platform frame is present', async () => {
    const page = {
      isClosed: () => false,
      frames: () => [
        { url: () => 'https://example.com/' },
        {
          url: () =>
            'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/x/x/x/light/fbE/new/normal/auto/',
        },
      ],
      evaluate: vi.fn(),
    } as any;

    await expect(detectCloudflareChallengeType(page)).resolves.toBe('interactive');
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('returns embedded when turnstile script is in HTML', async () => {
    const page = {
      isClosed: () => false,
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue('embedded'),
      title: vi.fn().mockResolvedValue('Jobs'),
      innerText: vi.fn().mockResolvedValue(''),
    } as any;

    await expect(detectCloudflareChallengeType(page)).resolves.toBe('embedded');
  });
});

describe('tryClickCloudflareTurnstile', () => {
  it('clicks near the iframe bounding box when Turnstile iframe is visible', async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    const page = {
      isClosed: () => false,
      frames: () => [],
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      mouse: { click },
      locator: vi.fn().mockReturnValue({
        first: () => ({
          count: vi.fn().mockResolvedValue(1),
          waitFor: vi.fn().mockResolvedValue(undefined),
          boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 200, width: 300, height: 65 }),
        }),
      }),
    } as any;

    await expect(tryClickCloudflareTurnstile(page)).resolves.toBe(true);
    expect(click).toHaveBeenCalled();
    const [x, y] = click.mock.calls[0];
    expect(x).toBeGreaterThanOrEqual(126);
    expect(x).toBeLessThanOrEqual(128);
    expect(y).toBeGreaterThanOrEqual(225);
    expect(y).toBeLessThanOrEqual(227);
  });
});

describe('solveCloudflareChallenge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('non-interactive: waits without clicking when no Turnstile iframe', async () => {
    let challenged = true;
    const click = vi.fn();
    const page = {
      isClosed: () => false,
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(null),
      title: vi.fn().mockImplementation(async () => (challenged ? 'Just a moment...' : 'Jobs at Acme')),
      innerText: vi.fn().mockImplementation(async () =>
        challenged ? 'checking your browser before accessing' : 'Software Engineer openings'
      ),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockImplementation(async () => {
        challenged = false;
      }),
      locator: vi.fn().mockReturnValue({
        first: () => ({
          count: vi.fn().mockResolvedValue(0),
        }),
      }),
      mouse: { click },
    } as any;

    await expect(
      solveCloudflareChallenge(page, {
        timeoutMs: 3_000,
        pollMs: 50,
        maxAttempts: 2,
        solveInteractive: true,
      })
    ).resolves.toBe(true);
    expect(click).not.toHaveBeenCalled();
  });

  it('interactive: attempts a Turnstile click then clears', async () => {
    let challenged = true;
    const click = vi.fn().mockResolvedValue(undefined);
    const page = {
      isClosed: () => false,
      frames: () => [
        {
          url: () =>
            'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/x/x/x/light/fbE/new/normal/auto/',
        },
      ],
      // Must be null: detectCloudflareChallenge treats any truthy evaluate result as a DOM marker.
      evaluate: vi.fn().mockResolvedValue(null),
      title: vi.fn().mockImplementation(async () => (challenged ? 'Just a moment...' : 'Careers')),
      innerText: vi.fn().mockImplementation(async () =>
        challenged ? 'verify you are human' : 'Open roles'
      ),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockImplementation(async () => {
        challenged = false;
      }),
      locator: vi.fn().mockReturnValue({
        first: () => ({
          count: vi.fn().mockResolvedValue(1),
          waitFor: vi.fn().mockResolvedValue(undefined),
          boundingBox: vi.fn().mockResolvedValue({ x: 10, y: 10, width: 300, height: 65 }),
        }),
      }),
      mouse: { click },
    } as any;

    await expect(
      solveCloudflareChallenge(page, {
        timeoutMs: 5_000,
        pollMs: 50,
        maxAttempts: 3,
      })
    ).resolves.toBe(true);
    expect(click).toHaveBeenCalled();
  });

  it('fails after maxAttempts when challenge never clears', async () => {
    const page = {
      isClosed: () => false,
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(null),
      title: vi.fn().mockResolvedValue('Just a moment...'),
      innerText: vi.fn().mockResolvedValue('checking your browser'),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue({
        first: () => ({
          count: vi.fn().mockResolvedValue(0),
        }),
      }),
      mouse: { click: vi.fn() },
    } as any;

    await expect(
      solveCloudflareChallenge(page, {
        timeoutMs: 400,
        pollMs: 50,
        maxAttempts: 2,
        solveInteractive: false,
      })
    ).resolves.toBe(false);
  });
});
