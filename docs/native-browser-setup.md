# Remote Playwright browser and Camoufox (native install)

The backend connects over HTTP (health) and WebSocket to whatever process listens on the configured host and ports—on the same machine or remotely.

For full Render deployment flow (frontend + backend + worker + env wiring), see [render-deployment.md](./render-deployment.md).

## How connection works

Configuration is in [`browserConnection.ts`](../server/src/browser-management/browserConnection.ts).

- **`DEFAULT_BROWSER_TYPE`**: `playwright` (Chromium remote service or local launch) or `camoufox` (Firefox-based anti-detect service).
- **Playwright browser service**: health URL `http://${BROWSER_WS_HOST}:${BROWSER_HEALTH_PORT}/health` must return JSON with `status: healthy` and `wsEndpoint`.
- **Camoufox**: health URL `http://${CAMOUFOX_WS_HOST}:${CAMOUFOX_HEALTH_PORT}/health` with the same shape.

Set **`BROWSER_WS_HOST`** / **`CAMOUFOX_WS_HOST`** to `127.0.0.1` or `localhost` when those services run on the same machine; use the hostname or IP when they run elsewhere.

## Option A: Local Chromium only (simplest)

Recommended default on Windows/macOS/Linux when you do not need Camoufox: set `DEFAULT_BROWSER_TYPE=playwright` in `.env`, then run `npm run playwright:install` once from the repo root.

```bash
npx playwright@1.58.0 install chromium
```

If you are **not** setting `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` or `CONTAINER=true`, the server can fall back to launching Chromium locally when the remote browser service is unavailable. In CI or minimal images without bundled browsers, a remote browser service or preinstalled Chromium is required—see `mustUseRemoteBrowserOnly` in `browserConnection.ts`.

## Option B: Playwright browser service on the host

Run the Node process from the `browser/` package (same protocol the app expects on `BROWSER_WS_*` ports).

1. From the repo root, install and build the browser package (once):

   ```bash
   npm install --prefix browser
   npm run build --prefix browser
   ```

2. Set in `.env` (example for local):

   ```env
   BROWSER_WS_HOST=127.0.0.1
   BROWSER_WS_PORT=3001
   BROWSER_HEALTH_PORT=3002
   ```

3. Start the service:

   ```bash
   npm run browser:service
   ```

   For development with hot reload:

   ```bash
   npm run browser:service:dev
   ```

4. Point the backend/worker at the same host/ports (`BROWSER_WS_*`).

## Option C: Camoufox on the host (anti-detect)

The Camoufox sidecar is [`server/src/services/camoufox-server.py`](../server/src/services/camoufox-server.py). Install Python 3.11+, then `pip install camoufox[geoip]` and run `python -m camoufox fetch` once to download the browser binary.

On Linux you may need OS libraries for Firefox (e.g. Xvfb for headless setups—see Camoufox docs for your distribution).

Set in `.env`:

```env
DEFAULT_BROWSER_TYPE=camoufox
CAMOUFOX_WS_HOST=127.0.0.1
CAMOUFOX_WS_PORT=3003
CAMOUFOX_HEALTH_PORT=3004
```

Optional: `CAMOUFOX_PROXY_SERVER`, `CAMOUFOX_PROXY_USERNAME`, `CAMOUFOX_PROXY_PASSWORD`.

Set `SCRAPER_PROXY_ENABLED=false` to scrape without a proxy while leaving those credentials in `.env`. Default is enabled (`true`).

Start the server:

```bash
npm run camoufox:server
```

Or: `python server/src/services/camoufox-server.py` (use `python3` on some systems).

## Related npm scripts (repo root)

| Script | Purpose |
|--------|---------|
| `npm run browser:service` | Build and run the Playwright browser WebSocket service (`browser/`). |
| `npm run browser:service:dev` | Run `browser/server.ts` via `ts-node` for development. |
| `npm run camoufox:server` | Run the Camoufox Python sidecar. |
