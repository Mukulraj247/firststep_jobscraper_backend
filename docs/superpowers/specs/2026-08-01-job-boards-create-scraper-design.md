# Job Boards + Create Scraper — Production Redesign

**Date:** 2026-08-01  
**Product surface:** Scout-X / FirstStep — `/robots` (Job boards) and `/robots/create`  
**Status:** Design approved in brainstorm; awaiting user review of this written spec before implementation planning  

## Decisions locked

| Decision | Choice |
|----------|--------|
| Pass type | Full production pass: UI + correctness fixes + cost/compute optimizations |
| Scale target | Near-term load; every change production-grade and cheap to run (not million-user platform rebuild) |
| Create modes | Extract, Scrape, Crawl, Search — all first-class and equal |
| UI depth | Full visual redesign of these screens; keep MUI as the component system |
| Delivery | Vertical slices (list → Extract → Scrape/Crawl/Search → shared polish) |

## Goals

1. Make Job boards and Create scraper feel product-grade: clear hierarchy, dense operational UI, consistent brand/copy.
2. Fix correctness bugs that break trust (IDs, form state, cache, validation).
3. Cut wasteful compute/bandwidth (list payloads, screenshot defaults, server-side caps).
4. Keep all four create modes equal and understandable.

## Non-goals

- Multi-region / million-user worker platform, billing, or global quota product
- New scraping engines or AI extraction
- Redesign of Dashboard, Runs, Proxy, or Chrome extension
- Scheduler engine rewrite (surface existing schedule state only)

---

## Current-state audit (summary)

### Job boards list (`RecordingsTable` / `Recordings`)

**UI gaps**

- Columns are almost entirely icon buttons (Run, Schedule, Integrate, Settings, Options) with weak hierarchy and sparse whitespace.
- No type, status, schedule summary, or last-run columns — operators cannot scan health.
- Schedule/integrate state is invisible until the user opens a modal/page.
- Naming inconsistency (short names vs timestamp auto-names) with no guidance.
- Legacy create modal still exists on the list page even though primary CTA navigates to `/robots/create`.

**Correctness / performance gaps**

- Row identity uses array `index` instead of `recording_meta.id`, which is unsafe under sort/filter/delete/run.
- `GET /storage/recordings` returns full robot documents including workflows when `limit` is omitted — expensive for large accounts.
- Client loads all robots then paginates in memory; server pagination exists but is unused by the UI.
- Cache invalidation paths are inconsistent across create flows (`setRerenderRobots` vs `invalidateRecordings`).

### Create scraper (`RobotCreate`)

**UI gaps**

- Redundant in-card Scout-X/FirstStep logos on every tab.
- Tiny centered tabs + large empty chrome; forms feel sparse and uneven across modes.
- Required-field markers inconsistent (often only Output Formats shows `*`).
- Placeholder-as-label risk; weak helpers for URL format, crawl cost, search modes.
- CTA copy says “Create Robot” on a “job board scraper” surface.
- Search “Time Range” can look unset; Discover mode note about formats is easy to miss.
- Hardcoded English on Scrape/Crawl/Search while Extract uses i18n.

**Correctness / cost gaps**

- Scrape and Extract share `url` state — values leak across tabs.
- Browser-limit / orphan session handling on Extract needs hardening.
- No server-side hard caps surfaced in UI for crawl pages / search results / screenshot formats.
- Screenshots (especially full-page) are offered without compute cost signaling.
- API validation must not rely on UI alone.

---

## Target design

### Slice 1 — Job boards list

**Layout**

- Page title: “Job board scrapers” + short subtitle + primary CTA “Create scraper”.
- Toolbar: search, type filter, schedule filter (optional in first implementation if data ready).
- Table columns: **Name** (secondary: relative updated), **Type**, **Status**, **Schedule**, **Last run**, **Actions**.
- Actions: primary **Run**; overflow menu for Schedule, Integrate, Settings, Edit, Duplicate, Delete.
- Empty states: true-empty vs search-empty with distinct copy and CTA.

**Data / API**

- List endpoint returns a **lean summary** per robot (no full `recording.workflow` on list):
  - `id`, `name`, `type`, `updatedAt`
  - `schedule`: `{ enabled, label }` (human-readable or “Off”)
  - `lastRun`: `{ status, finishedAt }` (nullable)
- UI uses `?limit=&page=` (and total count) instead of fetching the entire collection by default.
- Row keys and all actions use `recording_meta.id`.

**Remove**

- Legacy inline “new recording” modal from the Job boards page (create only via `/robots/create`).

### Slice 2 — Create → Extract

- Mode switcher stays visible; Extract panel: URL, optional “needs login”, **Start recording**.
- No in-card logo.
- Harden single-browser limit warning; clear session storage on cancel/failure paths.
- Encourage a human name (prompt before save or immediately after recording) to reduce timestamp-only names.
- On start: open recording tab; return user to Job boards with clear “recording in progress” feedback when possible.

### Slice 3 — Create → Scrape / Crawl / Search

**Shared**

- Equal mode switcher (segmented control or 2×2 purpose cards).
- Persistent labels, helpers, consistent required markers.
- URL normalize/validate; disable CTA until valid.
- CTA: “Create scraper” (not “Create Robot”).
- Output formats: default `markdown`; screenshots opt-in with cost hint; full-page strongest warning.
- Isolate React state per mode (no shared `url` leakage).
- Unify post-create cache invalidation via `invalidateRecordings` (+ optimistic row where useful).
- Split `RobotCreate.tsx` into mode panels + shared primitives.

**Crawl**

- Advanced options remain collapsed by default.
- Default limit 50; enforce server max; warn when screenshots × page limit is expensive.
- Respect `robots.txt` default on.

**Search**

- Default mode: Discover URLs Only (cheaper).
- Formats only when Extract Data from Results is selected.
- Time Range always shows an explicit value (“No filter”).

### Slice 4 — Shared polish

- i18n for all create strings.
- A11y: labels, focus order, disabled CTA contrast.
- Brand/copy consistency (FirstStep product language on this surface; fix “Scrapper” typos in alt text where touched).
- Align nav label “Job boards” with page heading.

---

## Cost & compute controls

| Control | Behavior |
|---------|----------|
| List projection | Never send full workflows on list GET |
| Pagination | Server-side by default |
| Output defaults | Markdown only |
| Screenshots | Opt-in; UI cost copy; optional server reject/flag for full-page at high crawl limits |
| Crawl / search limits | Hard server caps (exact numbers set in implementation plan; UI mirrors them) |
| Extract | One browser recording session; no silent multi-spawn |

---

## Architecture notes

```text
UI (/robots, /robots/create)
  → GET /storage/recordings?limit&page   (lean summaries)
  → POST /storage/recordings/scrape|crawl|search  (validated + capped)
  → Extract path → recording-setup (existing browser session APIs)

List enrichment may join latest run status via:
  - denormalized fields on robot, or
  - a single aggregated query in the list handler
Avoid N+1 run fetches from the browser.
```

Keep MUI; redesign composition, density, and information architecture only. Reuse existing schedule/run/integrate routes from the overflow menu.

---

## Error handling

- Client: field-level validation before submit; toast on API failure with server message when present.
- Server: 400 for invalid URL/name/formats/limits; 409 for duplicate names (existing unique index).
- Extract browser conflict: blocking modal with discard-or-cancel (existing pattern, copy polished).
- Delete: confirm dialog (keep).

---

## Testing (minimum for this pass)

- Unit/integration: list summary shape; pagination; create validation/caps; row id actions.
- Manual: create each of 4 modes; list filters/search; run from list; schedule visible state; tab-switch state isolation; screenshot cost copy visible.
- Regression: recording start/stop; integrate/settings navigation still works from overflow.

---

## Success criteria

- User can create all four scraper types without confusion or leaked form state.
- List is scannable (type/status/schedule/last run) without downloading workflow JSON.
- Defaults favor low compute; expensive options are explicit.
- Screens feel intentionally designed, not sparse icon grids.

## Implementation order

1. Job boards list (API lean + UI redesign)  
2. Create Extract  
3. Create Scrape / Crawl / Search  
4. Shared polish (i18n, a11y, copy)  

---

## Spec self-review

- No TBD placeholders for product decisions; numeric hard caps deferred to implementation plan (called out explicitly).
- Scope matches locked decisions (near-term scale, four equal modes, vertical slices).
- Out-of-scope section prevents scope creep into platform rewrite.
