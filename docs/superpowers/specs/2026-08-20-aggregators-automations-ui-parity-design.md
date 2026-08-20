# Aggregators ↔ Automations UI parity

**Date:** 2026-08-20  
**Status:** Approved (option C)

## Goal

Make the Aggregators page use the same list UX as Automations: filters, pagination, desktop table, mobile cards, schedule modal, full Actions menu, and visible **Next run**.

## Design

### Page shell
Rebuild `AggregatorsPage` to mirror `AutomationsPage`:
- React Query + socket invalidate
- `AutomationFilters` + `TablePagination`
- Desktop `AutomationTable` / mobile `AutomationCardList`
- `AutomationDialogs` (schedule, delete, pause/resume per row)
- Keep Hiring Cafe create (name + URL, hourly cron, tags `aggregator` / `hiring_cafe`)
- Keep Aggregator hero branding (no account-wide pause-all — that would affect career robots)

### Columns
Name · ID · Company · Tags · URL · Last run · Rows · **Next run** · Schedule · **Job board** · Actions

### Row counts
Use `run.rowsExtracted` (same as Automations). Keep `jobsAddedToBoard` as Job board column.

### API
Extend `GET /dashboard/aggregators` with `q`, `id`, `tags`, `scheduleCron` filters + summary stats.

## Out of scope
Job-board card UI; scraper behavior beyond count source.
