# ScoutX Auth0 setup (dev)

ScoutX reuses the **FirstStepJobSPA Tokens Dev** Auth0 SPA on tenant `dev-0yrs1pb6s37h8s6u`. Do **not** create a second Auth0 application for ScoutX. Do **not** write ScoutX roles into `user_metadata.role` (First Step packages own that field).

## Access rules (cleanup)

| Who | Sees |
|-----|------|
| Any successful Auth0 login | Customer portal `/user` (default `ScoutX_User`) |
| Auth0 RBAC role `ScoutX_Admin` on the access token | Ops console `/dashboard` (scrapers, aggregators, …) |
| Password / register | **Disabled** (410 from API) |

Ops ownership stays on Mongo `maxun_users` id `6a8cfcda6a727b0780e05692` only. Portal users are stored in `scoutx_portal_users` — never create a second `maxun_users` row for them.

## Env values

| Variable | Value |
|----------|--------|
| Domain | `dev-0yrs1pb6s37h8s6u.us.auth0.com` |
| Client ID | `rZdCSh2HGTCru3y0JSb8R80Ys7oiVHQT` |
| SPA name | FirstStepJobSPA Tokens Dev |
| Audience | `https://scoutx.app/api` (custom ScoutX API with RBAC — **not** Management API) |
| ScoutX callback | `http://localhost:5173/login` (must include `/login` — bare `/` strips Auth0 `?code=`) |
| Ops Mongo user | `SCOUTX_OPS_USER_ID=6a8cfcda6a727b0780e05692` |
| First Step API | `FIRSTSTEP_API_BASE_URL=http://localhost:5000` |

## Custom ScoutX API (RBAC)

Create **Applications → APIs → ScoutX API** with identifier `https://scoutx.app/api`.

On that API → **Settings → RBAC Settings**:
- Enable **RBAC**
- Enable **Add Permissions in the Access Token** (optional)

**Authorize the SPA** (fixes `Client … is not authorized to access resource server "https://scoutx.app/api"`):
1. Open **Applications → APIs → ScoutX API → Machine to Machine Applications**  
   *(Auth0 also shows this under the API as “Applications” / authorize apps — name varies.)*
2. Find **FirstStepJobSPA Tokens Dev** (`rZdCSh2HGTCru3y0JSb8R80Ys7oiVHQT`).
3. Toggle it **Authorized** / ON.
4. If it asks for permissions, grant whatever scopes you defined (or leave empty if none).
5. **Save**.

Alternate path: **Applications → FirstStepJobSPA Tokens Dev → APIs** → authorize **ScoutX API**.

### Silent First Step → ScoutX (no second login / consent)

First Step and ScoutX share the **same Auth0 SPA** (`rZdCSh2HGTCru3y0JSb8R80Ys7oiVHQT`) and tenant. They do **not** share the same API audience:

| App | Audience |
|-----|----------|
| First Step (local/dev) | often Management API `https://dev-0yrs1pb6s37h8s6u.us.auth0.com/api/v2/` |
| ScoutX | custom API `https://scoutx.app/api` |

Same SPA + Auth0 session cookie is **not** enough. Auth0 still blocks a silent token for a **new API audience** until the user has consented (or you skip consent for first-party apps).

On **Applications → APIs → ScoutX API → Settings**, scroll to the bottom (**Access Settings**):
1. Turn **ON** **Allow Skipping User Consent** *(if the toggle is missing, expand Advanced / scroll past Token Settings — it only exists on custom APIs, not Management API)*
2. Turn **ON** **Allow Offline Access** (if ScoutX requests `offline_access` / refresh)
3. **Save**

**Localhost note:** Auth0 always shows a one-time consent dialog for `localhost` callbacks (even with skip-consent ON). Accept once; later visits skip it. Production HTTPS hostnames can skip consent fully when the toggle is ON.

Also confirm:
- SPA is **first-party** (default for apps you created in this tenant)
- Allowed Callbacks / Web Origins include ScoutX (`http://localhost:5173/login`, `https://scoutx-dev.firststepjob.com/login`, …)
- SPA authorized for ScoutX API (Machine-to-Machine / Applications toggle — above)

After changing Auth0:
1. Log out of First Step and ScoutX (or clear site data for both localhost ports)
2. Log into First Step once
3. Open ScoutX via **Go to dashboard** → should land on `/user` with **no** Auth0 UI

If you still see `Consent required`, the skip-consent toggle is off or the SPA is not authorized for that API.

Do **not** try to enable RBAC on Auth0 Management API (System API — those toggles are not available).

Set ScoutX env:
- `VITE_AUTH0_AUDIENCE=https://scoutx.app/api`
- `AUTH0_API_AUDIENCE=https://scoutx.app/api`

First Step local env (`FIRSTSTEP/front/.env-cmdrc.json` development) must use the **same** Auth0 domain + client ID as ScoutX so the browser session is shared. ScoutX URL for the landing CTA: `VITE_SCOUTX_URL=http://localhost:5173` (or prod URL).

Ignore Auth0’s sample Node snippet (`jwtCheck` Express demo) — ScoutX already validates tokens in `server/src/middlewares/auth0.ts`.

## Troubleshooting Auth0 (problems we have hit)

Use this section when First Step → ScoutX SSO or login misbehaves. Check top to bottom.

### A. Stuck on spinner / “Refreshing session…” forever

**Symptom:** ScoutX `/login` or portal never finishes; network shows repeated Auth0 or `/auth/auth0/exchange` calls.

**Causes / fixes:**
1. **Effect re-entry loop** — `usePortalAuth` must not re-run sync for the same Auth0 `sub` after success (`syncedSubRef`). If you change that hook, keep the “already synced this sub” guard.
2. **Stale abort** — rapid remounts cancel in-flight `getAccessTokenSilently` / exchange. Prefer one sync generation + ignore stale results.
3. **Hung token call** — wrap silent token + exchange with timeouts; on timeout show the Continue button instead of spinning forever.
4. **Wrong callback URL** — Auth0 redirected to `http://localhost:5173/` (no `/login`). The SPA strips `?code=` on `/`. Fix Allowed Callback URLs to `…/login` and ensure `redirect_uri` ends with `/login`.

### B. `consent_required` (or Auth0 “Consent required” screen)

**Symptom:** Console / Auth0 error `consent_required`. User already logged into First Step; ScoutX asks for consent or fails silent SSO.

**Why:** ScoutX requests audience `https://scoutx.app/api`; First Step never asked for that audience. Auth0 requires consent for the new API unless skipping is allowed.

**Fix (Auth0 dashboard — preferred):**
1. ScoutX API → **Allow Skipping User Consent** = ON
2. SPA authorized for ScoutX API
3. Clear cookies / log out both apps, log into First Step, open ScoutX again

**App fallback (already in code):**
- `Login.tsx` / `usePortalAuth`: on `consent_required`, one interactive `loginWithRedirect` (no `prompt: 'none'`) so the user can grant consent once.
- Do **not** loop `prompt: 'none'` on consent errors — that never succeeds without the dashboard toggle.

### C. `login_required` on silent SSO (new tab from First Step)

**Symptom:** Opening ScoutX from First Step “Go to dashboard” does not auto-login; silent `prompt: 'none'` fails with `login_required`.

**Why:** No Auth0 session cookie for this tenant in the new tab (different browser profile, third-party cookie blocking, or user never logged into Auth0 on this origin).

**Fix:**
1. Confirm First Step and ScoutX use the **same** `VITE_AUTH0_DOMAIN` + `VITE_AUTH0_CLIENT_ID`
2. User must complete Auth0 login on First Step first (same browser)
3. Allowed Web Origins include both First Step and ScoutX origins
4. If silent fails once, show “Continue with Auth0” (interactive login) — do not infinite-redirect

### D. `Client … is not authorized to access resource server "https://scoutx.app/api"`

**Fix:** Authorize the First Step SPA on the ScoutX API (see **Authorize the SPA** above). Then clear tokens and retry.

### E. Wrong audience / 401 on `/auth/auth0/exchange`

**Symptom:** Exchange fails; JWT `aud` is Management API or missing ScoutX API.

**Fix:**
- ScoutX front + server must both use `https://scoutx.app/api` (not Management API).
- After changing env, restart Vite + Node; hard-refresh the browser.
- First Step may keep Management API as its own audience — that is OK. Only ScoutX must request the ScoutX API audience when calling `getAccessTokenSilently({ authorizationParams: { audience: … } })`.

### F. Ops user lands on `/user` instead of `/dashboard`

**Fix:** Assign Auth0 RBAC role `ScoutX_Admin`, ensure Post-Login Action copies roles to claim `https://scoutx.app/roles`, then **full logout + login** (old tokens lack the claim). See checklist item 7 below.

### G. Local env checklist (First Step + ScoutX)

| Check | First Step | ScoutX |
|-------|------------|--------|
| Auth0 domain | `dev-0yrs1pb6s37h8s6u.us.auth0.com` | same |
| Client ID | `rZdCSh2HGTCru3y0JSb8R80Ys7oiVHQT` | same |
| Audience | Management API OK for FS | **must** be `https://scoutx.app/api` |
| Front port / callback | `5174` | `5173` + `/login` |
| First Step API | `http://localhost:5000` | `FIRSTSTEP_API_BASE_URL=http://localhost:5000` |
| ScoutX open URL | `VITE_SCOUTX_URL=http://localhost:5173` | — |
| CORS on First Step back | include `http://localhost:5173` and `5174` | — |

### H. After any Auth0 dashboard change

1. Log out First Step **and** ScoutX (or clear site data for `localhost:5173` and `5174`)
2. Restart ScoutX front/back if env files changed
3. Log into First Step once
4. First Step → ScoutX → **Go to dashboard** → expect `/user` with no second login when skip-consent is ON

## Auth0 Dashboard checklist

1. Open **FirstStepJobSPA Tokens Dev** (`rZdCSh2HGTCru3y0JSb8R80Ys7oiVHQT`).
2. Keep First Step URLs (`http://localhost:5174`, …).
3. Add ScoutX Allowed Callback / Logout / Web Origins: app origin (e.g. `http://localhost:5173`, `http://127.0.0.1:5173`, `https://scoutx-dev.firststepjob.com`). Logout return uses `/login` only.
   - **Required callbacks (exact):** `http://localhost:5173/login`, `http://127.0.0.1:5173/login`, `https://scoutx-dev.firststepjob.com/login`
   - Also keep origin roots if you still have older clients: `http://localhost:5173`, etc.
   - **Local login:** the SPA sends `redirect_uri = {origin}/login`. Both localhost and 127.0.0.1 must be listed if you use either host.
   - Allowed Logout URLs: `http://localhost:5173/login`, `http://127.0.0.1:5173/login`, `https://scoutx-dev.firststepjob.com/login`
   - Allowed Web Origins: same origins without path.
4. **Authorize** that SPA against API `https://scoutx.app/api` (see above).
5. Roles: `ScoutX_Admin`, `ScoutX_User`.
6. **Required for ops:** Post-Login Action copies RBAC roles onto the access token:

```js
exports.onExecutePostLogin = async (event, api) => {
  const roles = (event.authorization && event.authorization.roles) || [];
  const scoutx = roles.filter((r) => r === 'ScoutX_Admin' || r === 'ScoutX_User');
  if (scoutx.length) {
    api.accessToken.setCustomClaim('https://scoutx.app/roles', scoutx);
    api.idToken.setCustomClaim('https://scoutx.app/roles', scoutx);
  }
};
```

7. Assign ops people **`ScoutX_Admin`**. Without the claim, they only get `/user`.
   - Email alone does **not** open `/dashboard` (e.g. `mukulraj756@gmail.com` still needs the role).
   - After assigning the role: log out fully, log in again (old tokens lack the claim).
   - Confirm Action is under **Actions → Triggers → Login / Post Login** (between Start and Complete).
   - Server log `[auth0/exchange]` should show `roles: ['ScoutX_Admin', …]` and `rolesClaim: ['ScoutX_Admin']`.
   - Login via `/login` (unified): `ScoutX_Admin` → `/dashboard` (shared ops owner); `ScoutX_User` → `/user`. UI shows the Auth0 actor email; scrapers stay owned by `SCOUTX_OPS_USER_ID`.
8. Do **not** change First Step `user_metadata.role`.

## Login flow

1. SPA: **one** Auth0 entry at `/login` (legacy `/user/login` and `/user/register` redirect here).
2. `POST /auth/auth0/exchange` with Bearer access token (+ email from ID token).
3. Fetch First Step plan: `GET {FIRSTSTEP_API_BASE_URL}/firstStep/subscription/getByUserId?user_id={auth0Sub}` — stored on `scoutx_portal_users.firstStepPlan` (login still succeeds if First Step is down).
4. `ScoutX_Admin` → cookie JWT `{ id: <ops Mongo id> }` → `/dashboard`.
5. `ScoutX_User` (default) → portal profile upsert → `/user`.
6. Logout clears ScoutX cookie **and** Auth0; return to `/login`.

## Hostname

See `docs/SCOUTX-HOSTNAME.md` for DNS/TLS on the droplet.
