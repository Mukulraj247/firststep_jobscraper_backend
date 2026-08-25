/**
 * Live Phenom / PCSX probe (HTTP only — no Playwright).
 *
 * Usage:
 *   PHENOM_PROBE_URL=https://hiring.jhu.edu/careers npm run probe:phenom
 */
import dotenv from 'dotenv';
import path from 'path';
import {
  detectAtsBoard,
  discoverPhenomSiteConfig,
  fetchAtsBoardJobs,
  startUrlHasCollectionFilters,
} from '../services/atsAdapters';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const pageUrl = String(process.env.PHENOM_PROBE_URL || 'https://hiring.jhu.edu/careers').trim();
  console.log('Phenom probe (HTTP only, no Playwright)');
  console.log(`  url: ${pageUrl}`);
  if (!startUrlHasCollectionFilters(pageUrl)) {
    console.log('  refused: start URL has no collection filters (would dump the full board)');
    process.exitCode = 2;
    return;
  }

  const detected = detectAtsBoard(pageUrl);
  console.log(`  detectAtsBoard: ${detected ? `${detected.provider}/${detected.companyHint}` : 'none'}`);

  const discovered = await discoverPhenomSiteConfig(pageUrl);
  if (!discovered) {
    console.log('  site config: NOT FOUND (HTML may be captcha-blocked or not Phenom)');
    process.exitCode = 1;
    return;
  }

  const { config } = discovered;
  console.log(`  site kind: ${config.kind}`);
  console.log(`  api path: ${config.kind === 'pcsx' ? 'GET /api/pcsx/search' : 'POST /widgets'}`);
  console.log(`  domain: ${config.domain || '(none)'}`);
  console.log(`  refNum present: ${config.refNum ? 'yes' : 'no'}`);
  console.log(`  company hint: ${config.companyHint}`);

  const board = await fetchAtsBoardJobs(pageUrl, { maxPages: 3 });
  if (!board?.rows.length) {
    console.log('  jobs: 0 (API blocked or empty — browser fallback would still hit CAPTCHA on list page)');
    process.exitCode = 2;
    return;
  }

  console.log(`  jobs retrieved: ${board.rows.length}`);
  console.log(`  sample URLs:`);
  for (const row of board.rows.slice(0, 5)) {
    console.log(`    - ${row.jobTitle}: ${row.jobUrl}`);
  }

  const page2 = await fetchAtsBoardJobs(pageUrl, { maxPages: 2 });
  if (page2 && page2.rows.length > board.rows.length / 2) {
    console.log(`  pagination: ok (${page2.rows.length} rows with maxPages=2)`);
  } else {
    console.log(`  pagination: limited or single page (${page2?.rows.length ?? 0} rows with maxPages=2)`);
  }

  console.log('  Playwright required for list scrape: NO (when this probe succeeds)');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});
