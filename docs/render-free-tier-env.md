# Render Free Tier — Backend Environment Reference

Copy-paste config for the **scoutx-backend** Web Service on Render's free plan (512 MB RAM).

> **Why these values:** Chromium runs as a **separate process** but still counts against the same 512 MB container limit as Node. A large Node heap leaves no room for Chromium and causes `exceeded its memory limit` restarts.
>
> **Build vs runtime:** Service-level `NODE_OPTIONS=192` also applies to the **build**. TypeScript (`tsc`) needs more than 192 MB, so the build command **overrides** `NODE_OPTIONS` to 768 MB. Runtime still uses 192 MB.

---

## Commands (paste into Render)

**Build command**

```bash
NODE_OPTIONS='--max-old-space-size=768' npm install --include=dev && NODE_OPTIONS='--max-old-space-size=768' npm run build:server && PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.pw-browsers npx -y playwright@1.58.0 install chromium
```

**Start command**

```bash
npm run server
```

Do **not** install Chromium in the start command — it re-downloads on every restart (including OOM restarts).

---

## Env vars (copy-paste)

Fill the empty values, then add each line in Render → Environment (key = left of `=`, value = right of `=`).

```env
NODE_ENV=production
MONGODB_URI=
JWT_SECRET=
SESSION_SECRET=
ENCRYPTION_KEY=
BACKEND_URL=
PUBLIC_URL=
VITE_BACKEND_URL=
VITE_PUBLIC_URL=
PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.pw-browsers

RUN_EMBEDDED_WORKERS=true
NODE_OPTIONS=--max-old-space-size=192 --expose-gc
LOW_MEMORY_MODE=true
SCRAPER_WORKER_CONCURRENCY=1
SCRAPER_JOB_TIMEOUT_MS=45000
SCRAPER_MAX_ATTEMPTS=1
DISABLE_VISIBLE_BROWSER_RETRY=true
BROWSER_POOL_MAX_PAGES=1
BROWSER_POOL_IDLE_TTL_MS=0
CLOUDFLARE_WAIT_TIMEOUT_MS=20000
AMAZON_CHALLENGE_WAIT_MS=25000
MICROSOFT_CHALLENGE_WAIT_MS=25000
QUEUED_RUNS_POLL_MS=60000
SOCKET_MAX_HTTP_BUFFER_BYTES=2097152
LOGS_PATH=server/logs
```

`PLAYWRIGHT_BROWSERS_PATH` must match the path in the build command.

---

## What each memory/scraper var does

| Key | Value | Purpose |
|-----|-------|---------|
| `RUN_EMBEDDED_WORKERS` | `true` | One service instead of two (saves instance hours) |
| `NODE_OPTIONS` | `--max-old-space-size=192 --expose-gc` | Caps **runtime** Node so Chromium fits (build overrides this) |
| `LOW_MEMORY_MODE` | `true` | Lean Chromium, close browser after each job |
| `SCRAPER_WORKER_CONCURRENCY` | `1` | One browser at a time |
| `SCRAPER_JOB_TIMEOUT_MS` | `45000` | Cap scrape duration |
| `SCRAPER_MAX_ATTEMPTS` | `1` | Avoid second Chromium spike from retries |
| `DISABLE_VISIBLE_BROWSER_RETRY` | `true` | No heavyweight visible browser |
| `BROWSER_POOL_MAX_PAGES` | `1` | One page per browser |
| `BROWSER_POOL_IDLE_TTL_MS` | `0` | Close idle Chromium immediately |
| `CLOUDFLARE_WAIT_TIMEOUT_MS` | `20000` | Fit challenge waits inside job timeout |
| `AMAZON_CHALLENGE_WAIT_MS` | `25000` | Fit challenge waits inside job timeout |
| `MICROSOFT_CHALLENGE_WAIT_MS` | `25000` | Fit challenge waits inside job timeout |
| `QUEUED_RUNS_POLL_MS` | `60000` | Less idle DB traffic |
| `SOCKET_MAX_HTTP_BUFFER_BYTES` | `2097152` | Cap socket payload size |
| `LOGS_PATH` | `server/logs` | Log directory |

---

## Verifying the deploy

Logs should contain:

```text
LOW_MEMORY_MODE enabled: Chromium is lean, browsers close after each job, ...
```

If missing, check the Environment tab (Blueprint env only applies when the service was created from the Blueprint).

---

## Moving to a paid instance (≥2 GB)

| Key | Free | Paid |
|-----|------|------|
| `NODE_OPTIONS` | `--max-old-space-size=192 --expose-gc` | `--max-old-space-size=1536 --expose-gc` |
| `LOW_MEMORY_MODE` | `true` | `false` |
| `SCRAPER_WORKER_CONCURRENCY` | `1` | `2`–`3` |
| `SCRAPER_MAX_ATTEMPTS` | `1` | `3` |
| `SCRAPER_JOB_TIMEOUT_MS` | `45000` | `120000` |
| `DISABLE_VISIBLE_BROWSER_RETRY` | `true` | `false` |
| `BROWSER_POOL_MAX_PAGES` | `1` | `3` |
| `BROWSER_POOL_IDLE_TTL_MS` | `0` | `90000` |

On paid, the build command no longer needs the 768 override if `NODE_OPTIONS` is already high enough for `tsc`.
