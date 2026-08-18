# Automations and Failure Dashboard Redesign & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/automations` and `/failures` production-ready, secure, responsive, accessible, and visually consistent with the FirstStep-inspired Scout-X dashboard.

**Architecture:** Work security-first. Stabilize server contracts and request behavior before decomposing the two monolithic pages into small feature components. Preserve existing React/MUI and FirstStep tokens, use server-owned identity and normalized run fields, and make all mutations idempotent or guarded against duplication.

**Tech Stack:** React 18, TypeScript, MUI, Axios/React Query, Express, Socket.IO, MongoDB/Mongoose, Agenda, Vitest/Jest, Testing Library, Playwright.

---

## Scope and delivery boundaries

This plan has six independently deployable phases:

1. **Immediate security fixes:** Socket.IO identity, SSRF, CSRF/CORS, response redaction, bounded destination settings.
2. **Run/retry correctness:** idempotency, active-run admission, retry lineage, normalized failure reasons.
3. **Frontend request correctness:** cancellation, exact query keys, mutation state, schedule bugs.
4. **Responsive application shell:** mobile drawer, focus management, skip link, global focus rings.
5. **Page redesign:** Automations and Failure Dashboard component decomposition and FirstStep visual treatment.
6. **Production scale:** indexed ownership/date fields, bounded details, query optimization and load tests.

Redis-distributed queue semaphores and materialized analytics are intentionally excluded from the first release. They become a separate infrastructure project after measurement proves they are necessary.

## Intended file structure

### New backend files

- `server/src/middlewares/socketAuth.ts` — verifies the Socket.IO caller and sets `socket.data.userId`.
- `server/src/middlewares/csrfOriginGuard.ts` — validates origins for cookie-authenticated unsafe methods.
- `server/src/utils/outboundUrlPolicy.ts` — central SSRF-safe URL validation and DNS/IP policy.
- `server/src/services/automationConfigView.ts` — creates public, redacted automation DTOs.
- `server/src/services/runAdmission.ts` — idempotent manual-run and retry admission.
- `server/src/scripts/backfillRunListFields.ts` — resumable backfill for owner, dates, failure reason, and retry lineage.

### New frontend files

- `src/components/feedback/LiveStatusRegion.tsx` — one reusable polite live region.
- `src/components/dashboard/AppShell.tsx` — responsive desktop/sidebar and mobile/drawer shell.
- `src/components/dashboard/SidebarContent.tsx` — shared navigation content for sidebar and drawer.
- `src/features/automations/automationQueries.ts` — query keys, fetchers, mutations, invalidation.
- `src/features/automations/*` — page hero, stats, filters, table/cards, actions, states, dialogs.
- `src/features/failures/failureQueries.ts` — failure query and mutation contracts.
- `src/features/failures/*` — page hero, reason summary, filters, table/cards, actions, and states.

Existing `AutomationsPage.tsx` and `FailureDashboardPage.tsx` become orchestration-only containers.

---

### Task 1: Authenticate queued-run Socket.IO connections

**Files:**
- Create: `server/src/middlewares/socketAuth.ts`
- Create: `server/src/middlewares/socketAuth.test.ts`
- Modify: `server/src/server.ts`
- Modify: `src/context/socket.tsx`

- [ ] **Step 1: Write failing server tests**

Cover:

```ts
it('rejects a socket without a verified session or API key');
it('ignores a caller-supplied userId');
it('sets socket.data.userId from the verified session');
it('prevents account A from joining account B room');
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```powershell
npm test -- socketAuth
```

Expected: tests fail because the current server trusts `handshake.query.userId`.

- [ ] **Step 3: Implement verified socket identity**

The middleware contract must be:

```ts
export async function authenticateSocket(socket: Socket, next: (error?: Error) => void) {
  const identity = await resolveVerifiedIdentity(socket.request, socket.handshake.auth);
  if (!identity?.userId) return next(new Error('unauthorized'));
  socket.data.userId = String(identity.userId);
  next();
}
```

Do not read identity from `socket.handshake.query.userId`. Join only:

```ts
socket.join(`user-${socket.data.userId}`);
```

Remove `query: { userId }` from the browser connection.

- [ ] **Step 4: Verify isolation**

Run the focused tests and a two-account socket integration test. Expected: account A receives only account A events.

---

### Task 2: Block SSRF for automation targets and webhooks

**Files:**
- Create: `server/src/utils/outboundUrlPolicy.ts`
- Create: `server/src/utils/outboundUrlPolicy.test.ts`
- Modify: `server/src/utils/automationUrl.ts`
- Modify: `server/src/api/automations.ts`
- Modify: `server/src/services/destinations.ts`
- Modify: `server/src/workers/scraperWorker.ts`
- Modify: `server/src/services/listExtractor.ts`

- [ ] **Step 1: Write URL-policy tests**

Required cases:

```ts
expectAllowed('https://careers.example.com/jobs');
expectBlocked('http://127.0.0.1:3000');
expectBlocked('http://localhost/admin');
expectBlocked('http://169.254.169.254/latest/meta-data');
expectBlocked('http://10.0.0.8');
expectBlocked('http://[::1]/');
expectBlocked('https://user:password@example.com/');
```

Also test DNS resolving to private space and a public URL redirecting to private space.

- [ ] **Step 2: Implement a single outbound policy**

Required API:

```ts
export async function assertSafeOutboundUrl(
  rawUrl: string,
  options?: { resolveDns?: boolean }
): Promise<URL>;
```

Rules:
- only `http:` and `https:`;
- no embedded credentials;
- reject loopback, RFC1918, link-local, multicast, IPv6 local/private, and metadata addresses;
- resolve hostnames immediately before execution;
- revalidate every redirect hop;
- cap redirects and response bytes.

- [ ] **Step 3: Apply at write time and execution time**

Configuration routes return:

```json
{ "code": "UNSAFE_OUTBOUND_URL", "field": "targetUrl", "error": "..." }
```

with HTTP 400. Workers and webhook delivery revalidate to prevent DNS rebinding.

- [ ] **Step 4: Run tests and manually probe blocked hosts**

Expected: internal addresses never reach Playwright, Axios, fetch, or webhook execution.

> **Operational caveat:** Node webhook/ATS traffic must use the pinned outbound
> transport so DNS answers are fixed for each connection. Chromium navigation
> routing is still advisory when a browser proxy is configured: the proxy can
> resolve and connect independently of this process. Production deployments
> therefore require a hardened egress proxy/firewall that blocks private,
> link-local, metadata, and reserved destination ranges; arbitrary proxy routes
> must not bypass that boundary.

---

### Task 3: Add CSRF/CORS guards, destination bounds, and formula neutralization

**Files:**
- Create: `server/src/middlewares/csrfOriginGuard.ts`
- Create: `server/src/middlewares/csrfOriginGuard.test.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/api/automations.ts`
- Modify: `server/src/services/destinations.ts`
- Modify: `src/pages/AutomationDataPage.tsx`

- [ ] **Step 1: Test unsafe cross-origin mutations**

Test POST, PUT, PATCH, and DELETE with:
- valid same-origin cookie;
- allowed production origin;
- disallowed origin;
- verified API key.

- [ ] **Step 2: Add `PATCH` to CORS methods**

Verify the failure-reason request succeeds in a cross-origin deployment.

- [ ] **Step 3: Enforce origin checks for cookie sessions**

Unsafe cookie-authenticated methods must require an allowed `Origin`. Verified API-key calls remain exempt.

- [ ] **Step 4: Validate webhook delivery settings**

Use a strict schema:

```ts
retryAttempts: integer().min(0).max(5)
retryDelaySeconds: integer().min(1).max(300)
timeoutSeconds: integer().min(1).max(30)
```

Enforce an overall delivery deadline.

- [ ] **Step 5: Neutralize spreadsheet formulas**

Before Google Sheets or CSV output:

```ts
const neutralizeSpreadsheetCell = (value: unknown) =>
  typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
```

Prefer `RAW` for Sheets when compatible with existing exports.

- [ ] **Step 6: Verify**

Expected: malicious cross-site forms fail, PATCH preflights pass for allowed origins, and formula-leading values remain literal.

---

### Task 4: Redact secret-bearing automation and run data

**Files:**
- Create: `server/src/services/automationConfigView.ts`
- Create: `server/src/services/automationConfigView.test.ts`
- Modify: `server/src/api/automations.ts`
- Modify: `server/src/services/automation.ts`
- Modify: `server/src/services/automationRun.ts`
- Modify: `src/api/automation.ts`

- [ ] **Step 1: Add snapshot tests with seeded secrets**

Seed proxy passwords, API keys, cookies, database URLs, webhook credentials, and runtime config. Assert none appear in list, failure, or run responses.

- [ ] **Step 2: Define explicit public DTOs**

Expose only fields required by the pages, including booleans such as:

```ts
{
  webhookConfigured: boolean;
  proxyConfigured: boolean;
  destinationType?: 'webhook' | 'airtable' | 'database' | 'none';
}
```

- [ ] **Step 3: Stop copying secrets into new Run documents**

Store secret references or resolve integration credentials server-side at execution time. Keep temporary backward-compatible reads during migration.

- [ ] **Step 4: Verify response snapshots and logs**

Expected: no secret values in API responses, browser memory snapshots, or structured logs.

---

### Task 5: Implement idempotent run and retry admission

**Files:**
- Modify: `server/src/models/Run.ts`
- Create: `server/src/services/runAdmission.ts`
- Create: `server/src/services/runAdmission.test.ts`
- Modify: `server/src/services/automationRun.ts`
- Modify: `server/src/services/runLifecycle.ts`
- Modify: `server/src/api/automations.ts`
- Modify: `src/api/automation.ts`

- [ ] **Step 1: Write concurrent-admission tests**

Verify:
- ten parallel manual-run calls create one active run;
- ten parallel retries with one idempotency key create one retry;
- retrying a non-terminal run fails;
- ownership is checked;
- a completed retry can be followed by a later retry with a new key.

- [ ] **Step 2: Extend Run fields**

Add:

```ts
ownerId: ObjectId;
sortAt: Date;
retryOfRunId?: string;
originalRunId?: string;
retrySequence?: number;
retryRequestKey?: string;
normalizedFailureReason?: FailureReason;
```

Create a unique sparse index on `{ ownerId: 1, retryRequestKey: 1 }`.

- [ ] **Step 3: Add retry endpoint**

```text
POST /api/runs/:runId/retry
Idempotency-Key: <uuid>
```

Responses:
- 201 created;
- 200 previously accepted key;
- 409 `AUTOMATION_RUN_ACTIVE`;
- 429 `ACCOUNT_RUN_LIMIT`.

- [ ] **Step 4: Route manual runs through the same admission service**

Enforce one active run per automation and a conservative per-account active limit.

- [ ] **Step 5: Release guards on every terminal path**

Cover completed, failed, dead, aborted, worker crash recovery, and enqueue failure. If enqueue fails after Run creation, mark the Run failed instead of leaving it pending.

- [ ] **Step 6: Verify parallel behavior**

Expected: parallel requests create one queue job and one Run record.

---

### Task 6: Normalize failure reasons and bound run details

**Files:**
- Modify: `server/src/utils/failureReason.ts`
- Modify: `server/src/models/Run.ts`
- Modify: `server/src/services/runLifecycle.ts`
- Modify: `server/src/api/automations.ts`
- Create: `server/src/scripts/backfillRunListFields.ts`
- Modify: `src/api/automation.ts`
- Modify: `src/pages/RunDetailsPage.tsx`

- [ ] **Step 1: Test one source of failure classification**

A CAPTCHA error lacking persisted `failureReason` must:
- display as CAPTCHA;
- count under CAPTCHA;
- appear when the CAPTCHA filter is selected.

- [ ] **Step 2: Persist `normalizedFailureReason`**

Lifecycle writes and operator overrides update the normalized field. List rows, filters, and reason counts all use it.

- [ ] **Step 3: Add bounded detail endpoints**

```text
GET /api/runs/:id
GET /api/runs/:id/logs?cursor=&limit=100
GET /api/runs/:id/rows?cursor=&limit=100
```

The metadata endpoint must never embed all rows/logs/screenshots.

- [ ] **Step 4: Build a resumable backfill**

Backfill in batches:
- `ownerId`;
- `sortAt`;
- `normalizedFailureReason`;
- retry root fields.

Record checkpoints, dry-run counts, malformed rows, and old/new reason-count comparisons.

- [ ] **Step 5: Verify**

Expected: old/new counts reconcile and response size stays bounded for a run with 100,000 rows.

---

### Task 7: Fix frontend request races and scheduling correctness

**Files:**
- Create: `src/features/automations/automationQueries.ts`
- Create: `src/features/failures/failureQueries.ts`
- Modify: `src/api/automation.ts`
- Modify: `src/pages/AutomationsPage.tsx`
- Modify: `src/pages/FailureDashboardPage.tsx`
- Modify: `src/components/robot/ScheduleModal.tsx`
- Modify: `src/components/robot/CronBuilder.tsx`

- [ ] **Step 1: Add component tests for known bugs**

Required tests:
- rapid filter changes render only the newest result;
- changing a filter from page 4 sends only the page-1 query;
- stale checks include all active filters;
- a paused schedule opens paused;
- saving unchanged paused schedule does not resume it;
- CronBuilder does not trigger an update loop.

- [ ] **Step 2: Add exact query keys and cancellation**

Keys include page, page size, name, ID, tags, schedule, status, anomaly, reason, and time window. Pass query `AbortSignal` through Axios.

- [ ] **Step 3: Reset pagination in filter handlers**

Set filter and page together in a reducer/event handler. Remove the second page-reset effect.

- [ ] **Step 4: Debounce socket invalidation**

Coalesce event bursts into one invalidation and invalidate only relevant keys.

- [ ] **Step 5: Model schedule state explicitly**

Pass `currentEnabled` and `currentPaused`. Support:
- active schedule;
- paused schedule with cron preserved;
- disabled schedule with no cron.

- [ ] **Step 6: Stabilize CronBuilder**

Use primitive `cron` and `timezone` props. Compare next values before `onChange`; never depend on a newly allocated parent object.

- [ ] **Step 7: Verify**

Expected: no stale overwrites, duplicate requests, accidental resume, or maximum-update-depth error.

---

## Visual design contract

The two pages must look like extensions of the redesigned Scout-X `/dashboard`, using visual cues extracted from the real `FIRSTSTEP/front` landing page. They must not become generic MUI admin tables.

### Source references

- `FIRSTSTEP/front/src/firstStepComponents/firstStepMarketing/Hero.tsx`
  - Geologica typography;
  - navy/teal atmospheric gradients;
  - blurred teal/navy shapes;
  - strong dark/light hierarchy;
  - pill CTAs and subtle glass surfaces.
- `src/pages/DashboardPage.tsx`
  - compact static `HERO_GRADIENT` header;
  - restrained background blobs;
  - overline → large title → muted description hierarchy;
  - translucent status pill;
  - white gradient cards below the hero.
- `src/components/dashboard/ops/dashboardTokens.ts`
  - canonical color, radius, shadow, animation, and card recipes.

### Required tokens

Use these existing shared tokens rather than adding page-local color values:

```ts
FIRSTSTEP.navy = '#023345';
FIRSTSTEP.navyDeep = '#002941';
FIRSTSTEP.navyInk = '#001d29';
FIRSTSTEP.teal = '#4fb3a9';
FIRSTSTEP.tealDark = '#2a8e9e';
FIRSTSTEP.tealDeep = '#357a7a';
FIRSTSTEP.surface = '#f8f9fa';
FIRSTSTEP.surfaceAlt = '#f8fafc';
FIRSTSTEP.border = '#e2e8f0';
RADIUS.card = '16px';
RADIUS.panel = '20px';
RADIUS.control = '12px';
RADIUS.pill = '9999px';
```

Semantic status colors may use `FIRSTSTEP.success`, `danger`, and `warning`, but status must always include text/icon—not color alone.

### Page composition

Both pages use the same vertical rhythm:

1. **Hero panel:** `20px` radius, static navy→teal gradient, one or two blurred shapes, `24–28px` desktop padding and `20px` mobile padding.
2. **Summary row:** operational cards overlapping visually with or immediately following the hero; `16px` radius and `16px` grid gaps.
3. **Filter workspace:** one white gradient card grouping search and filters, with active filters represented by removable pills.
4. **Data workspace:** desktop table inside a `16px` card; mobile card list at `<900px`.
5. **Pagination/status footer:** result range, refresh state, pagination, and page size presented as one coherent footer.

### Typography and hierarchy

- Font: existing Geologica variable font.
- Hero overline: `0.68rem`, weight `700`, tracking `0.18em`, teal.
- Page title: `1.9rem` mobile / `2.4rem` desktop, weight `700`, line height `1.12`, tracking `-0.03em`.
- Hero description: `0.875rem`, white at approximately 72% opacity, maximum width `560px`.
- Card headings: `1rem–1.125rem`, weight `700`.
- KPI values: `1.9rem–2.15rem`, weight `700`, tabular numerals.
- Table body: never below `0.8125rem`; avoid the unreadable 10–11px text visible in the current screenshots.

### Cards, elevation, and motion

- Use `cardSx()` for content cards and `cardSx(statusColor)` for summary cards with the 4px FirstStep accent bar.
- Resting shadow: subtle `0 1px 2px rgba(2, 51, 69, 0.04)`.
- Interactive cards may lift at most `4px`; tables and filter panels must not lift.
- Entrance animation uses `fadeUpSx()` only for the hero and summary cards. Do not animate every row.
- All motion must stop under `prefers-reduced-motion`.
- Do not copy the landing page's continuously cycling eight-second gradient into admin pages; a static gradient preserves brand while avoiding distraction and GPU cost.

### Buttons and controls

- One filled primary action per page:
  - Automations: **New automation**.
  - Failures: no destructive/global primary CTA; **Refresh** remains secondary.
- Primary buttons use navy or teal contrast and `RADIUS.pill`.
- Secondary controls use white/glass surfaces with visible borders.
- Destructive actions stay in menus/dialogs and use semantic red only at the decision point.
- Every control has a minimum 40px desktop height and 44px mobile target.

### Desktop data workspace

- Sticky table header with `FIRSTSTEP.surfaceAlt`.
- Row height target: `56–64px`, not the current compressed action-button strip.
- Use a 4px left status marker or status icon plus text.
- Keep one obvious row action and move secondary actions into a labelled overflow menu.
- Error text is clamped to two lines with a Details route for complete diagnostics.
- Hover uses a pale teal row tint, not elevation.

### Mobile data workspace

- At widths below `900px`, replace tables with cards; do not merely add horizontal page scroll.
- Card header: name/status; body: two-column definition list for essential metadata; footer: primary action and overflow menu.
- Filters stack to one column below `600px`; summary cards use two columns where possible and one column at narrow zoom widths.

### Dark mode

- Use theme-aware surfaces from `cardSx()` and existing MUI palette.
- Do not hardcode white text on light cards or black surfaces in page components.
- Verify status, focus, border, disabled, and hover contrast independently in both themes.

### Visual acceptance gates

- `/automations`, `/failures`, and `/dashboard` must read as one product when viewed side by side.
- Capture screenshots at `1440×900`, `1024×768`, `768×1024`, and `375×812`.
- No text below the minimum scale, clipped actions, page-level horizontal overflow, or unstyled MUI defaults.
- Compare screenshots in light and dark mode; intentional page-specific danger accents are allowed, but spacing, cards, typography, controls, and navigation remain shared.

---

### Task 8: Build the responsive and accessible app shell

**Files:**
- Create: `src/components/dashboard/AppShell.tsx`
- Create: `src/components/dashboard/SidebarContent.tsx`
- Modify: `src/components/dashboard/MainMenu.tsx`
- Modify: `src/pages/MainPage.tsx`
- Modify: `src/pages/PageWrapper.tsx`
- Modify: `src/context/theme-provider.tsx`
- Create: `src/components/dashboard/AppShell.test.tsx`

- [ ] **Step 1: Test shell behavior**

Test desktop collapse, mobile drawer open/close, route-close behavior, skip link, focus movement, and reduced motion.

- [ ] **Step 2: Share one navigation tree**

Desktop uses the existing collapsible sidebar. Below the desktop breakpoint, render the same `SidebarContent` in a temporary MUI Drawer.

- [ ] **Step 3: Add landmarks and bypass navigation**

Render:

```tsx
<a className="skip-link" href="#main-content">Skip to main content</a>
<main id="main-content" tabIndex={-1}>{children}</main>
```

Move focus to the page heading/main region only on route changes.

- [ ] **Step 4: Add global focus-visible styling**

Buttons, links, chips, pagination, fields, menus, and icon buttons receive a 2px high-contrast ring with offset. Preserve native outlines unless the replacement is visible.

- [ ] **Step 5: Verify reflow**

At 320 CSS pixels/400% zoom, navigation becomes a drawer and no page-level horizontal scroll is required.

---

### Task 9: Redesign `/automations`

**Files:**
- Modify: `src/pages/AutomationsPage.tsx`
- Create:
  - `src/features/automations/AutomationsHero.tsx`
  - `src/features/automations/AutomationStats.tsx`
  - `src/features/automations/AutomationFilters.tsx`
  - `src/features/automations/AutomationTable.tsx`
  - `src/features/automations/AutomationCardList.tsx`
  - `src/features/automations/AutomationRowActions.tsx`
  - `src/features/automations/AutomationEmptyState.tsx`
  - `src/features/automations/AutomationSkeleton.tsx`
  - `src/features/automations/AutomationDialogs.tsx`
  - `src/features/automations/AutomationsPage.test.tsx`

- [ ] **Step 1: Test state variants and mutations**

Cover account-empty, filtered-empty, first-load skeleton, background refresh, load error with retry, per-row pending actions, delete confirmation, and duplicate Run clicks.

- [ ] **Step 2: Build the FirstStep page hierarchy**

Reuse `FIRSTSTEP`, `HERO_GRADIENT`, `cardSx`, `RADIUS`, and `tint`.

Page structure:
1. compact navy/teal hero with the overline “Automation operations”, title, freshness status pill, secondary Refresh/Pause controls, and one teal **New automation** pill CTA;
2. five FirstStep accent-bar KPI cards for total automations, rows extracted, successful latest runs, failed latest runs, and scheduled-active;
3. white gradient filter workspace with search, Scout ID, schedule, tags, removable active-filter pills, result count, and Clear all;
4. desktop table or mobile card list inside the shared data-workspace card;
5. contextual dialogs, pagination footer, and live status region.

Hero details:
- use the same height, `20px` radius, shadow, title scale, overline, and static blobs as `/dashboard`;
- use a compact status pill such as “80 automations · updated 2m ago”;
- keep bulk pause/resume visually secondary because it affects every schedule.

KPI details:
- use icon chips and tabular numerals like the dashboard `StatCard`;
- labels must clarify that success/failure/rows are latest-run summaries;
- keep colors consistent: navy total, teal rows/scheduled, accessible green success, red failure.

Filter details:
- default state uses one row on wide desktop, two rows on tablet, one column on mobile;
- advanced tags stay progressively disclosed;
- changing a filter shows retained results plus a subtle loading bar rather than blanking the page.

- [ ] **Step 3: Reduce desktop table density**

Keep:
- Automation: name, Scout ID, company;
- Health: explicit latest-run status and failure indicator;
- Activity: localized last run;
- Output: rows from latest run;
- Schedule: active/paused/manual plus relative next run;
- Actions: Run plus overflow menu.

Move raw URL, tags, raw cron, copy-ID controls, and secondary navigation into an expandable details panel or overflow menu. The target URL remains available as a safe external link.

- [ ] **Step 4: Simplify actions**

Expose one primary action (Run) and one labelled overflow menu. Include automation name in every accessible action name.

- [ ] **Step 5: Add mutation guards**

Track pending state by `{automationId, action}`. Disable duplicate submission, show inline failure/retry, and keep unrelated rows interactive.

- [ ] **Step 6: Verify**

Keyboard-test filters, overflow menus, pagination, dialogs, and all row actions at desktop and 375px.

---

### Task 10: Redesign `/failures`

**Files:**
- Modify: `src/pages/FailureDashboardPage.tsx`
- Create:
  - `src/features/failures/FailuresHero.tsx`
  - `src/features/failures/FailureReasonSummary.tsx`
  - `src/features/failures/FailureFilters.tsx`
  - `src/features/failures/FailureTable.tsx`
  - `src/features/failures/FailureCardList.tsx`
  - `src/features/failures/FailureRowActions.tsx`
  - `src/features/failures/FailureEmptyState.tsx`
  - `src/features/failures/FailureSkeleton.tsx`
  - `src/features/failures/FailureDashboardPage.test.tsx`

- [ ] **Step 1: Test filtering and retry semantics**

Cover normalized reason counts, labelled selects, page clamping after mutation, retry idempotency, active-run conflict, stale-response cancellation, and load errors.

- [ ] **Step 2: Build the FirstStep page hierarchy**

Page structure:
1. shared navy/teal hero with the overline “Run reliability”, title, selected-window status pill, window selector, and secondary Refresh button;
2. a compact reason-summary strip using accent-bar cards rather than the current tiny chips: All, Layout change, CAPTCHA, Browser closed, Navigation, Timeout, Host circuit, and Unknown;
3. responsive white gradient filter workspace with search, status, reason, anomaly, active-filter pills, result count, and Clear all;
4. desktop TableContainer or mobile failure cards within the shared data-workspace card;
5. pagination footer, live status region, and contextual error states.

The danger treatment must be restrained:
- retain the shared navy/teal hero;
- use red only for terminal failure count, row status, and Retry confirmation;
- do not turn the whole page red or introduce a separate visual system.

Reason summary:
- display icon, human label, and count;
- selected state uses a visible border/background plus `aria-pressed`;
- use horizontal wrapping on tablet and a two-column grid on mobile;
- keep taxonomy labels human-readable (“Browser closed”, not internal codes).

- [ ] **Step 3: Improve row information hierarchy**

Desktop columns:
- Automation: name plus Scout ID;
- Status: Failed/Dead with icon and text;
- Reason: editable, uniquely labelled select;
- Error: two-line summary;
- Anomaly: explicit text chip;
- Timing: started and duration; finished time moves into details;
- Attempts: label consistently as attempts or retries;
- Actions: Details plus guarded Retry.

Mobile cards show automation/status first, then reason/error, timing/attempts, and a footer with Details and Retry. Keep raw diagnostics, timestamps, screenshots, logs, and extracted rows behind Details.

- [ ] **Step 4: Make retry operationally clear**

Confirmation states that retry creates a new run from current automation configuration. On 409, show the active run and link to it. On success, show the new run and retry lineage.

- [ ] **Step 5: Add accessible controls**

Connect every filter `InputLabel`/`Select`, uniquely label each row reason control, add a table caption, use `aria-busy`, and announce result counts.

- [ ] **Step 6: Verify**

At 375px render cards with no horizontal page overflow. At desktop use a contained table. Keyboard-test every filter, reason override, Details, and Retry.

---

### Task 11: Optimize production queries and indexes

**Files:**
- Modify: `server/src/models/Run.ts`
- Modify: `server/src/models/Robot.ts`
- Modify: `server/src/api/automations.ts`
- Modify: `server/src/services/opsMetrics.ts`
- Modify: `server/src/scripts/backfillRunListFields.ts`
- Create: `server/src/services/dashboardQueries.test.ts`

- [ ] **Step 1: Capture explain plans and baseline latency**

Use representative accounts with 100, 10,000, and 100,000 runs. Record documents examined, index used, p50, and p95.

- [ ] **Step 2: Add post-backfill indexes**

```ts
{ ownerId: 1, sortAt: -1, _id: -1 }
{ ownerId: 1, status: 1, sortAt: -1 }
{ ownerId: 1, normalizedFailureReason: 1, sortAt: -1 }
{ ownerId: 1, robotMetaId: 1, sortAt: -1 }
```

- [ ] **Step 3: Query Run directly by owner**

Stop loading every Robot only to build a large `$in`. Stop converting date strings during every aggregation.

- [ ] **Step 4: Bound summary work**

Project only required fields and cache account/filter summaries for a short TTL. Do not cache raw secret-bearing config.

- [ ] **Step 5: Re-run explain plans and load tests**

Gate: intended compound indexes are used and p95 remains within the agreed production budget.

---

### Task 12: Final integration, accessibility, security, and release gates

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts` or current test configuration
- Create: `e2e/automations.spec.ts`
- Create: `e2e/failures.spec.ts`
- Update: `SCOUTX_JOB_PIPELINE_GUIDE.md`

- [ ] **Step 1: Add missing frontend test tooling**

Configure jsdom, Testing Library, user-event, and axe integration using repository-compatible versions.

- [ ] **Step 2: Run complete verification**

```powershell
npm test
npm run lint
npm run build
npm run build:server
npm run test:e2e
```

Expected: all new tests pass. Existing unrelated failures must be recorded and separated rather than hidden.

- [ ] **Step 3: Run accessibility verification**

Test keyboard-only use, axe, 400% zoom, reduced motion, light/dark contrast, 375px, 768px, 1024px, and 1440px.

- [ ] **Step 4: Run security verification**

Verify:
- cross-account sockets fail;
- internal/metadata URL probes fail;
- parallel retry creates one run;
- cross-site cookie mutations fail;
- response snapshots contain no secrets;
- formula-leading values are exported literally.

- [ ] **Step 5: Stage rollout**

1. Deploy compatible schema additions and dual reads.
2. Run dry-run backfill and reconcile counts.
3. Run live backfill in batches.
4. Build indexes.
5. Enable normalized queries and retry endpoint.
6. Deploy frontend redesign.
7. Observe queue depth, API p95, error rate, and retry conflicts.

- [ ] **Step 6: Document rollback**

Frontend rollback must remain compatible with dual-read APIs. Backend rollback must preserve added fields/indexes and avoid deleting retry lineage or normalized reason data.

---

## Review checklist

- Security and correctness land before visual polish.
- Existing ownership checks, escaped regex search, failure-reason allowlist, cron/timezone validation, React escaping, and `noopener` handling remain intact.
- No task depends on Redis or materialized analytics.
- Both pages support real loading, refresh, error, account-empty, and filtered-empty states.
- All repeated row actions have unique accessible names and pending guards.
- Both pages are usable without horizontal page scrolling at 320 CSS pixels.
- Failure rows, reason counts, and reason filters use the same normalized classification.
- Retry is a new, linked, idempotent run—not an ambiguous replay of old runtime state.
