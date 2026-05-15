# Production deployment

This layout runs Maxun continuously with separate processes or machines for:

- **Frontend**: static React app (build with `npm run build`, serve with nginx, S3/CloudFront, or any static host)
- **Backend**: HTTP API and websocket server (`node server/dist/server/src/server.js` after `npm run build:server`)
- **Worker**: Agenda (MongoDB) scraper workers and related background processors (`node server/dist/server/src/worker.js`) when `RUN_EMBEDDED_WORKERS=false`
- **Redis**: optional; not required for the Agenda-based scraper queue (jobs use MongoDB)
- **MongoDB**: required (Atlas or self-hosted). Stores users, robots, runs, sessions, and Agenda jobs.
- **Browser**: remote Playwright browser service, or Chromium installed on the worker host (see [native-browser-setup.md](./native-browser-setup.md))
- Optional **Firebase Storage** (via `GOOGLE_APPLICATION_CREDENTIALS` and related env): run screenshots and binary artifacts; if unset, the app runs without cloud object storage.

## 1. Prepare `.env`

Start from `ENVEXAMPLE` and set at minimum:

```env
NODE_ENV=production
MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/maxun?retryWrites=true&w=majority
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
BACKEND_URL=https://api.your-domain.com
PUBLIC_URL=https://app.your-domain.com
VITE_BACKEND_URL=https://api.your-domain.com
VITE_PUBLIC_URL=https://app.your-domain.com
JWT_SECRET=replace-me
SESSION_SECRET=replace-me
ENCRYPTION_KEY=replace-me
DEFAULT_PROXY_URL=
PROXY_POOL=
RUN_EMBEDDED_WORKERS=false
SCRAPER_WORKER_CONCURRENCY=3
SCRAPER_JOB_TIMEOUT_MS=120000
```

Build artifacts:

```bash
npm ci --include=dev
npm run build:server
npm run build
```

On first connection, the server syncs **MongoDB indexes** defined on Mongoose models (no separate SQL migrations).

## 2. Start processes

**Backend** (example):

```bash
node server/dist/server/src/server.js
```

**Worker** (when `RUN_EMBEDDED_WORKERS=false`):

```bash
node server/dist/server/src/worker.js
```

Use a process manager (systemd, PM2, supervisord) or your platform’s “web service” + “worker” services so both stay running and restart on failure.

If `RUN_EMBEDDED_WORKERS=true`, the API process runs embedded workers (simpler single-node setup; less isolation than a separate worker process).

## 3. Scale workers

Run **multiple worker processes** (or platform replicas) when you need more throughput. Keep `SCRAPER_WORKER_CONCURRENCY` conservative (often `2` or `3`).

Total scraper concurrency is approximately:

`worker processes × SCRAPER_WORKER_CONCURRENCY`

## 4. Logging and error visibility

Set **`LOGS_PATH`** to a persistent directory. Winston writes under that path (see `server/src/logger`).

Recommended:

- Ship stdout/stderr to your log sink
- Retain local logs briefly for debugging
- Add external error tracking if required

## 5. Reverse proxy

Expose only the **frontend** and **backend** through your reverse proxy or load balancer.

- Serve static frontend from your CDN or web server
- Backend listens on the port you configure (default `8080`)
- Keep MongoDB and optional browser services on private networks where possible

## Railway

- Separate services for frontend (static), backend, and worker
- Use MongoDB Atlas (or Railway MongoDB) and optional Redis
- For cloud screenshots, inject Firebase credentials on backend/worker
- Worker command: `node server/dist/server/src/worker.js`

## Render

- Backend as web service; worker as background worker; frontend as static site
- Managed MongoDB and optional Redis
- Full step-by-step setup: [render-deployment.md](./render-deployment.md)

## AWS

- Frontend: S3 + CloudFront, or ECS/nginx
- Backend: ECS/Fargate or EKS
- Worker: separate ECS/Fargate workers
- MongoDB: Atlas or DocumentDB; optional ElastiCache Redis
- Object storage: optional Firebase Storage (see `ENVEXAMPLE`)
- Browser: private subnet service or workers with Playwright deps installed

## Architecture

```text
Chrome Extension  ->  Backend API  ->  Agenda (MongoDB)  ->  Workers (Playwright)
                                         |
                                         v
                                    MongoDB (app data)
                                         |
                                         v
                       Destinations (Webhook, Sheets, Airtable, optional external DB)
```
