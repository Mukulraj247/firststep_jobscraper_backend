# ScoutX Auth0 setup (dev)

ScoutX reuses the **First Step development** Auth0 SPA. Do **not** create a new Auth0 application for this sprint. Do **not** write ScoutX roles into `user_metadata.role` (First Step packages own that field).

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
| Domain | `dev-app0lbs2pjcoxxuv.us.auth0.com` |
| Client ID | `x2ginS1tSrJizlvIdyQLzeEfWfGFFbd9` |
| Audience | `https://scoutx.app/api` (custom ScoutX API with RBAC — **not** Management API) |
| ScoutX callback | `http://localhost:5173` |
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
2. Find **FIRSTSTEP Test Application** (`x2ginS1tSrJizlvIdyQLzeEfWfGFFbd9`).
3. Toggle it **Authorized** / ON.
4. If it asks for permissions, grant whatever scopes you defined (or leave empty if none).
5. **Save**.

Alternate path: **Applications → FIRSTSTEP Test Application → APIs** → authorize **ScoutX API**.

Do **not** try to enable RBAC on Auth0 Management API (System API — those toggles are not available).

Set ScoutX env:
- `VITE_AUTH0_AUDIENCE=https://scoutx.app/api`
- `AUTH0_API_AUDIENCE=https://scoutx.app/api`

Ignore Auth0’s sample Node snippet (`jwtCheck` Express demo) — ScoutX already validates tokens in `server/src/middlewares/auth0.ts`.

## Auth0 Dashboard checklist

1. Open **FIRSTSTEP (Test Application)** (`x2ginS1tSrJizlvIdyQLzeEfWfGFFbd9`).
2. Keep First Step URLs (`http://localhost:5174`, …).
3. Add ScoutX Allowed Callback / Logout / Web Origins: `http://localhost:5173`, `/login`, `/user/login`.
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
   - Login via `/user/login` or `/login`: `ScoutX_Admin` is redirected to `/dashboard` (shared ops owner). UI shows the Auth0 actor email; scrapers stay owned by `SCOUTX_OPS_USER_ID`.
8. Do **not** change First Step `user_metadata.role`.

## Login flow

1. SPA: Auth0 Universal Login only.
2. `POST /auth/auth0/exchange` with Bearer access token (+ email from ID token).
3. Fetch First Step plan: `GET {FIRSTSTEP_API_BASE_URL}/firstStep/subscription/getByUserId?user_id={auth0Sub}` — stored on `scoutx_portal_users.firstStepPlan` (login still succeeds if First Step is down).
4. Admin → cookie JWT `{ id: <ops Mongo id> }` → `/dashboard`.
5. Everyone else → portal JSON + profile upsert → `/user`.
6. Logout clears ScoutX cookie **and** Auth0 (see `scoutxLogout.ts`).

## Hostname

See `docs/SCOUTX-HOSTNAME.md` for DNS/TLS on the droplet.
