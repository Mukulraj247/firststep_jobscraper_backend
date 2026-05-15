# scout-x

**scout-x** is the app name for this monorepo: FirstStep job ingestion and automation on top of **React + Vite** (`src/`), **Node + Express** (`server/`), plus optional **n8n** workflow exports under `docs/n8n/`.

The **same codebase** is published to two GitHub repositories (naming only; there is no split subtree):

- [firststep_jobscraper_ui](https://github.com/Mukulraj109/firststep_jobscraper_ui)
- [firststep_jobscraper_backend](https://github.com/Mukulraj109/firststep_jobscraper_backend)

## Requirements

- Node.js (see `package.json` engines if present)
- MongoDB and other services as described in [`ENVEXAMPLE`](./ENVEXAMPLE)
- Playwright browser install after deps: `npm run playwright:install`

## Local development

1. Copy environment template: `cp ENVEXAMPLE .env` (Windows: copy manually) and fill values.
2. Install dependencies: `npm install`
3. Run API + UI together: `npm run start:dev`
   - UI: **http://localhost:5173**
   - API: **http://localhost:8080** (HTTP API under `/api`)
4. Set **`VITE_BACKEND_URL`** to the API **origin** (e.g. `http://localhost:8080`). The UI appends `/api` where needed.

Optional: run the job worker in another terminal with `npm run worker:dev` when you are not using embedded workers.

More detail: [`SETUP.md`](./SETUP.md), [`ENVEXAMPLE`](./ENVEXAMPLE) for variables, [`chrome-extension/README.md`](./chrome-extension/README.md) for the extension.

## Production build

- Frontend: `npm run build` → output in `build/`
- Server: `npm run build:server` → output in `server/dist/`

See [`docs/production-deployment.md`](./docs/production-deployment.md) for process layout (API, worker, env).

## n8n

Workflow JSON and notes: [`docs/n8n/README.md`](./docs/n8n/README.md). **Do not commit secrets** (tokens, API keys) into workflow files intended for public repos.

## Scripts (common)

| Script            | Purpose                                      |
|-------------------|----------------------------------------------|
| `npm run start:dev` | Dev API (`nodemon`) + Vite client            |
| `npm run server:dev` | API only                                   |
| `npm run client`  | Vite dev server only                         |
| `npm run worker:dev` | Worker only (dev)                        |
| `npm run build`   | Production UI build                          |
| `npm run build:server` | Compile `server/` to `server/dist/`     |
| `npm run test`    | Vitest unit tests                            |
| `npm run migrate:extracted` | One-off migration script (see repo) |
