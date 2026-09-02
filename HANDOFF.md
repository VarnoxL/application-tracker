# Handoff

Where this project stands and what to pick up next. For the full build plan see [PLAN.md](PLAN.md);
for conventions see [CLAUDE.md](CLAUDE.md).

## State

Two tracks are open at once — read both before starting:

| Branch | State |
|---|---|
| `main` | Phases 1–4 built, runs locally, **not deployed**. Unchanged. |
| `resume-autofill` | **In progress.** Resume import + application autofill. Parser done and tested; popup work unverified; autofill not started. |

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

## Uncommitted and UNVERIFIED — start here

`git status` shows two modified files. **They have never been loaded in a browser.** No syntax check,
no click-through. Treat them as a draft, not working code.

- `extension/popup.html` (+142/−~10) — 3-tab nav (Log / Saved / Profile) replacing the old single
  toggle link; profile view with resume file input, contact fields, education/experience row
  editors, skills, and the "Application answers" block.
- `extension/popup.js` (+285/−~47) — now an ES module (`<script type="module">`) importing
  `resume.js`; pdf.js worker wiring, import→parse→store, profile render/collect, base64 of the PDF.

**First thing to do:** load the extension unpacked, open the popup, and check the console. Likely
suspects if it fails:

1. `pdfjsLib` undefined — `vendor/pdf.min.js` must load as a classic script *before* the module.
2. MV3 CSP blocking pdf.js. If the console says so, add to `manifest.json`:
   `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"}`
3. Worker path — `pdf.worker.min.js` is addressed via `chrome.runtime.getURL`, same-origin, so it
   should need no `web_accessible_resources` entry.

To throw the draft away and keep the tested parser:
`git checkout -- extension/popup.html extension/popup.js`

## Not started

1. **`extension/autofill.js`** — injected like `extract.js`, but reads the profile itself from
   `chrome.storage.local`. It must be a plain script, not a module: `chrome.scripting.executeScript`
   does **not** allow `args` together with `files`, only with `func`.

   Match in this order: `autocomplete` attribute (`given-name`, `family-name`, `email`, `tel`,
   `address-level2/1`, `country`, `organization`, `url`) → `type` → label text from `<label for>`,
   wrapping `<label>`, `aria-label`, `aria-labelledby`, `placeholder`, then `name`/`id`. Score and
   take the best above a threshold; **leave a field alone rather than guess** — a wrong value
   silently submitted is worse than a blank.

   **Writing text values requires the native setter**, not `el.value =`:
   ```js
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
   el.dispatchEvent(new Event("input",  { bubbles: true }));
   el.dispatchEvent(new Event("change", { bubbles: true }));
   ```
   Greenhouse and Lever are React-backed; a direct assignment does not update React state and the
   value vanishes on submit. This is not optional.

   `<select>`: normalize option text, match exact → `startsWith` → `includes`. Radios: group by
   `name`, match option labels the same way. Outline what was filled. **Never auto-submit.**

2. **"Autofill this page" button** in the popup —
   `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["autofill.js"] })`.
   `allFrames` matters: Greenhouse and Lever forms are often in an iframe. Sum the per-frame counts
   and report "Filled N fields."

3. **Attach the resume file** — rebuild a `File` from `profile.resume.data` and assign via
   `DataTransfer` to file inputs whose label matches `resume`/`cv`, then dispatch `change`.

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
- **Scanned/image PDFs** have no text layer; the popup detects empty extraction and says so rather
  than saving an empty profile.

## Verification for this track

```bash
node extension/test_resume.js   # parser asserts
python backend/test_app.py      # must still pass - this feature touches no backend code
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
