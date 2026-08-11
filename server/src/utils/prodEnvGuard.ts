/**
 * Detect Render free-tier / severely constrained scraper fingerprints so
 * DigitalOcean production is not accidentally run with free-tier knobs.
 */
export function getConstrainedScraperFingerprintWarning(): string | null {
  const maxAttempts = Math.max(1, parseInt(process.env.SCRAPER_MAX_ATTEMPTS || '3', 10));
  const lowMem =
    String(process.env.LOW_MEMORY_MODE || '').toLowerCase() === 'true' ||
    process.env.LOW_MEMORY_MODE === '1';
  const nodeOpts = process.env.NODE_OPTIONS || '';
  const oldSpaceMatch = nodeOpts.match(/--max-old-space-size=(\d+)/i);
  const oldSpaceMb = oldSpaceMatch ? parseInt(oldSpaceMatch[1], 10) : null;
  const tinyHeap = oldSpaceMb != null && !Number.isNaN(oldSpaceMb) && oldSpaceMb > 0 && oldSpaceMb <= 256;

  if (maxAttempts <= 1 && lowMem && tinyHeap) {
    return (
      `Constrained scraper fingerprint detected (SCRAPER_MAX_ATTEMPTS=${maxAttempts}, ` +
      `LOW_MEMORY_MODE, NODE_OPTIONS max-old-space-size=${oldSpaceMb}). ` +
      `This matches Render free-tier defaults — confirm production uses DigitalOcean PM2 env, not free-tier knobs.`
    );
  }
  return null;
}

export function warnIfConstrainedScraperFingerprint(log: (level: string, msg: string) => void): void {
  const warning = getConstrainedScraperFingerprintWarning();
  if (warning) {
    log('error', warning);
  }
}
