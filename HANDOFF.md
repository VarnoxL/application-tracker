# Handoff

Where this project stands and what to pick up next. For the full build plan see [PLAN.md](PLAN.md);
for conventions see [CLAUDE.md](CLAUDE.md).

## State

Two tracks are open at once — read both before starting:

| Branch | State |
|---|---|
| `main` | Phases 1–4 built, runs locally, **not deployed**. Unchanged. |
| `resume-autofill` | **Feature-complete, unverified.** Resume import + application autofill all written and committed. Parser and field matching are tested; nothing has been loaded in a browser yet. |

---

# Track 1 — `main`: runs locally, not deployed

Phases 1–4 are built. The extension extracts and saves; the backend stores and dedups. What's left
is deploy (Phase 5) and using it for real (Phase 6). Nothing is on the internet yet.

## What works

- **Extension** — popup injects `extract.js` on click (`activeTab` + `chrome.scripting`, no content
  script, no background worker). JSON-LD first, meta-tag fallback. Every field editable before save.
- **Backend** — Flask, one file, five routes:
  - `GET /?key=API_KEY` — the viewer: HTML table of your applications, newest first (open in browser).
  - `POST /applications` — upserts on `(user_id, url)`; save twice = one record (201 insert / 200 update).
  - `GET /applications` — same list as JSON, paginated (`?page=`, `?per_page=` capped at 100).
  - `PATCH /applications/<id>` — change status.
  - `GET /health` — unauthenticated liveness check.
- **Viewer** — `http://localhost:5000/?key=YOUR_API_KEY`. Key via query param (browser can't set
  headers on navigation); Jinja autoescaping handles XSS from arbitrary page data.
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

---

# Track 2 — `resume-autofill`: import a resume, autofill the application

Import a resume PDF once, parse it into a structured profile stored locally, then fill the
application form on any ATS page in one click. Full plan (written before implementation):
`C:\Users\danie\.claude\plans\ok-i-want-to-functional-comet.md`.

Backend and Mongo are **untouched** by this feature — no new routes, no new Python deps.

## Decisions already made — don't relitigate

- **Parse in-browser with pdf.js.** The resume is PII; it never leaves the machine. Stored in
  `chrome.storage.local`, not the backend.
- **Full structured parse** — contact fields *and* work history / education entries.
- **Autofill targets dropdowns and radios**, not just text inputs.
- **The profile is two halves.** Work authorization, sponsorship, EEO/demographics and pronouns are
  *not on a resume* but are exactly the dropdowns ATS forms ask about. So:
  ```
  profile = { parsed: {...from the PDF...}, answers: {...set by hand once...}, resume: {name,type,data} }
  ```
  `answers` must survive a resume re-import. `resume.data` is the PDF as base64, kept for the
  form's file-upload field.

## Done and pushed

| Commit | What |
|---|---|
| `cdadad5` | Vendored pdf.js 3.11.174 (legacy UMD) into `extension/vendor/`. Also gitignores `.claude/`. |
| `0aef88c` | `extension/resume.js` parser + `extension/test_resume.js` + root `package.json`. |
| `b271657` | Popup resume import + profile editor (`popup.html`, `popup.js`). |
| `9124a97` | CLAUDE.md rule: stop and ask before coding a judgment call. |
| `44ba2c0` | `extension/autofill.js` + `extension/test_autofill.js`. |

- `extension/resume.js` — two pure exports, no DOM and no pdf.js import:
  - `linesFrom(items)` rebuilds visual lines from pdf.js x/y coordinates. Reading order alone
    interleaves columns and is unparseable. A wide intra-line gap survives as a tab (`GAP`) — that's
    what separates a company from its right-aligned dates. Items must carry `page`, or page 2 merges
    into page 1 where y values collide.
  - `parseProfile(lines)` → `{name, firstName, lastName, email, phone, location, links{linkedin,
    github, website}, education[], experience[], skills[], rawText}`.
- Root `package.json` is only `{"private":true,"type":"module"}` — a module-type marker so `node`
  can import `resume.js`. **No npm, no dependencies, no install step.**

**Tests pass:** `node extension/test_resume.js` → `ok`. Covers line rebuilding (column gaps, page
separation, x ordering), contact extraction, both experience layouts, education + GPA, skills label
stripping, and quiet degradation on an empty/scanned PDF.

## Committed but UNVERIFIED — start here

Everything on this track is committed and none of it has been loaded in a browser. Syntax is
checked (`node --check` on all four extension scripts) and the pure logic is tested, but no
click-through has happened. Unproven, not working.

**First thing to do:** load the extension unpacked, open the popup, check the console. Likely
suspects if it fails:

1. `pdfjsLib` undefined — `vendor/pdf.min.js` must load as a classic script *before* the module.
2. MV3 CSP blocking pdf.js. If the console says so, add to `manifest.json`:
   `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"}`
3. Worker path — `pdf.worker.min.js` is addressed via `chrome.runtime.getURL`, same-origin, so it
   should need no `web_accessible_resources` entry.

To unwind the popup draft while keeping the tested parser: `git revert b271657`.

## Built, pending a real form

- **`extension/autofill.js`** — plain script; reads the profile from `chrome.storage.local`
  itself. Matches `autocomplete` → `type` → label text (`label[for]`, wrapping label,
  `aria-label`, `aria-labelledby`, `<legend>`, placeholder) → `name`/`id` at 0.9 weight. Every
  element/spec pair is scored and the strongest assigned first, so each spec fills one field and
  each field is filled once. Text goes through the native value setter with `input`+`change`.
  Selects and radio groups match option text exact → prefix → substring either direction.
  Nothing is ever submitted.
- **Autofill button** — fixed bar under the nav, visible on every tab. Injects with
  `allFrames: true` and sums the per-frame counts.
- **Resume attach** — same click as the field fill, rebuilt from `profile.resume.data` via
  `DataTransfer`.

### Decisions taken while building these — don't relitigate

- **Never overwrite a field that already has a value.** Leave it; outline it amber with the
  profile's value in `title` when the two disagree, green when filled. The report reads
  "Filled 12 fields, attached resume.pdf, left 2 already set — check the amber ones".
- **EEO/demographic answers autofill like any other field.** They are in the profile because
  you put them there.
- **Strict matching, one tunable constant.** `MATCH_THRESHOLD = 0.7` at the top of
  `autofill.js`. Blank beats wrong. Lower toward ~0.5 if real forms leave too much empty.
- **A `not` list on every spec.** "Preferred Name", "Company Name" and "Middle Name" all read
  like name fields, and the near misses are what actually bite.

## Not started

Nothing on this track. What remains is browser verification below, then Track 1's deploy.

## Known ceilings — by decision, not oversight

Each gets a `ponytail:` comment where it lives:

- **Multi-entry ATS sections.** Filling a second work-history row needs an "Add another" click
  first. Plan fills the *first* education and experience block; the rest stay manual.
- **Two-column resumes.** `linesFrom` groups by y, so two columns interleave into one line. Upgrade
  path: detect a bimodal x-distribution and segment columns first.
- **Entries with no date** are invisible to the experience splitter and get absorbed into the
  previous entry — the date range is what delimits entries.
- **Section headings are matched by keyword, not styling.** "Where I've Worked" won't be detected.
  Deliberate: mistaking an ALL-CAPS company name for a heading would drop every entry after it,
  which is the worse failure.
- **Workday** will do noticeably worse than Greenhouse/Lever (custom components, multi-step wizard).
  Consistent with the project's no-per-ATS-code stance.
- **An unlabelled file input** is assumed to be the resume when it's the only one on the page
  and nothing on it reads "cover letter"/"transcript". Drop that fallback in `attachResume`
  if a form ever attaches to the wrong slot.
- **`MATCH_THRESHOLD` is guesswork until real forms tune it.** Set against what Greenhouse and
  Lever markup looks like, not against a measured pass over real postings.
- **Scanned/image PDFs** have no text layer; the popup detects empty extraction and says so rather
  than saving an empty profile.

## Verification for this track

```bash
node extension/test_resume.js    # parser asserts
node extension/test_autofill.js  # field-matching asserts
python backend/test_app.py       # must still pass — this feature touches no backend code
```

Then, in the browser:

1. Load unpacked, import a real resume PDF, confirm the parsed fields; type over anything wrong.
2. Fill the `answers` block once.
3. Open a real application form on Greenhouse, Lever, and Workday. Autofill each. Confirm correct
   fields filled, filled controls outlined, count reported, **nothing submitted**.
4. On a React form (Greenhouse/Lever), click into and out of a filled field — the value must
   persist. That's what proves the native-setter path works.
5. Re-import a different resume; confirm `answers` survives.
6. Confirm the resume attaches to the form's file input.
7. On a page with no form: no errors, "Filled 0 fields."

## Git note

`CLAUDE.md` forbids `Co-Authored-By` trailers and AI attribution in commits. The commits on this
branch follow that.
