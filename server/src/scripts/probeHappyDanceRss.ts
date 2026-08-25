/**
 * One-shot live probe for HappyDance PHB RSS (Box / Nutanix).
 *   npx ts-node --project server/tsconfig.json server/src/scripts/probeHappyDanceRss.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import {
  detectAtsBoard,
  fetchAtsBoardJobs,
  startUrlHasCollectionFilters,
  looksLikeHappyDanceBoard,
  looksLikePhenomBoard,
} from '../services/atsAdapters';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const pageUrl = String(
    process.env.HAPPYDANCE_PROBE_URL ||
      'https://careers.box.com/en/jobs/?search=&location=Austin%2C+Texas%2C+United+States&location=San+Francisco%2C+California%2C+United+States&team=Engineering&team=IT&team=Security&pagesize=20#results'
  ).trim();
  console.log('HappyDance RSS probe (HTTP only, no Playwright)');
  console.log(`  url: ${pageUrl}`);
  console.log(`  looksLikePhenomBoard: ${looksLikePhenomBoard(pageUrl)}`);
  console.log(`  looksLikeHappyDanceBoard: ${looksLikeHappyDanceBoard(pageUrl)}`);
  if (!startUrlHasCollectionFilters(pageUrl)) {
    console.log('  refused: start URL has no collection filters (would dump the full board)');
    process.exitCode = 2;
    return;
  }
  const detected = detectAtsBoard(pageUrl);
  console.log(
    `  detectAtsBoard: ${detected ? `${detected.provider}/${detected.companyHint} ${detected.listApiUrl}` : 'none'}`
  );
  const board = await fetchAtsBoardJobs(pageUrl, { maxPages: 2 });
  if (!board?.rows.length) {
    console.log('  jobs: 0');
    process.exitCode = 2;
    return;
  }
  console.log(`  jobs retrieved: ${board.rows.length}`);
  for (const row of board.rows.slice(0, 8)) {
    console.log(`    - [${row.department || '?'}] ${row.jobTitle} @ ${row.location}`);
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});
