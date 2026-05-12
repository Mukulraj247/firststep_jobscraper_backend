# SIA Partners job list (opportunities)

Use this as a reference when creating or configuring an automation for  
[Job Offers – filtered opportunities](https://www.sia-partners.com/en/opportunities?experience=Experienced&country=in&page=1).

## Start URL

Use the filtered URL from the site (country, experience, city, etc.). Example:

`https://www.sia-partners.com/en/opportunities?experience=Experienced&country=in&page=1`

## List extraction (Cloud Configure)

| Setting | Value |
|--------|--------|
| **Item selector** | `div.bloc_result` |
| **Unique key** | `link` |

### Field mapping (JSON)

If your database columns are **`jobTitle`**, **`companyName`**, **`location`**, **`jobCategory`**, **`jobUrl`**, **`jobDescription`**, map **names to match those keys** and point each selector at the correct element:

```json
{
  "jobTitle": "p.title_result",
  "location": "p.adress",
  "jobCategory": "span.tag_role",
  "jobUrl": "a[href*=\"/en/career/\"]@href",
  "jobDescription": "p.title_result",
  "companyName": "SIA Partners@fixed"
}
```

- **`jobTitle`** must use **`p.title_result`** (the role name). Do **not** map `jobTitle` to **`span.tag_role`** — that field is only the department tag (**AI & Tech**, **Internal Role**, etc.) and belongs in **`jobCategory`**.
- **`companyName`**: cards usually omit the employer; use a **fixed** value `SIA Partners@fixed` (same pattern as list extractor `fixed` attribute), or leave empty and rely on server normalization for SIA career URLs.
- **`location`** must use **`p.adress`** — do not put that selector on **`companyName`**.
- Location uses the site’s class spelling **`adress`**, not `address`.

Smaller schema (title / location / category / link) example:

```json
{
  "title": "p.title_result",
  "location": "p.adress",
  "category": "span.tag_role",
  "link": "a[href*=\"/en/career/\"]@href"
}
```

**Item selector** should target only real job cards (e.g. `div.bloc_result` inside the opportunities list). If you still see rows whose URLs start with `/our-capabilities/` or `/insights/`, tighten the selector or rely on the server dropping those URLs for `sia-partners.com`.

### Company column

Cards usually **do not** repeat the employer name; preview used to show **Culture** because nav markup uses classes like `company-culture`. The extension now filters that and falls back to **`og:site_name`** (e.g. **SIA Partners**) when fixing the company field. Rebuild the extension and preview again. Alternatively map **category** to `span.tag_role` (“AI & Tech”) and omit **company**, or set company to a **fixed** value in the list tool if your build supports it.

## Pagination

### Option A – Next button (recommended for Playwright runs)

Drupal pager markup includes a standard next link. Verified selector:

```text
nav.pager li.pager__item--next a[rel="next"]
```

Configure under **List extraction**:

- **List pagination**: `next-button`
- **List next button selector**: `nav.pager li.pager__item--next a[rel="next"]`
- **Max pages**: set as needed (e.g. `10`)

### Option B – URL `page` parameter

After the server fix in `listExtractor.paginateByPageNumber`, **page-number-loop** advances correctly even when the start URL already contains `page=1`.

Configure:

- **List pagination**: `page-number-loop`
- **Page query param**: `page`
- **Start page**: match the first page index in your start URL (`1` for `?page=1`; use `0` if your listing starts at `page=0`).
- **Max pages**: as needed

If results use mixed indexing, prefer **Option A**.

## Chrome extension

1. Build: from the repo root, `cd chrome-extension` and run `npm run build` (uses `tsc` + Vite; if the process runs out of memory, close other apps or use `npm run build:no-check` to skip `tsc` only for a dev build).
2. Chrome → Extensions → **Load unpacked** → select `chrome-extension/dist`.
3. Set **backend URL** (e.g. `http://localhost:8080/api`) and **API key** from the dashboard.
4. On the opportunities URL, wait for cards to load, select one repeating `div.bloc_result`, map fields, then send/save. Optional: set pagination in the extension before pushing to the server.
