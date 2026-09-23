# ScoutX Cluster Engine

Production cluster engine for the ScoutText customer portal (`/user/*`).

## Architecture

- **Clusters** (`scoutx_clusters`) — curated filter definitions or custom source-bound clusters
- **Subscriptions** (`scoutx_cluster_subscriptions`) — per-user activations gated by First Step plan **and** explicit ScoutX “start cluster service”
- **Feed** — live pull query: cluster frozen filters + `lastSeenAt >= now - window`
- **Saved jobs** (`scoutx_saved_jobs`)
- **Requests** (`scoutx_cluster_requests`) — predefined taxonomy or custom career URLs
- **Activity** (`scoutx_cluster_activity`) — ops audit trail for create/update/publish/archive/etc.
- **Ops Cluster Studio** — `/clusters` list + `/clusters/:id` editor (same admin shell as Dashboard / Automations; not under `/admin`). Alias: `/cluster/:id` → `/clusters/:id`.
- **Ops Portal users** — `/portal-users` — per-user plan, start flag, and active cluster assignments

## Entitlements (no ScoutX billing yet)

| First Step `subscriptionType` | Max active clusters | Windows |
|------------------------------|---------------------|---------|
| Normal Plan / Free           | 1                   | 24h     |
| Premium                      | 1                   | 12h, 24h |
| Premium Plus / Premium+ / **PremiumPlus** | 2 | 1h, 12h, 24h |
| Enterprise                   | 5                   | 1h, 12h, 24h |

Configured in `server/src/services/clusterEntitlements.ts`. First Step’s DB key `PremiumPlus` is aliased to the same tier as `Premium Plus`.

**Included vs purchased extras:** Plan slots (e.g. Premium Plus = 2) are for self-serve browse/checkout. Additional clusters are purchased on First Step; the user submits a request and ops assigns/publishes (`source: request_fulfillment` or `admin_assigned`). Those extras do **not** consume included slots.

Plan sync (`fetchFirstStepPlanSnapshot`) tries Auth0 `sub`, then email-as-`user_id`, then First Step `POST /firstStep/user/getByEmail` → subscription. `GET /portal/entitlements` re-fetches when the cached plan is `unknown`, has an error, is older than 1h, or `?refresh=1`.

### Cluster service start gate

Login alone does **not** activate clusters. After First Step plan sync:

1. User calls `POST /api/portal/cluster-service/start` (sets `PortalUser.clusterServiceStartedAt`)
2. Then browse → checkout → `POST /api/portal/subscriptions` (uses one entitlement slot)

Until started, `availableSlots` is `0` and subscribe returns `403` with `code: cluster_service_not_started`.

Ops publish of a linked custom request only auto-creates an active subscription if that portal user has already started cluster service.

## Portal API (Auth0 Bearer)

All under `/api/portal/*`, rate-limited, require Auth0 access token:

- `GET /entitlements` — includes `clusterServiceStarted`, `subscriptionTypeDisplay`, `availableSlots`
- `POST /cluster-service/start` — ScoutX-only gate (not First Step billing)
- `GET /clusters`, `GET /clusters/:slug`, `GET /clusters/:slug/sample-jobs`
- `GET|POST|PATCH|DELETE /subscriptions`
- `GET /feed?subscriptionId=all|:id`
- `GET /jobs/:id`
- `GET|POST /saved`, `DELETE /saved/:jobId`
- `GET|POST /requests`

## Ops API (signed-in ops JWT / API key)

All under `/api/cluster-studio/*` (same auth as other ops pages — not the password-gated `/admin` token):

- `GET /api/cluster-studio/overview`
- `GET|PATCH /api/cluster-studio/requests`
- `POST /api/cluster-studio/requests/:id/create-draft` — fulfill as editable draft (preferred)
- `GET|POST /api/cluster-studio/clusters`
- `GET /api/cluster-studio/clusters/:id` — full cluster + linked request + robot stubs
- `PATCH /api/cluster-studio/clusters/:id` — field edits; rebuilds `filtersSummary` and refreshes `jobCountPreview` (unless `refreshCount: false`)
- `GET /api/cluster-studio/clusters/:id/sample-jobs`
- `GET /api/cluster-studio/clusters/:id/activity`
- `POST /api/cluster-studio/clusters/:id/preview-count`
- `POST /api/cluster-studio/clusters/:id/publish` — guards: curated needs ≥1 filter; custom needs sources/robots
- `POST /api/cluster-studio/clusters/:id/unpublish` → draft (keeps `publishedAt` history)
- `POST /api/cluster-studio/clusters/:id/archive` | `/restore`
- `POST /api/cluster-studio/clusters/:id/duplicate`
- `DELETE /api/cluster-studio/clusters/:id` — draft/archived only; 409 if active subscriptions
- `POST /api/cluster-studio/clusters/:id/bind-sources` (`createRobots: true` for custom URLs)
- `GET /api/cluster-studio/portal-users` — list users with plan + subscriptions
- `GET /api/cluster-studio/portal-users/:auth0Sub`
- `POST /api/cluster-studio/portal-users/:auth0Sub/subscriptions` — assign cluster (may force-start service)
- `DELETE /api/cluster-studio/portal-users/:auth0Sub/subscriptions/:id` — remove (`?soft=1` pauses)

### Ops UI

- List triage: `/clusters` (`ClusterStudioPage`)
- Editor: `/clusters/:id` and `/clusters/new` (`ClusterDetailPage` via `ClusterEditorShell`)
- Portal users: `/portal-users` (`PortalUsersPage`) — plan, start flag, slots, assign/remove clusters
- Request flow: **Open as draft** → edit on detail → **Publish** (updates request `published` + `resultClusterId`). Optional one-click **Fulfill & publish** remains on the list.

### Invariants

- **Curated** = filter mode; **custom** = source mode + URLs/robots (`resolveSourceMode`).
- Every successful filter/source save rebuilds `filtersSummary` and refreshes preview count.
- Published filter edits apply to the live feed immediately (cache TTL ≤ existing feed TTL, ~30s).
- Empty curated filters / empty custom sources cannot publish.

## Seed curated catalog

```bash
npx ts-node --project server/tsconfig.json server/src/scripts/seedCuratedClusters.ts
```

## Frontend

`src/user-dashboard/api/portalApi.ts` replaces the former localStorage mock. Token getter is registered from `usePortalAuth` / `PortalAuthProvider`.

Ops client: `src/api/adminClusters.ts`.

## Scale notes

- Feed cache TTL 30s keyed by `clusterId+window+filters+page` (shared across users)
- Portal rate limit: `PORTAL_RATE_LIMIT_MAX` (default 120/min)
- Job board queries use existing frozen-field indexes + pinned ops `ownerId`
