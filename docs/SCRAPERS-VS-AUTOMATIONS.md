# Scrapers vs Automations

They look similar on purpose. Both pages list the **same robots** from MongoDB (`maxun_robots`). You are not looking at two different products — you are looking at **two views of the same thing**.

```
One robot document
        │
        ├── Scrapers page  (/robots)       → how you create and edit the extractor
        └── Automations page (/automations) → how you operate it day to day
```

---

## Short version

| | **Scrapers** | **Automations** |
|--|--|--|
| Sidebar | Scrapers | Automations |
| Route | `/robots` | `/automations` |
| Question it answers | *What extractors do I have, and how were they built?* | *Which jobs are running, scheduled, and extracting rows?* |
| Create flow | Record clicks, scrape a page, crawl, or search | Name + company + start URL (SaaS / ops create) |
| Typical extra fields | Type (`Extract` / `Scrape` / `Crawl` / `Search`) | Scout ID, company, tags, target URL, rows, next run |
| Extra actions | Retrain, edit workflow, duplicate, integrate (Sheets / Airtable) | Pause / resume schedules, view data, run history, configure destinations |
| API | `GET /storage/recordings` | `GET /api/dashboard/automations` |

If a row named **affirm** exists, it will usually show on **both** pages because it is one robot.

---

## Why you do not see a difference

After the Scrapers UI was aligned with Dashboard:

- Same glass hero
- Same KPI cards
- Same table chrome (status chips, schedule chips, pagination)

Visually they now match. The difference is **what each page is for**, not how it looks.

Think of it like this:

- **Scrapers** = the recipe (how to extract)
- **Automations** = the kitchen schedule (when it runs, how many rows came back, pause all, tags, company)

---

## What Scrapers is for

Scrapers is the **builder**.

You use it when you need to:

1. **Create** an extractor in one of four modes:
   - **Extract** — record clicks on a careers / listing site (classic Maxun workflow)
   - **Scrape** — capture Markdown / HTML / screenshot from a URL
   - **Crawl** — follow links across pages
   - **Search** — discover URLs from a query
2. **Retrain** a recorded workflow (open the recorder again)
3. **Edit / duplicate** the robot
4. **Integrate** Google Sheets or Airtable from the robot settings pages

Columns: Name, Type, Status, Schedule, Last run, Actions.

It does **not** show Scout ID, company, tags, extracted row counts, or next-run time.

---

## What Automations is for

Automations is the **operations dashboard**.

You use it when you need to:

1. See **health of latest runs** across the account (succeeded / failed / rows extracted)
2. Filter by **name, Scout ID, schedule, tags**
3. **Pause all** or **resume all** recurring schedules
4. Open **extracted data**, **run history**, and **config** (destinations, webhook, pagination)
5. Create a URL-based automation without recording clicks (name, company, start URL)

Columns: Name, ID, Company, Tags, URL, Last run, Rows, Next run, Schedule, Actions.

It is the page you watch while scrapers are already defined.

---

## Same data underneath

Both APIs read **Robot** documents.

| Layer | Scrapers | Automations |
|--|--|--|
| Mongo collection | `maxun_robots` | `maxun_robots` |
| Identity | `recording_meta.id` | `recording_meta.id` |
| Schedule | `robot.schedule` + `saasConfig.schedule` | Same (`resolveEffectiveScheduleState`) |
| Runs | Latest run status | Latest run status **plus** rows, failure reason, next run |

Creating on Scrapers or Automations still produces a robot. Running either still queues a **scraper job**. The worker does not care which page you clicked.

---

## When to use which

Use **Scrapers** if you are:

- Recording a new click-path extractor
- Changing scrape / crawl / search type
- Retraining or duplicating a workflow
- Wiring Sheets / Airtable from robot settings

Use **Automations** if you are:

- Checking “did today’s runs succeed?”
- Tagging by company
- Pausing schedules during an outage
- Opening extracted rows or run history
- Tuning destinations / pagination without re-recording

---

## What is *not* different

These are **not** different:

- Different databases
- Different robots (usually)
- Different run engines for “run now”
- Different cron systems

The word **scraper** in the product means the **extraction job**. The word **automation** means the **robot you operate**. Internally they are the same record.

---

## If this overlap feels like a bug

That reaction is fair. Two nav items listing the same names is confusing.

Possible product directions (not implemented):

1. Keep **one list** and merge actions (create + operate on a single page).
2. Keep two pages but make Scrapers the **create/edit studio** and Automations the **ops board**, and stop showing the full overlapping table on both.
3. Filter Automations to robots that have `saasConfig` / Scout ID, and keep Scrapers as recorded workflows only.

Until then: **same robots, two jobs** — build on Scrapers, operate on Automations.
