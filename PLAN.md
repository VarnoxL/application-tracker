# Job Application Tracker Extension

## Context

Applying to jobs this cycle means landing on a different ATS every time — Greenhouse, Lever,
Workday, LinkedIn, Indeed — and logging each one by hand into a spreadsheet. The manual step is
what actually gets skipped, so the tracker goes stale and there's no honest picture of how many
applications are out and where each one stands.

This builds a Manifest v3 browser extension that detects a job posting page, extracts the details,
and logs them to a personal backend in one click. Backend is Flask + MongoDB, containerized with
Docker, deployed on AWS. Kubernetes is explicitly out of scope — planned as a separate exercise
later, migrating a system that already works rather than learning K8s and building at once.

Greenfield project. `cougar-planner` (Flask + Postgres + Firebase) and `internship-scraper` are
reference only — nothing is being ported wholesale.

## Phase 0 — Repo

Not a git repo yet. `gh` is authenticated as **VarnoxL** with `repo` scope; git identity is
Daniel Liu <danielliu070809@gmail.com>.

- `.gitignore` — `.env`, `__pycache__/`, `*.pyc`, `.venv/`, `backend/fixtures/*.html` stays
  *tracked* (they're test data, not junk).
- `git init`, commit the three docs already written (PLAN.md, CLAUDE.md, README.md).
- `gh repo create application-tracker --private --source=. --push`

**Private, not public.** It's unbuilt and will hold your real application history the moment you
dogfood it. Flipping to public later is one command; un-publishing a repo that was indexed is not.
Say so now if you want it public from the start.

## Target layout

```
application tracker/
  extension/
    manifest.json
    extract.js         # runs in page, returns job fields
    popup.html
    popup.js
    icon.png
  backend/
    app.py             # all 3 routes, one file
    test_app.py        # assert-based, no framework
    requirements.txt
    Dockerfile
    .env.example
  docker-compose.yml
  README.md
```

Eight files. No blueprints, no `src/`, no service layer — three routes do not need a package.

---

## Phase 1 — Extension (MV3)

**Recommended deviation from the original plan:** no declared `content_scripts` and no background
service worker. The popup injects `extract.js` on demand via `activeTab` + `chrome.scripting.executeScript`,
then does the `fetch` itself.

Why: a declared content script runs on every page load whether or not you click, needs a
message-passing round trip, and pins you to a hardcoded match list that goes stale the first time
you hit an Ashby or SmartRecruiters posting. `activeTab` grants host access only for the tab you
clicked on, so the install prompt stays clean and the extension works on *any* ATS. It also deletes
the background worker outright — nothing needs to run when the popup is closed.

If you'd rather keep the declared-matches + background-worker structure for the practice, say so
and I'll build that instead; it's ~30 lines more.

- `manifest.json` — `manifest_version: 3`, `permissions: ["activeTab", "scripting", "storage"]`,
  `host_permissions` for the backend origin only, `action.default_popup: popup.html`.
- `extract.js` — returns `{company, role, location, url, date_posted, source}`:
  1. **Primary:** scan every `script[type="application/ld+json"]`, `JSON.parse` in a `try`, flatten
     arrays *and* `@graph` nesting, find `@type === "JobPosting"`. Pull `title`,
     `hiringOrganization.name`, `jobLocation.address.{addressLocality,addressRegion}`, `datePosted`.
  2. **Fallback:** `og:title` / `og:site_name` meta, then `document.title`, then hostname for company.
  3. Always set `url` to the canonicalized URL (see Phase 3) and `source` to the hostname.
- `popup.html` / `popup.js` — five text inputs pre-filled from the extraction, all editable, one
  **Save Application** button. API key read from `chrome.storage.sync`; if unset, the popup shows a
  key field first. Native `<input type="date">`, no date library.

Every field is editable because Workday and LinkedIn will return junk on some postings and the fix
should be typing over it, not a bug report.

## Phase 2 — Backend (Flask)

Single `app.py`. Three routes:

- `POST /applications` — `{company, role, url, date_applied, status, location, raw_source}`.
  Upserts on `(user_id, url)` so re-saving the same posting updates rather than duplicating.
- `GET /applications` — the caller's applications, newest first. Paginated with a
  `min(per_page, 100)` cap.
- `PATCH /applications/<id>` — status transitions: `Applied → OA → Interview → Offer | Rejected`.
  Validate against that list; reject anything else with 400.

**Auth:** `X-API-Key` header → `user_id`, one small `@require_key` decorator using
`hmac.compare_digest` for the comparison. Keys live in an `api_keys` collection.

Firebase Auth is the documented upgrade path for multi-user, and `cougar-planner`'s
`backend/app/utils/auth.py` decorator drops in nearly unchanged when that day comes — including
its two non-obvious details worth keeping: re-raise `HTTPException` so a 404 inside a wrapped view
isn't swallowed into a bogus 401, and catch bare `Exception` → 401 rather than leaking a 500.
Not building it now — one user does not need an identity provider.

Error shape is `{"error": "..."}` with honest codes: 400 bad body, 401 bad key, 404 missing, 409 conflict.

## Phase 3 — Database (MongoDB)

`pymongo`, module-level `MongoClient` singleton. One `applications` collection.

- Compound index on `(user_id, date_applied desc)` — the only query the list endpoint makes.
- **Unique** index on `(user_id, url)` — this is what makes the upsert idempotent and stops
  double-clicking Save from creating two rows.

**URL canonicalization matters more than it looks.** ATS links carry `?gh_src=`, `?utm_*`,
LinkedIn `?refId=`, and Simplify's own referral params — the same posting reached from Simplify vs.
directly is the same job with different query strings. Strip the query and fragment, lowercase the
host, drop a trailing slash before storing or comparing. Without this the dedup index is decorative.

Schema stays loose (`raw_source` holds whatever the page gave us) since ATS platforms expose
different fields — but `user_id`, `url`, `status`, and `date_applied` are validated on write.

**Check (Phase 2+3):** `test_app.py`, plain asserts under `if __name__ == "__main__"`. Covers URL
canonicalization, JSON-LD extraction against three saved real-page HTML fixtures, the status
transition validator, and that a duplicate POST updates instead of inserting. No pytest, no
fixtures, no mocking library.

## Phase 4 — Containerize

- `backend/Dockerfile` — `python:3.12-slim`, requirements layer cached separately from source,
  `gunicorn app:app` as CMD, non-root user.
- `docker-compose.yml` — Flask + `mongo:7` with a named volume, so local dev is `docker compose up`.
- Verify: `docker compose up` on a clean checkout, save one real application end to end.

## Phase 5 — Deploy (AWS, no K8s)

- Build and push the image to **ECR**.
- Run it on **ECS Fargate** — one task, one service. (Plain EC2 is the alternative if you
  specifically want the lower-level VPC/security-group/IAM reps; it's more setup for the same result.)
- **MongoDB Atlas** free tier rather than self-hosted Mongo — keeps this phase about the deploy path.
  Atlas connection string goes in Secrets Manager, injected as a task env var, never in the image.
- CloudWatch log group attached to the task definition via the `awslogs` driver.
- Point the extension's `host_permissions` and API base URL at the deployed origin.

## Phase 6 — Dogfood & iterate

Use it for real applications. Expect the ATS parsers to be where it breaks — Workday's JS-rendered
DOM and LinkedIn's markup churn are the likely offenders, and the extension running in-page is the
reason this is tractable at all (no headless browser needed). Save the HTML of anything that
mis-parses and add it as a test fixture, then fix.

Chrome Web Store publishing only after it survives a real cycle.

## Explicitly deferred

- **Kubernetes** — separate project. Re-platform this or CougarPlanner onto EKS once there's a
  working system to migrate.
- **Notion sync** — dropped; per-user Notion API keys don't scale past you.
- **Firebase Auth** — API key until there's a second user.
- **Analytics / charts / reminder emails** — none of it until Phase 6 says the core loop works.

## Verification

1. `cd backend && python test_app.py` — asserts pass.
2. `docker compose up`, then `curl -H "X-API-Key: dev" localhost:5000/applications` → `[]`.
3. Load `extension/` unpacked at `chrome://extensions` (Developer mode → Load unpacked).
4. Open a real posting on each of Greenhouse, Lever, Workday, LinkedIn, Indeed. Click the icon.
   Confirm company/role/location are right — note which need the fallback path.
5. Click Save. Re-run the `GET` and confirm the record.
6. Click Save again on the same posting → still one record (dedup index works).
7. `PATCH` its status to `Interview`, confirm via `GET`.
8. Post-deploy: repeat 4–7 against the Fargate URL and confirm the logs land in CloudWatch.
