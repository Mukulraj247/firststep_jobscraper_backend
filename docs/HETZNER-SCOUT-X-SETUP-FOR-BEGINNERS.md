# Scout-X on Hetzner Cloud — Beginner Setup Guide (Detailed)

**Who this is for:** People who have never used Hetzner (or any VPS) before and want to run Scout-X for real scrapes and schedules.  
**Related docs:** `SCOUT-X-HOSTING-PLAN.md`, `COMPUTE-POWER-ANALYSIS.md`, `DEPLOYMENT-PLATFORM-COMPARISON.md`, `DIGITALOCEAN-SCOUT-X-SETUP-FOR-BEGINNERS.md`, `production-deployment.md`, `ENVEXAMPLE`

---

## 1. What is Hetzner Cloud? (plain English)

**Hetzner Cloud** rents you a small computer on the internet.

| At home | On Hetzner |
|---------|------------|
| Your laptop | A rented server (VPS) |
| Turns off / sleeps | Stays on **24/7** |
| Fine for coding | Needed for **schedules + Chrome scraping** |

Scout-X is not only a website. It must:

1. Stay awake so **cron schedules** fire  
2. Open **Chromium (Chrome)** to read job boards  
3. Save results in a **database**

That is why free “sleeping” hosts (like Render Free) are bad for production, and why a small always-on Hetzner server is a good fit.

### Simple picture

```text
You (browser / Chrome extension)
        │
        ▼
┌─────────────────────────┐
│  Hetzner Cloud server   │  ← the computer you rent
│  • Scout-X API          │
│  • Scheduler (Agenda)   │
│  • Scraper + Chromium   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  MongoDB Atlas          │  ← database (separate, usually free to start)
│  users, robots, runs    │
└─────────────────────────┘
```

### Words you will see

| Word | Meaning |
|------|---------|
| **VPS / Cloud server** | The rented computer |
| **vCPU** | How many CPU cores (brain speed) |
| **RAM** | Memory (Chrome needs a lot of this) |
| **IPv4** | Normal public address like `95.xxx.xxx.xxx` |
| **IPv6** | Newer address; alone is awkward for beginners |
| **SSH** | How you log into the server from your PC |
| **Ubuntu** | The Linux system we install on the server |
| **PM2** | A helper that keeps Scout-X running after you disconnect |
| **Firewall** | Rules for which ports the internet can open |
| **Domain** | Optional nice name like `scout.yourcompany.com` |

---

## 2. What you need before starting

### Accounts / tools

- [ ] Credit/debit card for Hetzner  
- [ ] [Hetzner Cloud](https://console.hetzner.cloud) account  
- [ ] [MongoDB Atlas](https://www.mongodb.com/atlas) account (database)  
- [ ] Scout-X code (GitHub repo **or** zip from your PC)  
- [ ] A Windows / Mac / Linux computer to run SSH  

### Recommended server size for Scout-X (do not overbuy)

| Choice | Recommendation | Why |
|--------|----------------|-----|
| Plan type | **Shared** Regular or Cost-Optimized | Dedicated (~$100+) is overkill |
| RAM | **4 GB** preferred (**2 GB** minimum) | Chromium needs memory |
| vCPU | **2** preferred (**1** OK if cheaper) | Enough for light daily scrapes |
| IP | **Primary IPv4** | Do not use IPv6-only |
| Traffic | Default **1 TB** | More than enough early on |
| OS image | **Ubuntu 22.04 or 24.04** | Standard and well supported |

**Do not buy** Dedicated General Purpose 4 vCPU boxes for starting Scout-X. Shared + enough RAM is the right path.

### What you do *not* need on day one

- Residential proxy (add later only if sites block you)  
- Separate browser server / Camoufox  
- AWS / Firebase for the scraper  
- Extra traffic packages  

---

## 3. Part A — Create the Hetzner server (click-by-click)

### Step A1 — Sign up / log in

1. Open [https://console.hetzner.cloud](https://console.hetzner.cloud)  
2. Create an account or log in  
3. Add a payment method when asked  

### Step A2 — Create a project

1. Click **New project**  
2. Name it e.g. `scout-x`  
3. Open that project  

### Step A3 — Add a server

1. Click **Add Server**  
2. Choose a **location** (USA or Europe — either is fine to start)  
3. Under **Image**, choose **Ubuntu** 22.04 or 24.04  

### Step A4 — Choose the plan

1. Prefer tabs like **Shared Regular Performance** or **Shared Cost-Optimized**  
2. Avoid **Dedicated** for now  
3. Pick a size with:
   - **≥ 2 GB RAM** (prefer **4 GB**)  
   - **1–2 vCPU**  

### Step A5 — Networking

1. Select **Primary IPv4** (pay the small monthly fee if shown)  
2. Leave traffic at the default (1 TB is enough)  
3. Do **not** choose IPv6-only for Scout-X beginners  

### Step A6 — SSH access (how you will log in)

**Best option — SSH key**

1. On your PC, create a key if you do not have one  
2. In Hetzner, add your **public** key  
3. Select that key when creating the server  

**OK option — root password**

1. Let Hetzner email/show a root password  
2. Change it after first login  

### Step A7 — Create the server

1. Click **Create & Buy now**  
2. Wait until status is **running**  
3. Copy the **IPv4 address** (example: `95.217.12.34`)  
4. Save it somewhere safe — you need it for every step below  

---

## 4. Part B — Log into the server (SSH)

### On Windows (PowerShell)

```bash
ssh root@YOUR_SERVER_IP
```

Example:

```bash
ssh root@95.217.12.34
```

- First time: type `yes` when asked about fingerprint  
- Enter password or use your SSH key  

If login works, you will see a Linux prompt. You are now “inside” the Hetzner computer.

### Tip

Keep this SSH window open while you install Scout-X. If you close it, the install stops — but once PM2 is set up later, the app keeps running even after you disconnect.

---

## 5. Part C — Prepare Ubuntu (install the tools)

Run these commands **on the server** (after SSH), one block at a time.

### C1 — Update the system

```bash
apt update && apt upgrade -y
```

### C2 — Install Node.js 20, Git, and build tools

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git build-essential curl ufw
node -v
npm -v
```

You should see version numbers for `node` and `npm`.

### C3 — Install Playwright / Chromium system libraries

Chrome needs OS libraries. Install them:

```bash
npx --yes playwright@1.58.0 install-deps chromium
```

### C4 — Install PM2 (keeps the app alive)

```bash
npm install -g pm2
```

### C5 — Create an app folder

```bash
mkdir -p /opt
cd /opt
```

---

## 6. Part D — Create MongoDB Atlas (the database)

Scout-X stores users, robots, runs, schedules, and the job queue in MongoDB.  
**Keep the database on Atlas**, not on the same tiny scrape box.

### D1 — Create a free cluster

1. Go to [https://www.mongodb.com/atlas](https://www.mongodb.com/atlas)  
2. Sign up / log in  
3. Create a project  
4. Create a **free / shared** cluster  

### D2 — Database user

1. Open **Database Access**  
2. Add a user with username + strong password  
3. Save the password somewhere safe  

### D3 — Network access

1. Open **Network Access**  
2. For first tests, you may allow `0.0.0.0/0` (anywhere)  
3. Safer later: allow only your **Hetzner IPv4**  

### D4 — Get the connection string

1. Click **Connect** on your cluster  
2. Choose **Drivers**  
3. Copy a URI like:

```text
mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/maxun?retryWrites=true&w=majority
```

Replace `USER` and `PASSWORD` with your real values.  
If the password has special characters, URL-encode them (e.g. `@` → `%40`).

---

## 7. Part E — Put Scout-X code on the server

### Option 1 — From GitHub (easiest)

```bash
cd /opt
git clone YOUR_GITHUB_REPO_URL scout-x
cd scout-x
```

Replace `YOUR_GITHUB_REPO_URL` with your real repo URL.

If your project lives in a subfolder (e.g. `maxun-develop`), `cd` into the folder that contains `package.json`.

### Option 2 — Upload from your PC

1. Install WinSCP or FileZilla on Windows  
2. Connect with:
   - Host: your Hetzner IPv4  
   - User: `root`  
   - Password or SSH key  
3. Upload the project into `/opt/scout-x`  
4. On the server:

```bash
cd /opt/scout-x
```

### Install Node packages

```bash
npm ci --include=dev
```

If `npm ci` fails because there is no lockfile, use:

```bash
npm install --include=dev
```

### Install Chromium for Playwright

```bash
npm run playwright:install
```

(or)

```bash
npx playwright@1.58.0 install chromium
```

---

## 8. Part F — Create the `.env` file (secrets)

Still in the project folder:

```bash
cp ENVEXAMPLE .env
nano .env
```

### Minimum settings for Hetzner (starter)

Edit these values carefully:

```env
NODE_ENV=production

# Database (from Atlas)
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/maxun?retryWrites=true&w=majority

# Secrets — make long random strings (do not reuse examples)
JWT_SECRET=change-me-to-a-long-random-string-1
SESSION_SECRET=change-me-to-a-long-random-string-2
ENCRYPTION_KEY=f4d5e6a7b8c9d0e1f23456789abcdef01234567890abcdef123456789abcdef0

# Public URLs — use your server IP for first test
BACKEND_PORT=8080
BACKEND_URL=http://YOUR_SERVER_IP:8080
PUBLIC_URL=http://YOUR_SERVER_IP:8080
VITE_BACKEND_URL=http://YOUR_SERVER_IP:8080
VITE_PUBLIC_URL=http://YOUR_SERVER_IP:8080

# One process: API + scheduler + scraper (simplest on one VPS)
RUN_EMBEDDED_WORKERS=true

# Safe for 2–4 GB RAM
SCRAPER_WORKER_CONCURRENCY=1
SCRAPER_JOB_TIMEOUT_MS=120000
LOW_MEMORY_MODE=false

# Logs
LOGS_PATH=/opt/scout-x/server/logs

# Optional — leave empty until sites block you
DEFAULT_PROXY_URL=
PROXY_POOL=
```

### Save in nano

1. `Ctrl + O` then Enter (save)  
2. `Ctrl + X` (exit)  

### Notes

- On **2–4 GB**, keep `SCRAPER_WORKER_CONCURRENCY=1` at first  
- On **4 GB**, you may try `2` later if scrapes are stable  
- Do **not** copy Render free-tier “starve Chromium” settings (`NODE_OPTIONS=192`, `LOW_MEMORY_MODE=true`) onto a proper Hetzner box unless you are still on tiny RAM  

---

## 9. Part G — Build and start Scout-X

### G1 — Build backend and frontend

```bash
cd /opt/scout-x
npm run build:server
npm run build
```

Build can take a few minutes.

### G2 — Start with PM2

```bash
pm2 start npm --name scout-x -- run server
pm2 save
pm2 startup
```

`pm2 startup` will print a command. **Copy and run that command**, then run `pm2 save` again if asked.

### G3 — Check status

```bash
pm2 status
pm2 logs scout-x
```

Healthy signs:

- Process status is **online**  
- Logs show the server listening (often port **8080**)  
- No endless crash loop  

Useful PM2 commands later:

```bash
pm2 restart scout-x
pm2 stop scout-x
pm2 logs scout-x --lines 100
```

---

## 10. Part H — Firewall (open the door carefully)

You must allow SSH and the app port, or you will lock yourself out / be unable to open the site.

### Option H1 — UFW on the server

```bash
ufw allow OpenSSH
ufw allow 8080/tcp
ufw enable
ufw status
```

### Option H2 — Hetzner Cloud Firewall (console)

In Hetzner UI, create/attach a firewall allowing:

| Port | Protocol | Why |
|------|----------|-----|
| **22** | TCP | SSH login |
| **8080** | TCP | Scout-X for first tests |
| **80** | TCP | Later (HTTP / HTTPS redirect) |
| **443** | TCP | Later (HTTPS) |

### Open the app

In your browser:

```text
http://YOUR_SERVER_IP:8080
```

If the page loads, the server side of setup is working.

---

## 11. Part I — First smoke test (prove it works)

1. Open the UI in the browser  
2. Register / log in  
3. Create one automation (or send one from the Chrome extension)  
4. Click **Run**  
5. Wait for the run to finish  
6. Confirm extracted rows appear  
7. Enable **one daily schedule**  
8. Check the next day (or temporarily use a near-term cron) that it still runs while your laptop is off  

### If the scrape fails

| Symptom | Likely cause | What to try |
|---------|--------------|-------------|
| App won’t open | Firewall / wrong IP / PM2 down | `pm2 status`, `ufw status`, check port 8080 |
| Mongo / login errors | Bad `MONGODB_URI` or Atlas network rules | Fix URI; allow Hetzner IP in Atlas |
| Browser / Playwright errors | Chromium not installed | Re-run `npm run playwright:install` |
| Out of memory / restarts | RAM too small or concurrency too high | Use 4 GB; set concurrency to `1` |
| Empty rows / captcha | Site blocks datacenter IP | Add residential proxy **only for that robot** later |

---

## 12. Part J — Optional upgrades (after it works)

Do these **after** a successful manual scrape.

### J1 — Domain name

1. Buy a domain (any registrar)  
2. Create an **A record** pointing to your Hetzner IPv4  
3. Update `.env` URLs to `https://your-domain.com` (after HTTPS is ready)  
4. Rebuild frontend if `VITE_*` URLs changed:

```bash
npm run build
pm2 restart scout-x
```

### J2 — HTTPS with Caddy (simple)

Install Caddy and reverse-proxy to port 8080 (or follow a short Caddy tutorial for Ubuntu).  
Open ports **80** and **443** in the firewall.

### J3 — Host UI separately (cleaner)

As in the hosting plan:

- Frontend → Cloudflare Pages or Firebase Hosting  
- Backend + scraper → stay on Hetzner  

Point `VITE_BACKEND_URL` at your Hetzner API URL.

### J4 — Residential proxy (only if needed)

You do **not** need this on day one.

When a specific site blocks Hetzner:

1. Buy a mid-tier residential proxy plan  
2. Leave **global** proxy empty if possible  
3. Set proxy **only on that automation** (per-robot proxy fields)  
4. Easy sites keep using the direct Hetzner IP (cheaper)

Scout-X supports proxy on scrape jobs once configured. There is no automatic “only failed jobs” switch — you choose which robots use the proxy.

---

## 13. Day-to-day operations (cheat sheet)

| Task | Command / action |
|------|------------------|
| See if app is running | `pm2 status` |
| View live logs | `pm2 logs scout-x` |
| Restart after `.env` change | `pm2 restart scout-x` |
| Deploy new code | `git pull` → `npm ci --include=dev` → build → `pm2 restart scout-x` |
| Reboot server | App should come back if `pm2 startup` + `pm2 save` were done |
| Check disk space | `df -h` |
| Check memory | `free -h` |

---

## 14. Cost mental model (honest)

| Item | Typical early cost |
|------|--------------------|
| Hetzner Shared 2–4 GB + IPv4 | Often roughly **tens of dollars / month or less** (check current Hetzner prices) |
| MongoDB Atlas free/shared | Often **$0** to start |
| Domain (optional) | A few dollars / year |
| Residential proxy (optional) | Extra **$ per GB** only when used |
| Dedicated 4 vCPU boxes | **Unnecessary** for starting Scout-X |

You pay mainly for **always-on RAM**, because Chromium needs it — not for “number of companies scraped.”

---

## 15. Full checklist (print / tick off)

### Buy / create

- [ ] Hetzner account + payment  
- [ ] Project created  
- [ ] Shared server: Ubuntu, ≥2 GB RAM (prefer 4 GB), 1–2 vCPU  
- [ ] Primary IPv4 selected  
- [ ] IPv4 address saved  

### Server tools

- [ ] SSH login works  
- [ ] Node.js 20 installed  
- [ ] Playwright deps + Chromium installed  
- [ ] PM2 installed  

### Database

- [ ] Atlas cluster created  
- [ ] DB user created  
- [ ] Network access allows the server  
- [ ] `MONGODB_URI` copied  

### App

- [ ] Code on server under `/opt/scout-x` (or your path)  
- [ ] `.env` filled with production values  
- [ ] `npm run build:server` OK  
- [ ] `npm run build` OK  
- [ ] `pm2 start` + `pm2 startup` + `pm2 save` OK  

### Access / test

- [ ] Firewall allows 22 + 8080  
- [ ] Browser opens `http://IP:8080`  
- [ ] One manual scrape succeeds  
- [ ] One schedule tested  

---

## 16. One-page summary

1. Hetzner = always-on rented computer.  
2. Buy a **Shared** Ubuntu box with **enough RAM** and **IPv4**.  
3. SSH in; install Node, Chromium libs, PM2.  
4. Create **MongoDB Atlas** and put the URI in `.env`.  
5. Upload/clone Scout-X; install; build.  
6. Start with PM2 and `RUN_EMBEDDED_WORKERS=true`.  
7. Open firewall; test one scrape; then one schedule.  
8. Add domain/HTTPS/proxy only after the basics work.

---

## 17. If you get stuck — what to send a teammate

Copy this info:

1. Hetzner plan size (RAM / vCPU)  
2. Server IPv4  
3. Output of `pm2 status`  
4. Last 50 lines of `pm2 logs scout-x`  
5. Whether Atlas connection string was tested  
6. Exact error from the browser or scrape run log  

---

*End of beginner guide. Update this file if your default ports, repo path, or process manager change.*
