# Configurable DNS Resolvers

**Date:** 2026-08-08  
**Status:** Implemented  
**Product:** Scout-X Node processes (API, scraper worker, scripts)

## Problem

Hardcoded `dns.setServers(['8.8.8.8','1.1.1.1'])` at module load forced every Node lookup through two public resolvers. If those were throttled or blocked, Mongo Atlas SRV, HTTP, and scrapes failed together. Cloud VMs usually need the provider / VPC resolver.

## Solution

- Default: **do not call** `setServers` — use OS `resolv.conf`.
- Opt-in: `DNS_SERVERS=8.8.8.8,1.1.1.1` (comma-separated).
- Single helper: `server/src/utils/dnsConfig.ts` — applied from `storage/db.ts` (and scripts after dotenv). Removed from `scraperQueue.ts`.

## Env

- `DNS_SERVERS` — optional; omit for system DNS

## Non-goals

DoH, per-request DNS, Chromium DNS overrides, forcing public DNS in PM2.
