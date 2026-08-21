import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  detectAtsBoard,
  shouldSkipScrapeDoUrl,
  detectAts,
} from '../services/atsAdapters';

type Row = { sector: string; company: string; url: string };

const rows: Row[] = JSON.parse(
  readFileSync(resolve(__dirname, '../../../docs/career-urls-unique.json'), 'utf-8')
);

const stats: Record<string, number> = {};
const bump = (k: string) => {
  stats[k] = (stats[k] || 0) + 1;
};

const lines = ['sector,company,url,board_provider,detail_ats,skip_scrape_do,bucket'];

for (const row of rows) {
  let boardProvider = 'none';
  let detailAts = 'none';
  let skip = false;
  let bucket = 'scrape_do_risk';
  try {
    const board = detectAtsBoard(row.url);
    const detail = detectAts(row.url);
    skip = shouldSkipScrapeDoUrl(row.url);
    boardProvider = board?.provider || 'none';
    detailAts = detail?.provider || 'none';
    if (board) bucket = 'free_board';
    else if (detail || skip) bucket = 'enrich_free_or_skip';
    else bucket = 'scrape_do_risk';
  } catch {
    bucket = 'error';
  }
  bump(`board:${boardProvider}`);
  bump(`detail:${detailAts}`);
  bump(`bucket:${bucket}`);
  if (skip) bump('skip_scrape_do_true');
  else bump('skip_scrape_do_false');

  const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  lines.push(
    [q(row.sector), q(row.company), q(row.url), boardProvider, detailAts, String(skip), bucket].join(
      ','
    )
  );
}

const outPath = resolve(__dirname, '../../../docs/career-ats-verification.csv');
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(JSON.stringify({ total: rows.length, stats }, null, 2));
console.log('Wrote', outPath);
