/**
 * One-page Decodo trial probe. Does not start a Scout-X run or use scrape.do.
 *
 * Usage (from repo root, after filling env):
 *   DECODO_PROXY_SERVER=gate.decodo.com:7000 ^
 *   DECODO_PROXY_USERNAME=your-user ^
 *   DECODO_PROXY_PASSWORD=your-pass ^
 *   DECODO_TEST_URL="https://hiring.jhu.edu/careers?query=Software+Engineering&start=20&pid=1133914568201&sort_by=relevance" ^
 *   npm run probe:decodo
 *
 * Keep SCRAPER_PROXY_ENABLED=false so other automations do not use account/env proxies.
 */
import dotenv from 'dotenv';
import path from 'path';
import { chromium } from 'playwright-core';
import { parseDecodoProbeEnv } from '../services/decodoTrialProbe';
import { shouldBlockRequest } from '../services/browserReusePool';
import { detect } from '../services/scraping/captchaGate';
import { assertSafeOutboundUrl } from '../utils/outboundUrlPolicy';
import { maskProxyUrl } from '../services/proxyConfig';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const cfg = parseDecodoProbeEnv(process.env);
  await assertSafeOutboundUrl(cfg.url);

  console.log('Decodo trial probe (one page, images/fonts/media blocked)');
  console.log(`  proxy: ${maskProxyUrl(cfg.server)}`);
  console.log(`  user:  ${cfg.username.replace(/.(?=.{4})/g, '*')}`);
  console.log(`  url:   ${cfg.url}`);

  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: cfg.server,
      username: cfg.username,
      password: cfg.password,
    },
  });

  let approxBytes = 0;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const req = route.request();
      if (shouldBlockRequest(req.url(), req.resourceType())) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    page.on('response', (response) => {
      const header = response.headers()['content-length'];
      const n = header ? parseInt(header, 10) : 0;
      if (Number.isFinite(n) && n > 0) approxBytes += n;
    });

    const started = Date.now();
    const nav = await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const captcha = await detect(page);
    const title = (await page.title().catch(() => '')) || '';
    const elapsedMs = Date.now() - started;

    console.log(`  http:     ${nav?.status() ?? 'n/a'}`);
    console.log(`  title:    ${title.slice(0, 120)}`);
    console.log(`  elapsed:  ${elapsedMs}ms`);
    console.log(`  approxGB: ${(approxBytes / (1024 * 1024 * 1024)).toFixed(4)} (Content-Length only; undercounts streamed JS)`);
    console.log(`  approxMB: ${(approxBytes / (1024 * 1024)).toFixed(2)}`);
    if (captcha.present) {
      console.log(`  captcha:  YES (${captcha.kind}) ${captcha.evidence || ''}`);
      process.exitCode = 2;
    } else {
      console.log('  captcha:  no widget detected on this single page load');
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
