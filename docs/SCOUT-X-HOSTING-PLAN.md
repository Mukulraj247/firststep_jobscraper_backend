# Scout-X Hosting & Go-to-Market Plan

### briefing — plain language

**Document purpose:** Explain *what* we will host, *where*, *why*, *when*, and *what it costs*, so leadership can approve the path to sell Scout-X (and optionally use it for First Step’s job board only).

**Related technical notes:** `docs/DEPLOYMENT-PLATFORM-COMPARISON.md`, `docs/SCHEDULER-AND-SCRAPER.md`

---

## 1. What we are building (in one paragraph)

Scout-X is software that **visits job / list websites on a schedule**, **reads the job listings**, and **saves them in a database** so a customer can see fresh openings for sites they care about. It is *not* a simple website. It needs a small computer that stays on, opens a real browser (like Chrome), and runs on a timer. That is why free “sleeping” hosts (e.g. Render Free) are fine for demos but **not** fine for a product we sell.

---



## 2. How Scout-X relates to First Step (important)


| Product        | What it does                                                         | How we host it                                          |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| **First Step** | Main company product (login, users, payments, resume, app)           | **Its own** hosting (already planned / on Render, etc.) |
| **Scout-X**    | **Job board scraping only** — timers + browser that collect listings | **Separate** service on its own server                  |


**Rules for the team**

- Scout-X and First Step stay **two separate systems**.
- We do **not** merge Scout-X into the First Step backend.
- If First Step needs job-board data later, it will **call Scout-X through an API** (like ordering food from a separate kitchen, not cooking inside the dining room).
- Scout-X can also be sold **standalone** to customers who only want “watch this job site for me.”

---



## 3. The problem with how we test today (Render Free)

We currently test on **Render’s free plan**. That is useful for learning, but it has three business problems:

1. **The server falls asleep** after about 15 minutes of no visitors. While asleep, **scheduled scrapes do not run on time**.
2. **Memory is only 512 MB.** Opening Chrome for scraping often needs **1–2 GB**. The service crashes and restarts (“out of memory” emails).
3. **Keeping it awake 24/7** almost uses up the whole free monthly allowance even with almost no scrapes.

**Manager takeaway:** Free Render is a **lab**, not a **store**. We should not promise paying customers reliability on free Render.

---



## 4. The recommended setup (the “best path” in simple words)

Think of four boxes:

```
┌──────────────────────────┐
│  Customer’s web browser  │
│  (opens our website UI)  │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  Website files           │  ← Firebase Hosting or Cloudflare Pages
│  (buttons, screens, UI)  │     Cheap, fast, no Chrome needed here
└────────────┬─────────────┘
             │ talks to
             ▼
┌──────────────────────────┐
│  Always-on computer      │  ← DigitalOcean / Hetzner VPS (≥2 GB)
│  OR managed “Railway”    │     OR Railway with enough memory
│                          │
│  • Login / API           │
│  • Schedule (alarm clock)│
│  • Chrome scraper worker │
└────────────┬─────────────┘
             │ saves data to
             ▼
┌──────────────────────────┐
│  Database (MongoDB Atlas)│  ← Already the right choice; keep it
└──────────────────────────┘

Optional fifth box (files only):
┌──────────────────────────┐
│  File storage            │  ← Firebase Storage or Amazon S3
│  (screenshots, exports)  │     Not for running the scraper
└──────────────────────────┘
```



### What goes where (cheat sheet)


| Piece                                           | Put it on                                                                        | Why (plain English)                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Website UI**                                  | Firebase Hosting or Cloudflare Pages                                             | Just files; no heavy browser                   |
| **API + schedule + scraper**                    | **DigitalOcean or Hetzner (≥2 GB RAM), always on** — *or* **Railway** with ≥2 GB | Needs Chrome + timer that never sleeps         |
| **Database**                                    | **MongoDB Atlas** (keep)                                                         | Already works; don’t reinvent                  |
| **Screenshots / files**                         | Firebase Storage or S3                                                           | Storage only — **not** where Chrome runs       |
| **Firebase / AWS Lambda / Vercel for scraping** | **Do not use**                                                                   | Wrong tools for long Chrome jobs               |
| **Full AWS / Google Cloud / Browserless**       | **Later**                                                                        | When many customers or big companies demand it |


---



## 5. Why these choices (talking points for leadership)



### Why a VPS (DigitalOcean / Hetzner) or Railway?

- The machine **stays awake**, so daily/hourly job checks actually fire.
- We can buy **enough RAM** so Chrome does not crash.
- Cost is **predictable** — easier to price a customer plan.



### Why DigitalOcean / Hetzner first?

- Best balance of **price + control + reliability** for a small team selling a scraper product.
- Hetzner is often **cheaper per GB of RAM**; DigitalOcean is very common and easy to explain to stakeholders.



### Why Railway as the alternative?

- Same idea (always-on + enough memory) but **less server babysitting** (git push to deploy).
- Good if we prefer convenience over lowest cost.



### Why keep MongoDB on Atlas?

- Database stays healthy even if we rebuild the app server.
- Backups and access control are already a known path.



### Why UI on Firebase Hosting / Cloudflare Pages?

- Frontends are static files after build — these hosts are cheap and fast.
- Separates “pretty website” from “heavy scraping computer.”



### Why *not* Firebase / Lambda / Vercel for the scraper?

- Those platforms are built for **short, light** tasks.
- Our scraper opens **Chrome**, waits for pages, and may run **tens of seconds to minutes**.
- Putting Chrome there causes timeouts, cold starts, and support nightmares.



### Why AWS / GCP / Browserless later?

- **AWS/GCP:** when a big customer says “must run in our cloud / compliance.”
- **Browserless (or similar):** when we have **many** customers scraping at once and we don’t want to own a farm of Chrome machines ourselves.

---



## 6. Phased plan (what we do, in order)



### Phase 0 — Now (already happening)

**Goal:** Learn and demo.  
**Where:** Render Free + Atlas + careful limits (1 scrape at a time, short jobs).  
**Success looks like:** Team can create a robot, run a scrape, see rows.  
**Not success:** Promising SLA or selling “always-on daily checks” on free Render.


| Item     | Detail                                      |
| -------- | ------------------------------------------- |
| Duration | Until Phase 1 is approved and funded        |
| Spend    | ~$0 infra (Atlas free/shared may apply)     |
| Risk     | Sleep + out-of-memory; schedules unreliable |


---



### Phase 1 — Sellable foundation (approve this first) ★

**Goal:** Host Scout-X so a paying customer can trust a **daily job check**.  
**Where:**

1. Rent **one always-on server with at least 2 GB RAM** (prefer **4 GB** if budget allows).
  - Provider: **DigitalOcean** or **Hetzner** (default), **or Railway** if we want managed deploys.
2. Keep **MongoDB Atlas**.
3. Host UI on **Firebase Hosting** or **Cloudflare Pages**.
4. Use **Firebase Storage or S3** only if we store screenshots/files.
5. Keep Scout-X **separate** from First Step’s deploy.

**Work items (engineering)**


| #   | Task                                                                                                                | Outcome                               |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Create VPS/Railway project; install Node, Chrome/Playwright, process manager (e.g. PM2 or Docker)                   | App stays up after reboot             |
| 2   | Point domain / HTTPS (Caddy or Nginx or platform SSL)                                                               | Customers open a secure URL           |
| 3   | Set production env (secrets, Atlas URI, concurrency 1–2, normal timeouts — turn off free-tier “starve Chrome” mode) | Stable scrapes                        |
| 4   | Deploy API + embedded worker **or** API + separate worker process                                                   | Schedules + scrapes run               |
| 5   | Deploy UI to Firebase Hosting / Cloudflare Pages; point it at the new API URL                                       | Login and dashboards work             |
| 6   | Smoke test: manual run + one daily schedule for 3–5 days                                                            | Prove reliability before sales        |
| 7   | Basic monitoring: uptime check + alert on crash                                                                     | We know before the customer complains |
| 8   | Short runbook: how to redeploy, rotate secrets, check logs                                                          | Manager / support can follow          |


**Success criteria (Phase 1 done)**

- [ ] Server does **not** sleep.  
- [ ] One scheduled scrape runs on the correct day for **5 days in a row**.  
- [ ] No repeated out-of-memory restarts under light load (1 job at a time).  
- [ ] UI loads; user can see saved jobs.  
- [ ] Written estimate of monthly infra cost is shared with manager.

**Suggested duration:** 1–2 weeks after access/budget is approved.  
**Suggested monthly infra (ballpark):** about **$15–40** (2–4 GB box + Atlas free/shared + cheap UI hosting). Exact quotes at purchase time.

---



### Phase 2 — First paying customers

**Goal:** Onboard a small number of buyers (or First Step using Scout-X **only for job board** via API).

**Commercial packaging (example — adjust with sales)**


| Plan idea | What customer gets                          | Infra implication                   |
| --------- | ------------------------------------------- | ----------------------------------- |
| Starter   | 1–2 sites, 1 run/day, ~tens of jobs per run | Fits on one 2–4 GB box              |
| Growth    | More sites / runs                           | May need 4 GB or concurrency limits |


**Rules of engagement**

- Max **1–2 scrapes at the same time** on a 2 GB box; more only after upgrading RAM.  
- Prefer **daily** schedules over “every 15 minutes” until we scale.  
- First Step integration = **API calls only**; still two deployments.

**Success criteria**

- [ ] First customer (or First Step job-board feed) gets data without daily manual restarts.  
- [ ] Support can explain “where the app lives” in one slide.

---



### Phase 3 — Growth (many customers or heavy concurrent scrapes)

**Goal:** Stop stuffing all Chrome work on one small computer.

**Options (pick when metrics demand it)**

1. **Split machines:** small always-on API + bigger worker box.
2. **Browserless / Browserbase-style service:** we rent “Chrome in the cloud” per scrape; our server stays lighter.
3. **Move to AWS or Google Cloud** if a contract requires it.

**Trigger to start Phase 3 (examples)**

- More than a handful of customers scraping at once.  
- Regular memory pressure or long queues.  
- Enterprise RFP requires AWS/GCP.

---



### Phase 4 — Enterprise / compliance (only if needed)

**Goal:** Meet big-company hosting, logging, and region requirements.  
**Where:** AWS (EC2/ECS) or GCP (Compute Engine / similar), plus Atlas or approved DB.  
**Note:** Higher cost and ops complexity — do this for revenue that justifies it.

---



## 7. What we will *not* do (explicit non-goals)


| Do not                                                                   | Reason                                        |
| ------------------------------------------------------------------------ | --------------------------------------------- |
| Sell “always-on daily scrapes” on **Render Free**                        | Sleep + tiny memory                           |
| Run Playwright on **Firebase Functions / Lambda / Vercel**               | Wrong runtime model                           |
| Merge Scout-X into First Step’s single backend process                   | Harder to scale/sell; crashes affect main app |
| Host MongoDB on the same tiny scrape box                                 | Risk of losing DB if box dies                 |
| Skip HTTPS, secrets management, or basic uptime checks before first sale | Reputation risk                               |


---



## 8. Roles & ownership (suggested)


| Role              | Owns                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| Engineering       | Deploy Phase 1, runbooks, monitoring                                  |
| Product / Manager | Approve budget, pricing, Phase 1 success sign-off                     |
| First Step team   | Keep First Step deploy separate; define API needs for job board later |
| Support           | Use runbook; escalate OOM / failed schedules                          |


---



## 9. Budget snapshot (for approval)


| Phase                  | Approx monthly infra                           | One-time effort     |
| ---------------------- | ---------------------------------------------- | ------------------- |
| Phase 0 (test)         | ~$0–small Atlas                                | Ongoing learning    |
| **Phase 1 (sellable)** | **~$15–40 / month**                            | **1–2 weeks** eng   |
| Phase 2                | Same, or +$10–30 if upgrading RAM              | Onboarding time     |
| Phase 3+               | Usage-based browsers and/or cloud — quote then | Architecture sprint |


**Ask of manager:** Approve **Phase 1** provider choice (**DigitalOcean/Hetzner ≥2 GB**, or **Railway ≥2 GB**) and monthly budget so engineering can leave free Render for production Scout-X.

---



## 10. Risks and how we handle them


| Risk                                        | Impact                  | Mitigation                                              |
| ------------------------------------------- | ----------------------- | ------------------------------------------------------- |
| Chrome still crashes on 2 GB for hard sites | Failed customer runs    | Prefer **4 GB** for first sales; limit concurrency to 1 |
| Job sites block datacenter IPs              | Empty results           | Plan proxies in Phase 2 pricing                         |
| Forgetting to renew / underfunding the VPS  | Total outage            | Calendar reminder + uptime alert                        |
| Scope creep (merge into First Step)         | Delays + shared outages | Stick to “separate services” rule                       |
| Overbuilding AWS too early                  | Burn money/time         | Stay on VPS/Railway until Phase 3 triggers              |


---



## 11. Decision we need from manager

Please approve **one** of the following for Phase 1:


| Option                                                    | Description                         | Best if…                     |
| --------------------------------------------------------- | ----------------------------------- | ---------------------------- |
| **A — DigitalOcean 2–4 GB Droplet** (recommended default) | Classic always-on server we control | We want clear cost + control |
| **B — Hetzner 2–4 GB Cloud**                              | Same idea, often cheaper RAM        | We optimize cost             |
| **C — Railway ≥2 GB**                                     | Managed deploy, less SSH            | We optimize engineer time    |


Plus confirm:

- [ ] Scout-X stays **separate** from First Step hosting.  
- [ ] MongoDB stays on **Atlas**.  
- [ ] UI may move to **Firebase Hosting / Cloudflare Pages**.  
- [ ] Firebase/Lambda/Vercel are **not** used to run the scraper.  
- [ ] AWS/GCP/Browserless are **Phase 3+**, not day-one blockers.

---



## 12. One-slide summary (copy for email / deck)

> **Scout-X** scrapes job boards with a real browser and a schedule. Free Render is only for demos. To **sell** it (or feed First Step’s job board via API), we will run the scraper on an **always-on ≥2 GB server (DigitalOcean/Hetzner or Railway)**, keep the **database on MongoDB Atlas**, put the **website UI on Firebase Hosting or Cloudflare Pages**, and use **file storage only for screenshots**. We will **not** run Chrome on Firebase/Lambda/Vercel. First Step and Scout-X stay **separate**. We move to AWS/GCP or Browserless when customer volume or compliance requires it. **Ask: approve Phase 1 hosting (~$15–40/mo) and a 1–2 week setup.**

---



## 13. Appendix — glossary (layman’s terms)


| Term                      | Meaning                                            |
| ------------------------- | -------------------------------------------------- |
| **VPS**                   | A small rented computer in the cloud that stays on |
| **RAM / memory**          | Working space; Chrome needs a lot of it            |
| **Always-on**             | Machine does not sleep; timers keep working        |
| **Atlas**                 | Managed MongoDB database in the cloud              |
| **Playwright / Chromium** | Automated Chrome used to read websites             |
| **Agenda / scheduler**    | Alarm clock inside the app that starts scrapes     |
| **Browserless**           | Rent Chrome sessions from a specialist vendor      |
| **PaaS (Railway/Render)** | “Push code, they run the server” platforms         |


---

*End of plan. Update this document when Phase 1 provider and budget are formally chosen.*