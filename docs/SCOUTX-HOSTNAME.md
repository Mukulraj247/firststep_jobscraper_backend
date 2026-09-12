# ScoutX hostname (dev droplet)

Goal: stop using bare `http://IP:8080` in the browser. Use HTTPS + a real hostname so Auth0 callbacks and cookies work.

## Suggested host

`scoutx-dev.firststepjob.com` (or another name you already own). Point a DNS **A** record at the current DigitalOcean droplet IP.

Until DNS is live, local Auth0 continues on `http://localhost:5173`.

## Env after DNS + TLS

```bash
PUBLIC_URL=https://scoutx-dev.firststepjob.com
BACKEND_URL=https://scoutx-dev.firststepjob.com
VITE_PUBLIC_URL=https://scoutx-dev.firststepjob.com
VITE_BACKEND_URL=https://scoutx-dev.firststepjob.com
VITE_AUTH0_CALLBACK_URL=https://scoutx-dev.firststepjob.com
```

Also add the HTTPS origins to the Auth0 SPA Allowed Callback / Logout / Web Origins (see `docs/SCOUTX-AUTH0-SETUP.md`).

## nginx sketch

Use [`nginx.conf`](../nginx.conf) as a starting point. Example TLS-ready site:

```nginx
server {
    listen 80;
    server_name scoutx-dev.firststepjob.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name scoutx-dev.firststepjob.com;

    # ssl_certificate     /etc/letsencrypt/live/scoutx-dev.firststepjob.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/scoutx-dev.firststepjob.com/privkey.pem;

    root /var/www/maxun;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~ ^/(auth|storage|record|workflow|robot|proxy|api-docs|api|webhook|socket.io)(/|$) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Certbot (on the droplet):

```bash
sudo certbot --nginx -d scoutx-dev.firststepjob.com
```

## Rebuild / restart

```bash
# on droplet, after env + DNS
npm run build
npm run build:server
pm2 restart ecosystem.config.cjs
# or: pm2 restart scout-x scoutx-scraper scoutx-scheduler scoutx-enrichment scoutx-aggregators
```

A second production droplet is separate ops work; finish Auth0 on this hostname first.
