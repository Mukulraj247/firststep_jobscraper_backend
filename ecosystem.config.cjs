/**
 * PM2 process file for Scout-X on a single DigitalOcean droplet.
 *
 * Topology (process isolation):
 *   scout-x             — API only (no Chromium). RUN_EMBEDDED_WORKERS=false
 *   scoutx-scheduler    — Agenda schedules + catch-up + ops digest (no Chromium)
 *   scoutx-scraper      — Agenda scrapes + Chromium (SCHEDULER_ENABLED=false)
 *   scoutx-enrichment   — scrape.do / ATS enrichment (no Chromium)
 *
 * Do NOT set RUN_EMBEDDED_WORKERS=true on the API while scoutx-scraper is running —
 * that double-starts Chromium workers (Agenda locks prevent double-runs, but wastes RAM).
 * If you forget to start scoutx-scraper, runs stay pending forever.
 * If you forget scoutx-scheduler (with scraper SCHEDULER_ENABLED=false), schedules never fire.
 *
 * Usage (from repo root after build):
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Keep exactly one scoutx-enrichment instance — rate limits and credit budget are per-process.
 * Scale scrape throughput later by adding another droplet (or instance) running scoutx-scraper only.
 */
module.exports = {
  apps: [
    {
      name: 'scout-x',
      script: 'node',
      args: '--expose-gc server/dist/server/src/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      // Allow SIGTERM handler to finish HTTP/socket close (no long scrape drain on API).
      kill_timeout: 15000,
      // API should stay lean — Chromium lives in scoutx-scraper.
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        RUN_EMBEDDED_WORKERS: 'false',
      },
    },
    {
      name: 'scoutx-scheduler',
      script: 'node',
      args: '--expose-gc --max-old-space-size=256 server/dist/server/src/schedule-worker.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      kill_timeout: 20000,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'scoutx-scraper',
      script: 'node',
      args: '--expose-gc --max-old-space-size=512 server/dist/server/src/worker.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      // Must exceed SCRAPE_DRAIN_MS (default 90s) + child/browser cleanup buffer.
      kill_timeout: 120000,
      max_memory_restart: '700M',
      env: {
        NODE_ENV: 'production',
        // Schedules live in scoutx-scheduler — keep Chromium process scrape-only.
        SCHEDULER_ENABLED: 'false',
        LOW_MEMORY_MODE: 'true',
        SCRAPER_WORKER_CONCURRENCY: '1',
        SCRAPER_JOB_TIMEOUT_MS: '60000',
      },
    },
    {
      name: 'scoutx-enrichment',
      script: 'node',
      args: '--expose-gc --max-old-space-size=512 server/dist/server/src/enrichmentWorker.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      kill_timeout: 30000,
      max_memory_restart: '450M',
      env: {
        NODE_ENV: 'production',
        UV_THREADPOOL_SIZE: '8',
      },
    },
  ],
};
