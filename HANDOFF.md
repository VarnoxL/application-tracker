# Handoff

Where this project stands and what to pick up next. For the full build plan see [PLAN.md](PLAN.md);
for conventions see [CLAUDE.md](CLAUDE.md).

## State: runs locally, not deployed

Phases 1–4 are built. The extension extracts and saves; the backend stores and dedups. What's left
is deploy (Phase 5) and using it for real (Phase 6). Nothing is on the internet yet.

## What works

- **Extension** — popup injects `extract.js` on click (`activeTab` + `chrome.scripting`, no content
  script, no background worker). JSON-LD first, meta-tag fallback. Every field editable before save.
- **Backend** — Flask, one file, four routes:
  - `POST /applications` — upserts on `(user_id, url)`; save twice = one record (201 insert / 200 update).
  - `GET /applications` — your list, newest first, paginated (`?page=`, `?per_page=` capped at 100).
  - `PATCH /applications/<id>` — change status.
  - `GET /health` — unauthenticated liveness check.
- **Database** — MongoDB, `applications` collection. Unique index on `(user_id, url)` is what makes
  dedup work; URLs canonicalized (query/fragment stripped, host lowercased) before storing.
- **Auth** — single `X-API-Key` shared secret from env. Not an LLM/OpenAI key — a password you
  generate for your own backend.
- **Tests** — `backend/test_app.py`, plain asserts, `python test_app.py`.

## How to run

Docker provides Flask + Mongo; no local Python packages needed.

```bash
cp backend/.env.example backend/.env
python -c "import secrets; print(secrets.token_urlsafe(32))"   # paste into API_KEY=
docker compose up                                              # backend on :5000
curl localhost:5000/health                                     # → {"status":"ok"}
```

Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/`.
First save prompts for the API key — paste the same string from `.env`.

## Open work

- **No viewer.** Saving works; there's no UI to browse saved applications. Today the only read path
  is `curl -H "X-API-Key: KEY" localhost:5000/applications`. Smallest fix: a `GET /applications` HTML
  page served by Flask (one route + one template), or a list tab in the popup.
- **Not deployed** (Phase 5): ECR → ECS Fargate, MongoDB Atlas, connection string via Secrets
  Manager, CloudWatch logs.
- **Single-user by design.** One key, one `USER_ID`, both from env. A second user needs an
  `api_keys` collection (key → user_id); the code already threads `user_id` through every query in
  anticipation. Firebase Auth is the fuller upgrade path. See the `ponytail:` note in `app.py`.
- **Local tests** need `pip install -r backend/requirements.txt` (`pymongo`/`bson`). Not required to
  run the app — Docker already has them.

## Deploy touch points

The backend URL is `http://localhost:5000` in two places that change together when this deploys:
`API` at the top of [popup.js](extension/popup.js#L1) and `host_permissions` in
[manifest.json](extension/manifest.json#L7).
