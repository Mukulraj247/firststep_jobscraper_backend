/**
 * PM2 process file for Scout-X on a single DigitalOcean droplet.
 *
 * Topology (process isolation):
 *   scout-x               — API only (no Chromium). RUN_EMBEDDED_WORKERS=false
 *   scoutx-scheduler      — Agenda schedules + catch-up + ops digest (no Chromium)
 *   scoutx-scraper        — Agenda career scrapes + Chromium (SCHEDULER_ENABLED=false)
 *   scoutx-enrichment     — scrape.do / ATS enrichment (no Chromium)
 *   scoutx-aggregators    — Hiring Cafe aggregator-jobs + Chromium (SCHEDULER_ENABLED=false)
 *
 * 2 GB Chromium budget (Basic droplet):
 *   OS reserve ~200–300M. Soft caps via max_memory_restart (not hard cgroups):
 *     API 400M · scheduler 200M · enrichment 300M · scraper 1200M · aggregators 700M.
 *   Mongo chromium slot lease: up to CHROMIUM_MAX_SLOTS (2) career browsers in parallel;
 *   aggregators take exclusive only when zero career slots are held (no overlap).
 *   SCRAPER_WORKER_CONCURRENCY=2; AGGREGATOR_WORKER_CONCURRENCY=1. Keep LOW_MEMORY_MODE=true.
 *   Do not raise max slots / concurrency without a 4 GB resize (or adaptive RAM gates later).
 *
 * Do NOT set RUN_EMBEDDED_WORKERS=true on the API while scoutx-scraper / scoutx-aggregators
 * are running — that double-starts Chromium workers (Agenda locks prevent double-runs, but wastes RAM).
 * If you forget to start scoutx-scraper, career runs stay pending forever.
 * If you forget scoutx-aggregators, Aggregators / Hiring Cafe runs stay pending forever.
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
      // API should stay lean — Chromium lives in scoutx-scraper / scoutx-aggregators.
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        RUN_EMBEDDED_WORKERS: 'false',
      },
    },
    {
      name: 'scoutx-scheduler',
      script: 'node',
      args: '--expose-gc --max-old-space-size=192 server/dist/server/src/schedule-worker.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      kill_timeout: 20000,
      max_memory_restart: '200M',
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
      env: {
        NODE_ENV: 'production',
        // Schedules live in scoutx-scheduler — keep Chromium process scrape-only.
        SCHEDULER_ENABLED: 'false',
        LOW_MEMORY_MODE: 'true',
        SCRAPER_WORKER_CONCURRENCY: '2',
        CHROMIUM_MAX_SLOTS: '2',
        CHROMIUM_SLOT_LEASE_ENABLED: 'true',
        // Do NOT hardcode SCRAPER_JOB_TIMEOUT_MS here — it overrides /opt/scout-x/.env
        // (use .env, e.g. 180000–300000 for Oracle/Meta boards).
      },
      // Must exceed longest SCRAPER_JOB_TIMEOUT_MS + drain buffer when stopping PM2.
      kill_timeout: 360000,
      // Two concurrent lean Chromiums share this process (CHROMIUM_MAX_SLOTS=2).
      max_memory_restart: '1200M',
    },
    {
      name: 'scoutx-enrichment',
      script: 'node',
      args: '--expose-gc --max-old-space-size=384 server/dist/server/src/enrichmentWorker.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      kill_timeout: 30000,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        UV_THREADPOOL_SIZE: '8',
      },
    },
    {
      name: 'scoutx-aggregators',
      script: 'node',
      args: '--expose-gc --max-old-space-size=512 server/dist/server/src/aggregatorWorker.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        SCHEDULER_ENABLED: 'false',
        LOW_MEMORY_MODE: 'true',
        CHROMIUM_MAX_SLOTS: '2',
        CHROMIUM_SLOT_LEASE_ENABLED: 'true',
        // Keep at 1 on a shared droplet; exclusive Chromium via Mongo slot lease vs scrapers.
        AGGREGATOR_WORKER_CONCURRENCY: '1',
        // Prefer AGGREGATOR_JOB_TIMEOUT_MS in .env (default 600000 for list + detail enrich).
      },
      // Must exceed AGGREGATOR_JOB_TIMEOUT_MS + drain buffer.
      kill_timeout: 660000,
      max_memory_restart: '700M',
    },
  ],
};
