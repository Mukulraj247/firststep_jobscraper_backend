# Scout-X on DigitalOcean — Beginner Setup Guide (Detailed)

**Who this is for:** People who have never used DigitalOcean (or any VPS) before and want to run Scout-X for real scrapes and schedules.  
**Related docs:** `SCOUT-X-HOSTING-PLAN.md`, `COMPUTE-POWER-ANALYSIS.md`, `DEPLOYMENT-PLATFORM-COMPARISON.md`, `HETZNER-SCOUT-X-SETUP-FOR-BEGINNERS.md`, `production-deployment.md`, `ENVEXAMPLE`

---

## 1. What is DigitalOcean? (plain English)

**DigitalOcean** rents you a small computer on the internet. They call that computer a **Droplet**.

| At home | On DigitalOcean |
|---------|-----------------|
| Your laptop | A rented server (**Droplet** / VPS) |
| Turns off / sleeps | Stays on **24/7** |
| Fine for coding | Needed for **schedules + Chrome scraping** |

Scout-X is not only a website. It must:

1. Stay awake so **cron schedules** fire  
2. Open **Chromium (Chrome)** to read job boards  
3. Save results in a **database**

That is why free “sleeping” hosts (like Render Free) are bad for production, and why a small always-on DigitalOcean Droplet is a good fit.

### Simple picture

```text
You (browser / Chrome extension)
        │
        ▼
┌─────────────────────────┐
│  DigitalOcean Droplet   │  ← the computer you rent
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
| **Droplet** | The rented Linux computer (same idea as a VPS) |
| **Basic Droplet** | Cheapest family — **correct choice for Scout-X** |
| **Memory-Optimized / CPU-Optimized** | Expensive special plans — **do not buy these for Scout-X day one** |
| **vCPU** | How many CPU cores (brain speed) |
| **RAM** | Memory (Chrome needs a lot of this) |
| **SSD** | Disk space on the Droplet (Scout-X needs far less than Memory-Optimized plans offer) |
| **IPv4** | Normal public address like `164.92.xxx.xxx` |
| **SSH** | How you log into the Droplet from your PC |
| **Ubuntu** | The Linux system we install on the Droplet |
| **PM2** | A helper that keeps Scout-X running after you disconnect |
| **Cloud Firewall** | DigitalOcean rules for which ports the internet can open |
| **Spaces** | Optional DigitalOcean file storage (screenshots later) — not required day one |
| **Domain** | Optional nice name like `scout.yourcompany.com` |

---

## 2. What Scout-X needs (so you pick the right plan)

### Hard requirements

| Need | Why | What to buy |
|------|-----|-------------|
| **Always-on** | Schedules miss if the server sleeps | A Droplet (not a free sleeping web host) |
| **≥ 2 GB RAM** (prefer **4 GB**) | Chromium + Node share RAM; 512 MB OOMs | Basic Droplet with enough memory |
| **~50–80 GB SSD** | OS + Node + Chromium + logs ≈ 10–15 GB used | Included with Basic 2–4 GB plans — enough |
| **IPv4 address** | You and Atlas need a normal IP | Included with Droplet by default |
| **MongoDB elsewhere** | Don’t put Mongo on the same tiny scrape box | MongoDB Atlas (free/shared to start) |

### Best DigitalOcean plan for Scout-X (do not overbuy)

Go to DigitalOcean → **Droplets** → plan family **Basic** (not Memory-Optimized).

| Choice | Recommendation | Why |
|--------|----------------|-----|
| Plan family | **Basic** | Right price/shape for API + one Chromium |
| Best pick | **4 GiB RAM / 2 vCPUs / 80 GiB SSD** (~**$24/mo**) | Safer for selling / daily scrapes |
| Minimum | **2 GiB RAM / 1 vCPU / 50 GiB SSD** (~**$12/mo**) | OK with concurrency `1` only |
| CPU option | **Regular** (shared) | Premium Intel not required day one |
| OS image | **Ubuntu 22.04 or 24.04 LTS** | Standard and well supported |
| Datacenter | Closest to you or your users (e.g. NYC, SFO, AMS, BLR) | Lower latency; any region works to start |

**Do not buy for Scout-X day one**

| Wrong plan | Why it’s wrong |
|------------|----------------|
| Memory-Optimized (16–32 GiB, ~$84–$168/mo) | Built for big databases/caches; Scout-X is not that |
| CPU-Optimized / Storage-Optimized | Overkill; you need RAM for Chrome, not special disks |
| Basic 512 MiB / 1 GiB | Too small — Chromium will crash |
| DigitalOcean Managed MongoDB on day one | Extra cost; Atlas free/shared is enough to start |

### What you do *not* need on day one

- DigitalOcean Spaces (add later only if you store many screenshots)  
- Load Balancer  
- Kubernetes / DOKS  
- App Platform (you can use a Droplet; App Platform is a different product)  
- Residential proxy (add later only if sites block you)  
- Separate browser server / Camoufox  
- Extra block storage volumes  

---

## 3. Part A — Create the DigitalOcean Droplet (click-by-click)

### Step A1 — Sign up / log in

1. Open [https://cloud.digitalocean.com](https://cloud.digitalocean.com)  
2. Create an account or log in  
3. Add a payment method when asked (credit/debit card)  

### Step A2 — Start creating a Droplet

1. From the left menu, click **Droplets**  
2. Click **Create Droplet** (green button)  

### Step A3 — Choose a region

1. Under **Choose Region**, pick a datacenter close to you  
   - Examples: **New York**, **San Francisco**, **Amsterdam**, **Bangalore**, **Singapore**  
2. Any region is fine for a first Scout-X deploy  

### Step A4 — Choose an image (operating system)

1. Under **Choose an image**, stay on **OS**  
2. Select **Ubuntu**  
3. Version: **24.04 (LTS) x64** or **22.04 (LTS) x64**  

Do **not** pick Docker / Marketplace apps for this beginner guide — plain Ubuntu is clearer.

### Step A5 — Choose the size (this is the important part)

1. Under **Choose Size**, open the **Basic** tab  
2. Do **not** open Memory-Optimized / CPU-Optimized / Storage-Optimized  
3. Under CPU options, leave **Regular** selected (not Premium Intel, unless you prefer it later)  
4. Pick one of these rows:

| Prefer | Memory | vCPU | SSD | About |
|--------|--------|------|-----|-------|
| **Best for Scout-X** | **4 GiB** | **2** | **80 GiB** | ~**$24/mo** |
| Minimum | **2 GiB** | **1** | **50 GiB** | ~**$12/mo** |

If prices differ slightly on the page, trust the current DigitalOcean pricing table — the **RAM number** is what matters most.

### Step A6 — Authentication (how you will log in)

**Best option — SSH key**

1. On your PC (Windows PowerShell), create a key if you do not have one:

```bash
ssh-keygen -t ed25519 -C "scout-x-digitalocean"
```

2. Press Enter to accept the default path  
3. Optionally set a passphrase  
4. Show your **public** key:

```bash
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

5. In DigitalOcean, under **Authentication**, choose **SSH Key**  
6. Click **New SSH Key**, paste the public key, name it e.g. `my-laptop`, save  
7. Make sure that key is **checked** for this Droplet  

**OK option — Password**

1. Choose **Password**  
2. Set a long, unique root password  
3. Save it in a password manager  

### Step A7 — Hostname and extras

1. **Hostname:** e.g. `scout-x`  
2. Leave **Add improved metrics monitoring and alerting** on if shown (free, useful)  
3. Skip **Volumes**, **Backups** (optional later — backups cost extra ~20%), **VPC** defaults are fine  
4. Quantity: **1** Droplet  

### Step A8 — Create the Droplet

1. Click **Create Droplet**  
2. Wait until status is **Active** (green)  
3. Copy the **IPv4 address** shown on the Droplet (example: `164.92.12.34`)  
4. Save it somewhere safe — you need it for every step below  

---

## 4. Part B — Log into the Droplet (SSH)

### On Windows (PowerShell)

```bash
ssh root@YOUR_DROPLET_IP
```

Example:

```bash
ssh root@164.92.12.34
```

- First time: type `yes` when asked about fingerprint  
- Enter password **or** use your SSH key (no password if key-only)  

If login works, you will see a Linux prompt. You are now “inside” the DigitalOcean computer.

### Tip

Keep this SSH window open while you install Scout-X. If you close it, the install stops — but once PM2 is set up later, the app keeps running even after you disconnect.

---

## 5. Part C — Prepare Ubuntu (install the tools)

Run these commands **on the Droplet** (after SSH), one block at a time.

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

You should see version numbers for `node` and `npm` (Node should be v20.x).

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
**Keep the database on Atlas**, not on the same Droplet.

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
3. Safer later: allow only your **DigitalOcean Droplet IPv4**  

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

## 7. Part E — Put Scout-X code on the Droplet

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
   - Host: your DigitalOcean IPv4  
   - User: `root`  
   - Password or SSH key  
3. Upload the project into `/opt/scout-x`  
4. On the Droplet:

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

### Minimum settings for DigitalOcean (starter)

Edit these values carefully:

```env
NODE_ENV=production

# Database (from Atlas)
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/maxun?retryWrites=true&w=majority

# Secrets — make long random strings (do not reuse examples)
JWT_SECRET=change-me-to-a-long-random-string-1
SESSION_SECRET=change-me-to-a-long-random-string-2
ENCRYPTION_KEY=f4d5e6a7b8c9d0e1f23456789abcdef01234567890abcdef123456789abcdef0
ADMIN_PASSWORD=change-me-admin-password

# Public URLs — use your Droplet IP for first test
BACKEND_PORT=8080
BACKEND_URL=http://YOUR_DROPLET_IP:8080
PUBLIC_URL=http://YOUR_DROPLET_IP:8080
VITE_BACKEND_URL=http://YOUR_DROPLET_IP:8080
VITE_PUBLIC_URL=http://YOUR_DROPLET_IP:8080

# One process: API + scheduler + scraper (simplest on one Droplet)
RUN_EMBEDDED_WORKERS=true

# Safe for 2–4 GB RAM
SCRAPER_WORKER_CONCURRENCY=1
SCRAPER_JOB_TIMEOUT_MS=120000
LOW_MEMORY_MODE=false

# Logs
LOGS_PATH=/opt/scout-x/server/logs

# Optional — DigitalOcean compute panel on /admin (CPU / memory / bandwidth)
# Create a read Personal Access Token, copy Droplet ID, keep metrics agent installed
DIGITALOCEAN_TOKEN=
DIGITALOCEAN_DROPLET_IDS=

# Optional — ZeptoMail ops digest every 6 hours (runs + compute email)
ZEPTOMAIL_TOKEN=
ZEPTOMAIL_FROM_ADDRESS=noreply@yourdomain.com
ZEPTOMAIL_FROM_NAME=Scout-X Ops
OPS_DIGEST_EMAIL_TO=you@example.com
OPS_DIGEST_ENABLED=true

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
- Do **not** copy Render free-tier “starve Chromium” settings (`NODE_OPTIONS=192`, `LOW_MEMORY_MODE=true`) onto a proper DigitalOcean Droplet unless you are still on tiny RAM  
- Redis in `ENVEXAMPLE` is optional for many Scout-X setups — you can leave defaults if you are not running Redis  

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

### Option H1 — UFW on the Droplet (do this)

```bash
ufw allow OpenSSH
ufw allow 8080/tcp
ufw enable
ufw status
```

### Option H2 — DigitalOcean Cloud Firewall (console, recommended extra)

1. In DigitalOcean left menu: **Networking** → **Firewalls**  
2. Click **Create Firewall**  
3. Name it e.g. `scout-x-fw`  
4. **Inbound rules** — allow:

| Type | Protocol | Port | Sources | Why |
|------|----------|------|---------|-----|
| SSH | TCP | **22** | Your IP (best) or All | SSH login |
| Custom | TCP | **8080** | All IPv4 / IPv6 | Scout-X for first tests |
| HTTP | TCP | **80** | All | Later (HTTP / HTTPS redirect) |
| HTTPS | TCP | **443** | All | Later (HTTPS) |

5. **Outbound rules:** leave default (allow all)  
6. Under **Apply to Droplets**, select your `scout-x` Droplet  
7. Click **Create Firewall**  

### Open the app

In your browser:

```text
http://YOUR_DROPLET_IP:8080
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
| App won’t open | Firewall / wrong IP / PM2 down | `pm2 status`, `ufw status`, check Cloud Firewall, port 8080 |
| Mongo / login errors | Bad `MONGODB_URI` or Atlas network rules | Fix URI; allow Droplet IP in Atlas |
| Browser / Playwright errors | Chromium not installed | Re-run `npm run playwright:install` |
| Out of memory / restarts | RAM too small or concurrency too high | Use 4 GB Basic; set concurrency to `1` |
| Empty rows / captcha | Site blocks datacenter IP | Add residential proxy **only for that robot** later |

---

## 12. Part J — Optional upgrades (after it works)

Do these **after** a successful manual scrape.

### J1 — Domain name

1. Buy a domain (any registrar)  
2. Create an **A record** pointing to your DigitalOcean Droplet IPv4  
   - Or use DigitalOcean **Networking → Domains** to manage DNS  
3. Update `.env` URLs to `https://your-domain.com` (after HTTPS is ready)  
4. Rebuild frontend if `VITE_*` URLs changed:

```bash
npm run build
pm2 restart scout-x
```

### J2 — HTTPS with Caddy (simple)

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

Create a simple reverse proxy (example — replace domain):

```bash
nano /etc/caddy/Caddyfile
```

```text
your-domain.com {
    reverse_proxy localhost:8080
}
```

```bash
systemctl reload caddy
```

Open ports **80** and **443** in UFW and the DigitalOcean Cloud Firewall.  
Then set `.env` URLs to `https://your-domain.com`, rebuild, and restart PM2.

### J3 — Host UI separately (cleaner)

As in the hosting plan:

- Frontend → Cloudflare Pages or Firebase Hosting  
- Backend + scraper → stay on the DigitalOcean Droplet  

Point `VITE_BACKEND_URL` at your Droplet API URL (HTTPS preferred).

### J4 — Screenshots / files (optional)

You do **not** need this on day one.

Later options:

- Firebase Storage (already supported in the app), or  
- DigitalOcean **Spaces** (S3-compatible object storage)

Keep scrape results in **Atlas**; put large files in object storage so the Droplet disk stays clean.

### J5 — Enable Droplet backups (optional)

In DigitalOcean: Droplet → **Backups** / **Snapshots**.  
Useful before big upgrades. Costs extra (~20% of Droplet price for automated backups).

### J6 — Residential proxy (only if needed)

You do **not** need this on day one.

When a specific site blocks DigitalOcean:

1. Buy a mid-tier residential proxy plan  
2. Leave **global** proxy empty if possible  
3. Set proxy **only on that automation** (per-robot proxy fields)  
4. Easy sites keep using the direct Droplet IP (cheaper)

---

## 13. Day-to-day operations (cheat sheet)

| Task | Command / action |
|------|------------------|
| See if app is running | `pm2 status` |
| View live logs | `pm2 logs scout-x` |
| Restart after `.env` change | `pm2 restart scout-x` |
| Deploy new code | `git pull` → `npm ci --include=dev` → build → `pm2 restart scout-x` |
| Reboot Droplet | App should come back if `pm2 startup` + `pm2 save` were done |
| Check disk space | `df -h` |
| Check memory | `free -h` |
| Resize Droplet later | DigitalOcean → Droplet → **Resize** (power off first for CPU/RAM resize) |

---

## 14. Cost mental model (honest)

| Item | Typical early cost |
|------|--------------------|
| Basic Droplet **4 GB / 2 vCPU / 80 GB** | About **$24/mo** (check current DO prices) |
| Basic Droplet **2 GB / 1 vCPU / 50 GB** | About **$12/mo** |
| MongoDB Atlas free/shared | Often **$0** to start |
| Domain (optional) | A few dollars / year |
| Droplet backups (optional) | ~20% of Droplet price |
| Spaces / Firebase Storage (optional) | Small; only if you store files |
| Residential proxy (optional) | Extra **$ per GB** only when used |
| Memory-Optimized 16–32 GB | **Unnecessary** — do not start here |

You pay mainly for **always-on RAM**, because Chromium needs it — not for “number of companies scraped,” and not for a huge SSD.

### DigitalOcean vs Hetzner (quick)

| | DigitalOcean | Hetzner |
|--|--------------|---------|
| Beginner UI | Very friendly | Also fine; slightly more DIY feel |
| Scout-X fit | Excellent | Excellent (often cheaper RAM) |
| What to buy | **Basic 4 GB** | Shared 4 GB |
| Same install steps after SSH? | Yes (Ubuntu + Node + PM2) | Yes |

If you already decided on DigitalOcean, use this guide. If you want lower cost for the same RAM, see `HETZNER-SCOUT-X-SETUP-FOR-BEGINNERS.md`.

---

## 15. Full checklist (print / tick off)

### Buy / create

- [ ] DigitalOcean account + payment  
- [ ] Droplet created under **Basic** (not Memory-Optimized)  
- [ ] Ubuntu 22.04/24.04, **≥2 GB RAM** (prefer **4 GB / 2 vCPU / 80 GB SSD**)  
- [ ] SSH key or root password set  
- [ ] Droplet IPv4 address saved  

### Server tools

- [ ] SSH login works (`ssh root@IP`)  
- [ ] Node.js 20 installed  
- [ ] Playwright deps + Chromium installed  
- [ ] PM2 installed  

### Database

- [ ] Atlas cluster created  
- [ ] DB user created  
- [ ] Network access allows the Droplet  
- [ ] `MONGODB_URI` copied  

### App

- [ ] Code on server under `/opt/scout-x` (or your path)  
- [ ] `.env` filled with production values  
- [ ] `npm run build:server` OK  
- [ ] `npm run build` OK  
- [ ] `pm2 start` + `pm2 startup` + `pm2 save` OK  

### Access / test

- [ ] UFW allows 22 + 8080  
- [ ] (Optional) DigitalOcean Cloud Firewall attached  
- [ ] Browser opens `http://IP:8080`  
- [ ] One manual scrape succeeds  
- [ ] One schedule tested  
- [ ] (Optional) `/admin` DigitalOcean panel shows CPU/memory after `DIGITALOCEAN_*` env  
- [ ] (Optional) ZeptoMail test digest from `/admin` succeeds  

---

## 16. One-page summary

1. DigitalOcean = always-on rented computer called a **Droplet**.  
2. Buy a **Basic** Ubuntu Droplet with **enough RAM** (prefer **4 GB / ~$24**).  
3. Do **not** buy Memory-Optimized for Scout-X day one.  
4. SSH in; install Node, Chromium libs, PM2.  
5. Create **MongoDB Atlas** and put the URI in `.env`.  
6. Upload/clone Scout-X; install; build.  
7. Start with PM2 and `RUN_EMBEDDED_WORKERS=true`.  
8. Open firewall; test one scrape; then one schedule.  
9. Add domain/HTTPS/proxy/Spaces only after the basics work.  
10. (Optional) Wire DigitalOcean API + ZeptoMail for `/admin` compute panel and 6-hour digests.

---

## 17. Optional — Admin compute panel + ZeptoMail digest

Scout-X can show Droplet CPU / memory / bandwidth on **`/admin`** and email an ops digest every **6 hours** via ZeptoMail.

### DigitalOcean API

1. Open [API → Tokens](https://cloud.digitalocean.com/account/api/tokens) and create a **Personal Access Token** with **read** scope.  
2. Find your Droplet ID (Droplet page URL, or `doctl compute droplet list`).  
3. Confirm **metrics monitoring** is enabled (agent installed when the Droplet was created, or install from DO docs). Without the agent, the API returns empty series.  
4. Put in `.env`:

```env
DIGITALOCEAN_TOKEN=dop_v1_...
DIGITALOCEAN_DROPLET_IDS=123456789
```

5. Restart Scout-X (`pm2 restart scout-x`), open `/admin`, and check the **DigitalOcean droplet** section.

### ZeptoMail digest

1. In ZeptoMail, open your Agent → **SMTP/API** → copy the **Send Mail Token**.  
2. Use a verified from-address on that Agent.  
3. Put in `.env`:

```env
ZEPTOMAIL_TOKEN=...
ZEPTOMAIL_FROM_ADDRESS=noreply@yourdomain.com
ZEPTOMAIL_FROM_NAME=Scout-X Ops
OPS_DIGEST_EMAIL_TO=you@example.com
OPS_DIGEST_ENABLED=true
```

4. Restart Scout-X. On `/admin`, use **Send test digest**. Agenda also sends automatically every 6 hours when enabled and configured.

---

## 18. If you get stuck — what to send a teammate

Copy this info:

1. DigitalOcean plan size (RAM / vCPU / SSD) and that it is **Basic**  
2. Droplet IPv4  
3. Output of `pm2 status`  
4. Last 50 lines of `pm2 logs scout-x`  
5. Whether Atlas connection string was tested  
6. Exact error from the browser or scrape run log  

---

*End of beginner guide. Update this file if DigitalOcean plan names, default ports, repo path, or process manager change.*
