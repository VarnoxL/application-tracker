# Job Application Tracker

A browser extension that logs job applications as you make them.

Land on a posting — Greenhouse, Lever, Workday, LinkedIn, Indeed, anywhere — click the icon, and
the company, role, location, and date are pulled off the page and saved to your own tracker. Fields
stay editable before you hit save, because no parser gets every ATS right.

**Status: not built yet.** Nothing in this repo runs. See [PLAN.md](PLAN.md) for the build plan
and current phase.

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

## Running it

Once the backend exists:

```bash
docker compose up              # Flask + MongoDB
python backend/test_app.py     # tests
```

Then load the extension: `chrome://extensions` → enable Developer mode → **Load unpacked** →
select `extension/`.

## Layout

```
extension/     manifest.json, extract.js, popup.html, popup.js
backend/       app.py, test_app.py, requirements.txt, Dockerfile
docker-compose.yml
```

[CLAUDE.md](CLAUDE.md) documents the conventions and the deliberate simplifications.
