# n8n: Maxun pending extracted rows → `jobs`

Imports workflow: [`maxun-pending-to-jobs.workflow.json`](maxun-pending-to-jobs.workflow.json).

## 1. MongoDB credential (required)

1. In n8n: **Credentials → New → MongoDB**.
2. Use **Connection string** (recommended) with the same URI as `MONGODB_URI` in your `.env` (Atlas string including user/password).
3. Set **Database name** to `firststep_db` (must match `MONGODB_DATABASE` / your Atlas database name in the connection URI).
4. Test the credential.

Do **not** commit credentials or paste them into the workflow JSON.

## 2. Import workflow

**Workflow → Import from file** → select `maxun-pending-to-jobs.workflow.json`.

Open each **MongoDB** node and attach your **MongoDB** credential.

### Testing

- Run **Execute workflow** from **Every 30 minutes** (or activate and wait for the schedule). That loads **Find pending extracted** → **Prepare** with real items.
- Opening **Prepare** (or any downstream node) and clicking **Execute step** **without** running upstream in the same execution shows **No data** in INPUT — that is normal; n8n does not reuse the last run’s items unless you pin data or test from the trigger.

The workflow does **not** use **Split In Batches**: **Find** returns many items, **Prepare** maps them in one Code run, and MongoDB nodes process **each item** automatically.

## 3. Replace `createdBy`

Edit the **Prepare update + job row** Code node:

- Set `CREATED_BY` to your real Auth0 subject (e.g. `auth0|68d3cda0296625bc7b7d11ac`).

`job_creation_type` is set to **`automation`** (aligned with Maxun). To match legacy samples, change it to `job_collector` in the same Code node.

## 4. Activate

Turn the workflow **Active**. It runs **every 30 minutes**, processes up to **100** pending rows per run (oldest first), and for each row:

1. Updates `maxun_extracteddata`: `data.status` → `active`
2. Inserts a flat document into **`jobs`** (same shape as your sample; no `sectorIndustry` / `f500` / `fee` / `security`)

The **MongoDB Update** node only forwards `_id` and `data.status`. **Shape job for insert** runs **once for all items** and maps **`$('Prepare update + job row').all()`** (do **not** use per-item mode with `$input.itemIndex` here — n8n only exposes one paired Prepare row per iteration, so indexing breaks after the first item).

## 5. Atlas / networking

- Allow n8n’s outbound IPs (n8n Cloud) or your self-hosted host on **MongoDB Atlas → Network Access**.

## Optional: duplicate `jobId` in `jobs`

If `jobId` must be unique:

- Add a **MongoDB Find** on `jobs` with query `{"jobId": "=<expression from previous node>"}` before **Insert into jobs**, then an **IF** to skip insert when a document exists; still run **Mark extracted active** so Maxun rows do not stay `pending` forever.

Or handle duplicate-key errors on a unique index with **Continue On Fail** only if you accept partial failures.
