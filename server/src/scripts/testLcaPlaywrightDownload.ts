/**
 * One-off: verify Playwright can pull a DOL LCA xlsx past Akamai 403.
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

async function main() {
  const url =
    process.env.H1B_TEST_URL ||
    'https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2025_Q4.xlsx';
  const dest = path.resolve(
    process.env.H1B_LCA_DIR || path.resolve(__dirname, '../../../data/lca'),
    'FY2025_Q4.xlsx'
  );
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  console.log('launching browser…');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        Referer: 'https://www.dol.gov/agencies/eta/foreign-labor/performance',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const page = await context.newPage();
    console.log('warming performance page…');
    await page.goto('https://www.dol.gov/agencies/eta/foreign-labor/performance', {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    await page.close();

    console.log('GET', url);
    const response = await context.request.get(url, { timeout: 600_000 });
    console.log('status', response.status());
    const body = await response.body();
    console.log('bytes', body.length);
    if (!response.ok() || body.length < 10_000) {
      throw new Error(`bad download status=${response.status()} bytes=${body.length}`);
    }
    fs.writeFileSync(dest, body);
    console.log('saved', dest, `${(body.length / 1e6).toFixed(1)} MB`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
