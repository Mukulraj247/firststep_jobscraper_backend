# Scout-X — Best Deployment Platforms (Product / SaaS Decision Guide)

**Goal:** Choose where to host Scout-X so you can later **sell it as a standalone product** (customer buys access to monitor / scrape jobs for particular sites), **or** use it as a **separate job-board scraper** next to First Step.

### Scope with First Step (keep separate)

| System | Role | Deploy |
|--------|------|--------|
| **First Step** (`front` / `back` / `resume_builder`) | Main product: Auth0, users, payments, resume, app API | Its **own** host (already on Render / etc.) |
| **Scout-X** (this repo) | **Job board list scraping only** (schedules + Playwright) | **Separate** service — do **not** merge into the First Step backend |

First Step can call Scout-X over HTTP/API when it needs board data. They do **not** share one process, one Render service, or one deploy pipeline.

This is **not** locked to Render. Render free is only for light testing. Selling / running the scraper needs a host that can run **Chromium + an always-on scheduler** reliably.

---

## 1. What this project needs from a host

Scout-X is not a normal CRUD SaaS. The hard parts are the scraper and scheduler.

| Component | Requirement | Why it matters |
|-----------|-------------|----------------|
| **API** (Express + Socket.IO) | Always reachable HTTPS, WebSockets | UI + Chrome extension live updates |
| **Worker** (Agenda + Playwright) | Always-on **or** wake-on-schedule; **≥2 GB RAM** | Free 512 MB OOMs; sleeping hosts miss crons |
| **Browser** (Chromium / Camoufox) | Hundreds of MB–GB RAM, disk for browser binaries | The #1 cost and failure mode |
| **Database** | Managed MongoDB (Atlas is already fine) | Users, robots, runs, Agenda jobs |
| **Frontend** | Static files (Vite build) | Easy anywhere |
| **Optional storage** | S3-compatible or Firebase Storage | Screenshots / binary output |

### Hard rules for a sellable product

1. **Do not sell on a sleeping free web tier** — schedules will miss fires.
2. **Do not run Chromium on 512 MB** — OOM loops destroy trust.
3. **Keep MongoDB external** (Atlas) on every platform — don’t self-host Mongo on the same tiny box unless you know why.
4. **Separate “UI” from “scraper” as you grow** — one heavy scrape must not kill login/API for all customers.

---

## 2. Scorecard (how each platform fits *this* product)

Legend: **Great** / **OK** / **Poor** / **Wrong tool**

| Platform | Always-on cron | Chromium / RAM | Ops difficulty | Cost at small sales | Fit to sell this product |
|----------|----------------|----------------|----------------|---------------------|--------------------------|
| **DigitalOcean Droplet** | Great | Great (pick RAM) | Medium | Low–medium | **Best default** |
| **Hetzner Cloud VPS** | Great | Great | Medium | Lowest | **Best value** |
| **Railway** | Great (paid) | OK–Great | Low | Medium | Strong PaaS choice |
| **Render (paid)** | Great | OK if sized | Low | Medium–high | Fine if you stay on Render |
| **Render (free)** | Poor (sleep) | Poor (512 MB) | Low | “Free” but burns hours | **Demo only** |
| **Fly.io** | OK–Great | OK (size machines) | Medium–high | Medium | Good if you like Fly |
| **AWS (EC2 / ECS)** | Great | Great | High | Medium–high early | Best later / enterprise |
| **Google Cloud (GCE / Cloud Run)** | Mixed | Mixed | High | Medium–high | Possible; careful with Cloud Run |
| **Firebase** | Wrong for scraper | Wrong | Low for auth/hosting | Low for frontend | **Frontend/auth/storage only** |
| **Vercel / Netlify** | Wrong for worker | Wrong | Low | Low | **Frontend only** |
| **Browserless / Browserbase** | N/A (browser API) | Great (theirs) | Medium | Usage-based | **Best add-on at scale** |
| **Azure App Service** | OK | OK | Medium–high | Medium–high | Viable, not simplest |

---

## 3. Platform-by-platform analysis

### 3.1 DigitalOcean Droplet — **recommended for first paid customers**

**What it is:** A Linux VPS you control (like a small dedicated server).

**How to run Scout-X**

| Piece | Where |
|-------|--------|
| Frontend | DO Spaces + CDN, or Cloudflare Pages, or Nginx on same droplet |
| API + Agenda + Playwright | One Droplet (start), or Droplet A = API / Droplet B = worker later |
| MongoDB | Atlas |
| Screenshots | DO Spaces or Firebase Storage |

**Suggested sizes**

| Stage | Droplet | Notes |
|-------|---------|--------|
| First sales / few customers | **2 GB RAM / 1–2 vCPU** (~$12–18/mo) | `SCRAPER_WORKER_CONCURRENCY=1` |
| Safer small product | **4 GB RAM** (~$24/mo) | Concurrency 2–3, fewer OOMs |
| Growing | API on 2 GB + worker on 4 GB | Isolate scrapes from API |

**Pros**
- No sleep; schedules actually run.
- You buy RAM explicitly (what Chromium needs).
- Predictable monthly cost — easy to price your product.
- Full control (proxies, Camoufox, system deps).

**Cons**
- You handle OS updates, Nginx, SSL (or use Caddy), deploys (Docker/GitHub Actions).
- Backups and monitoring are your job.

**Verdict:** Best “sell this product” starting host for most indie/founders.

---

### 3.2 Hetzner Cloud — **best price/performance**

Same idea as DigitalOcean: a VPS with enough RAM.

**Pros:** Often cheaper RAM than DO/AWS; excellent for EU customers.  
**Cons:** Slightly more DIY; payment/region considerations for some US buyers.

**Verdict:** If cost matters and you’re OK with VPS ops, pick Hetzner over DO.

---

### 3.3 Railway — **best managed PaaS if you hate servers**

**What it is:** Git push → services (web + worker), usage-based billing.

**How to run Scout-X**
- Service 1: API (`RUN_EMBEDDED_WORKERS=false` when scaled)
- Service 2: Worker (`npm run worker`) with **≥2 GB**
- Frontend: Railway static or Cloudflare Pages
- MongoDB: Atlas

**Pros**
- Fast deploys, env UI, logs, no SSH required.
- Always-on paid services (unlike Render free sleep).

**Cons**
- Can get expensive as RAM/hours grow.
- Less control than a VPS for custom browser/system packages.

**Verdict:** Excellent if you want product velocity and will pay for convenience.

---

### 3.4 Render — **OK paid; free = testing only**

| Tier | Use for Scout-X? |
|------|------------------|
| **Free web** | Smoke tests only (sleep + 512 MB) |
| **Paid web + background worker** | Viable production if worker has enough RAM |

**Pros:** You already know it; Blueprint/`render.yaml` exists.  
**Cons:** Free plan is a bad product host; paid RAM is not the cheapest.

**Verdict:** Stay for demos; move off free before selling. Paid Render is fine, not optimal cost.

---

### 3.5 Fly.io — **good for global / scale-to-zero experiments**

**Pros:** Machines API, regions, can run Docker with Chromium.  
**Cons:** More concepts (machines, volumes, concurrency); scale-to-zero can miss crons unless you keep a machine running.

**Verdict:** Strong for teams comfortable with Fly; keep at least one always-on machine for Agenda.

---

### 3.6 AWS (Amazon Web Services)

AWS is a **toolbox**, not one product. Relevant pieces:

| AWS service | Role for Scout-X | Fit |
|-------------|------------------|-----|
| **EC2** | Same as Droplet: run Node + Chromium | Great (ops like VPS) |
| **ECS / Fargate** | Containers for API + worker | Great at scale; more setup |
| **Lambda** | Short functions | **Poor** for long Playwright jobs (timeouts/cold starts) |
| **EventBridge + ECS tasks** | Schedule → run scrape task | Good serverless-*ish* pattern |
| **S3** | Screenshots, exports | Great |
| **DocumentDB / Atlas** | DB | Prefer **Atlas**; DocumentDB is Mongo-compatible but different ops |
| **API Gateway + ALB** | Front the API | Overkill early |
| **CloudWatch** | Logs/metrics | Great later |

**When AWS makes sense**
- Enterprise customers ask for AWS / SOC2 / VPC.
- You need autoscaling workers and multi-region later.

**When it does not**
- First 1–20 customers — too much setup vs DO/Railway.

**Rough early cost:** EC2 `t3.small`/`t3.medium` (2–4 GB) often lands similar or higher than DO once you add ALB, egress, etc.

**Verdict:** Best **later / enterprise**. Not the best first sales host unless you already live in AWS.

---

### 3.7 Google Cloud Platform (GCP)

| GCP service | Role | Fit |
|-------------|------|-----|
| **Compute Engine (VM)** | Like Droplet | Great |
| **Cloud Run** | Containers, scales to zero | **Risky for Agenda** unless min instances ≥ 1; Chromium is heavy/awkward |
| **Cloud Run jobs** | One-shot scrape containers | OK pattern (schedule → job) |
| **GKE** | Kubernetes | Overkill early |
| **Firebase** (see below) | Auth/hosting/storage | Partial |
| **Cloud Storage** | Screenshots | Great |
| **Scheduler** | Cron triggers | Good with Cloud Run jobs / GCE |

**Cloud Run caution:** Default scale-to-zero = no Agenda loop. You’d redesign around “Scheduler kicks a job that launches browser, then exits.” That’s a valid architecture rewrite, not a drop-in deploy.

**Verdict:** Compute Engine ≈ DO. Cloud Run only if you **change** the worker model. Not the simplest path.

---

### 3.8 Firebase — **not a full host for this app**

Firebase is great for **parts**, wrong as the **only** backend for Scout-X.

| Firebase piece | Use with Scout-X? |
|----------------|-------------------|
| **Hosting** | Yes — frontend SPA |
| **Authentication** | Optional — replace/augment your JWT auth (migration work) |
| **Cloud Firestore** | **No drop-in** — app is built on **MongoDB + Mongoose + Agenda** |
| **Cloud Functions** | **Poor** for Playwright (timeouts, no durable Chromium, cold starts) |
| **Storage** | Yes — screenshots / exports (you already have Firebase hooks in the codebase) |
| **Extensions / cron** | Cannot replace Agenda + browser worker cleanly |

**Correct Firebase usage**

```text
Firebase Hosting     → UI
Firebase Storage     → screenshots (optional)
Your Node worker     → on DO / Railway / EC2 / GCE  (Chromium + Agenda)
MongoDB Atlas        → source of truth
```

**Verdict:** Use Firebase for **frontend and optional storage/auth**. Do **not** try to run the scraper “on Firebase.”

---

### 3.9 Vercel / Netlify / Cloudflare Pages — **frontend only**

| Can host | Cannot host well |
|----------|------------------|
| Vite React UI | Agenda always-on worker |
| | Playwright Chromium scrapes |
| | Long Socket.IO scrape sessions on serverless |

**Verdict:** Put the **UI** here; put **API + worker** elsewhere.

---

### 3.10 Browser-as-a-Service (Browserless, Browserbase, Scraping Browser)

**Idea:** Your API/worker stays light; browsers run in a specialized cloud.

```text
Customer → Your API (small) → Queue → Worker (small)
                                    ↓
                           Browserless / Browserbase
                                    ↓
                              Target job site
```

**Pros**
- Huge reduction in your OOM / RAM problems.
- Scale many customers without stuffing Chromium on your VPS.
- Better story for a SaaS product.

**Cons**
- Per-minute / per-session cost.
- Need remote Playwright connect (`BROWSER_WS_*` style) wiring and hardening.
- Still need your own always-on **scheduler** process (or cloud cron that enqueues jobs).

**Verdict:** Best **scale-up architecture** after first sales work on a simple VPS/PaaS.

---

### 3.11 Azure

App Service + Container Apps + Blob Storage can work, similar to AWS/GCP complexity.

**Verdict:** Fine if the customer requires Azure; otherwise prefer DO/Railway/AWS.

---

## 4. Recommended architectures by stage

### Stage A — Testing now (you are here)

```text
Render Free API+worker (LOW_MEMORY_MODE)
MongoDB Atlas
Static frontend
UptimeRobot ping (optional, if you need cron awake)
```

**Purpose:** Prove scrapes work. **Not** for selling.

---

### Stage B — Sell as a product (first buyers) ★

```text
┌─────────────────────┐     ┌──────────────────────┐
│ Cloudflare Pages /  │     │ DigitalOcean 2–4 GB  │
│ Firebase Hosting    │────▶│ Node API + Agenda +  │
│ (frontend)          │     │ Playwright worker    │
└─────────────────────┘     └──────────┬───────────┘
                                       │
                                       ▼
                              ┌────────────────┐
                              │ MongoDB Atlas  │
                              └────────────────┘
```

**Env ideas:** `SCRAPER_WORKER_CONCURRENCY=1–2`, no free-tier sleep, ≥2 GB RAM.

**Monthly ballpark (infra only):** ~$15–40 + Atlas free/shared tier.

---

### Stage C — Multiple customers / SaaS

```text
Frontend (Pages/Hosting)
    → API service (1–2 GB, always on)
    → Worker service (2–4+ GB) OR Browserless
    → MongoDB Atlas (M10+ when needed)
    → Object storage (S3 / DO Spaces / Firebase Storage)
    → Proxies (per customer or shared pool)
```

Add: per-tenant rate limits, concurrency caps, billing, usage metering.

---

### Stage D — Enterprise / compliance

AWS (ECS/EC2) or GCP (GCE/GKE) in customer region, private networking, CloudWatch/Stackdriver, SSO, etc.

---

## 5. Cost & “can I sell this?” cheat sheet

| Goal | Pick | Avoid |
|------|------|--------|
| Demo / friends | Render free | Promising daily SLA |
| Sell to first users | **DO / Hetzner 2–4 GB** or **Railway ≥2 GB** | Free sleeping hosts |
| Lowest ops | Railway / Render paid | Raw AWS on day 1 |
| Lowest $ / RAM | **Hetzner** then DO | Oversized AWS |
| Many tenants scraping | API + **Browserless** + Atlas | One 2 GB box for everyone |
| “We need AWS/GCP” contract | EC2/GCE or ECS | Firebase-only |

---

## 6. Firebase vs AWS vs Google — plain answers

### Firebase?
**Not as the scraper host.**  
**Yes** for: Hosting (UI), Storage (files), maybe Auth later.  
**No** for: replacing MongoDB/Agenda/Playwright.

### AWS?
**Yes as a serious long-term home** (EC2/ECS + S3 + cron patterns).  
**Overkill** for first sales unless you already use AWS.

### Google Cloud?
**Yes via Compute Engine** (same as a Droplet).  
**Cloud Run** only with a redesigned job model (min instances or one-shot jobs).  
**Firebase** alone cannot run this product’s core.

### So what’s “best” overall?
For **selling Scout-X as a standalone job-site product** soonest with least drama:

> **#1 DigitalOcean or Hetzner VPS (≥2 GB) + MongoDB Atlas + static frontend**  
> **#2 Railway (API + fat worker)** if you want managed deploys  
> **#3 Add Browserless-class browsers** when customer count / concurrency grows  
> **#4 AWS/GCP** when enterprise or scale demands it  

Render free stays a **lab**, not the storefront.

---

## 7. Product packaging note (how hosting affects what you sell)

Customers buying “job checks for a particular site” care about:

1. **Schedule reliability** (daily 9am really runs)
2. **Fresh rows** in their dashboard / Sheets
3. **Uptime of login + API**

That means your price must fund:
- Always-on compute (or reliable wake + queue)
- Enough RAM for their target sites
- Optionally proxies (many job boards block datacenter IPs)

**Example pricing sanity check**

| Your infra | Suggest customer plan |
|------------|------------------------|
| One 2 GB droplet shared | Few customers, 1 site each, 1–2 runs/day |
| 4 GB + concurrency limits | Small SaaS tier |
| Browserless + metered runs | Usage-based (“N scrapes / month”) |

Don’t underprice a plan that requires Chromium 24/7 on free Render.

---

## 8. Decision checklist (pick one and ship)

Answer these, then choose:

1. Do you want **SSH/Docker yourself**? → **DO / Hetzner**  
2. Do you want **git push only**? → **Railway** (or Render paid)  
3. Is the buyer an **enterprise on AWS/GCP**? → Match their cloud  
4. Will you have **many concurrent browsers** soon? → Plan **Browserless** early  
5. Are you still validating? → Stay on **Render free** with tiny load  

---

## 9. Related docs in this repo

- `docs/DIGITALOCEAN-SCOUT-X-SETUP-FOR-BEGINNERS.md` — click-by-click DigitalOcean Droplet deploy  
- `docs/HETZNER-SCOUT-X-SETUP-FOR-BEGINNERS.md` — click-by-click Hetzner Cloud deploy  
- `docs/SCHEDULER-AND-SCRAPER.md` — how Agenda + engines work  
- `docs/render-deployment.md` — Render-specific setup  
- `docs/render-free-tier-env.md` — free-tier env / memory knobs  
- `docs/production-deployment.md` — general production notes  

---

## 10. One-line summary

**Best path to sell this:** host the **scraper worker on a ≥2 GB always-on VPS (DigitalOcean/Hetzner) or Railway**, keep **MongoDB on Atlas**, put the **UI on Firebase Hosting / Cloudflare Pages**, use **Firebase Storage/S3 only for files**, and treat **Firebase/AWS Lambda/Vercel as the wrong place to run Playwright.** Move to **AWS/GCP or Browserless** when customers and compliance demand it.
