# Job Application Tracker

A browser extension that logs job applications as you make them.

Land on a posting — Greenhouse, Lever, Workday, LinkedIn, Indeed, anywhere — click the icon, and
the company, role, location, and date are pulled off the page and saved to your own tracker. Fields
stay editable before you hit save, because no parser gets every ATS right.

**Status: runs locally.** Extension and backend are built (Phases 1–4). Not deployed yet — Phase 5
(ECR → Fargate → Atlas) and Phase 6 (dogfooding) are open. See [PLAN.md](PLAN.md).

## Why

Tracking applications by hand is the step that gets skipped, so the spreadsheet goes stale and
there's no honest picture of how many are out or where each one stands. The fix is making the
logging cost one click instead of a tab-switch and five fields of typing.

## How it works

Job boards publish [schema.org `JobPosting`](https://schema.org/JobPosting) JSON-LD in the page
head — the same structured data Google uses to build job search results. The extension reads that
block directly, which means it works on ATS platforms nobody wrote specific code for. When a page
has no JSON-LD, it falls back to Open Graph and `<title>` meta tags and you correct the rest.

Running in-page also sidesteps the hard part of job scraping: Workday and LinkedIn render their
postings with JavaScript, so an external scraper would need a headless browser. The extension is
already inside the rendered DOM.

## Stack

| | |
|---|---|
| Extension | Vanilla JS, Manifest v3, no build step |
| Backend | Flask + MongoDB |
| Container | Docker, docker-compose for local dev |
| Deploy | AWS ECR → ECS Fargate, MongoDB Atlas, CloudWatch |

Kubernetes is deliberately not part of this project — it's planned as a separate exercise, migrating
a system that already works rather than learning K8s and building at the same time.

## API

All routes take an `X-API-Key` header. Errors come back as `{"error": "..."}`.

| | |
|---|---|
| `GET /?key=API_KEY` | The viewer — an HTML table of your applications, newest first. Open it in a browser. |
| `POST /applications` | Save a posting. Upserts on `(user_id, url)`, so saving twice updates instead of duplicating — 201 on insert, 200 on update. |
| `GET /applications` | Same list as JSON. `?page=` and `?per_page=` (capped at 100). |
| `PATCH /applications/<id>` | Change status: `Applied \| OA \| Interview \| Offer \| Rejected`. |
| `GET /health` | Unauthenticated liveness check. |

To see what you've logged, open `http://localhost:5000/?key=YOUR_API_KEY` in a browser. The JSON
routes take the key as an `X-API-Key` header; the viewer takes it as `?key=` because a browser
can't set headers on plain navigation.

## Running it

```bash
cp backend/.env.example backend/.env    # set API_KEY
docker compose up                       # Flask on :5000 + MongoDB
python backend/test_app.py              # tests (needs backend/requirements.txt installed)
```

Then load the extension: `chrome://extensions` → enable Developer mode → **Load unpacked** →
select `extension/`. Open a posting, click the icon, paste the same `API_KEY` on first run — it's
stored in `chrome.storage.sync` and asked for once. Browse what you've saved at
`http://localhost:5000/?key=YOUR_API_KEY`.

The backend URL is `http://localhost:5000` in two places, both of which change together when this
deploys: `API` at the top of [popup.js](extension/popup.js#L1) and `host_permissions` in
[manifest.json](extension/manifest.json#L7).

## Layout

```
extension/     manifest.json, extract.js, popup.html, popup.js
backend/       app.py, test_app.py, requirements.txt, Dockerfile, .env.example
docker-compose.yml
```

No content script and no background service worker — the popup injects `extract.js` on demand with
`activeTab` + `chrome.scripting`, so it works on any ATS without a match list and nothing runs when
the popup is closed.

[CLAUDE.md](CLAUDE.md) documents the conventions and the deliberate simplifications.
