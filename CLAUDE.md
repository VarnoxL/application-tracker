# CLAUDE.md

Browser extension (MV3) that extracts job posting details from any ATS page and logs them to a
personal Flask + MongoDB backend. Build plan and phase breakdown live in [PLAN.md](PLAN.md) —
read it before starting new work; don't duplicate it here.

## Stack

Extension: vanilla JS, no build step, no framework, no bundler.
Backend: Flask + pymongo, `gunicorn app:app` in prod.
Deploy: Docker → ECR → ECS Fargate. MongoDB Atlas. Secrets via AWS Secrets Manager.

## Layout

```
extension/     manifest.json, extract.js, popup.html, popup.js
backend/       app.py, test_app.py, requirements.txt, Dockerfile, .env.example
docker-compose.yml
```

Keep it flat. `app.py` stays one file until it genuinely hurts — three routes do not need
blueprints, a service layer, or a `src/`. Split when a real second concern appears, not in advance.

## Rules

**No build step in the extension.** No npm, no webpack, no TypeScript. It loads unpacked and it
stays that way. If something seems to need a bundler, it doesn't.

**No new dependency for what a few lines can do.** Current backend deps are Flask, pymongo,
gunicorn, python-dotenv. Adding to that list needs a reason stated in the PR/commit. Native
platform features first: `<input type="date">` over a date picker, CSS over JS.

**Canonicalize URLs before storing or comparing.** Strip query and fragment, lowercase host, drop
trailing slash. ATS links carry `gh_src`, `utm_*`, LinkedIn `refId`, Simplify referral params — the
same posting from three entry points must hash to one record. The unique `(user_id, url)` index is
load-bearing, not decorative.

**Every extracted field stays user-editable in the popup.** Workday and LinkedIn will return junk on
some postings. The fix is typing over it, not a parser rewrite.

**Extraction is JSON-LD first, meta tags second.** Never write per-ATS CSS selectors — they break on
every redesign and don't generalize. If a site has no `JobPosting` JSON-LD, the meta fallback plus
manual editing is the answer.

**Validate at the trust boundary.** `user_id`, `url`, `status`, and `date_applied` are validated on
write. `status` must be one of `Applied | OA | Interview | Offer | Rejected`. `raw_source` is
free-form on purpose — that's where ATS-specific noise goes.

**Error shape is `{"error": "..."}`** with honest codes: 400 bad body, 401 bad key, 404 missing,
409 conflict. The popup reads `.error` to display, so the key name is a contract.

**Never put secrets in the image or the repo.** Atlas connection string and API keys come from env
at runtime. `.env.example` is committed with comments; `.env` is not.

## Tests

`backend/test_app.py` — plain `assert`s under `if __name__ == "__main__"`. No pytest, no fixtures,
no mocking library. Run with `python test_app.py`.

Non-trivial logic leaves one runnable check behind: URL canonicalization, JSON-LD extraction,
status validation, dedup-on-duplicate-POST. Trivial one-liners need no test.

When a real ATS page mis-parses, save its HTML as a fixture in `backend/fixtures/` and add the
assertion before fixing. That's how the parser gets better without regressing.

## Git

**Never add `Co-Authored-By` trailers to commits.** No AI attribution, no "Generated with" footers.
Commit messages describe the change and nothing else.

**Show the diff before committing.** After every change, show the user the diff, then commit and
push, before starting the next part of the task.

## Commands

```
docker compose up                  # Flask + Mongo, local dev
python backend/test_app.py         # tests
```

Extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
Reload the extension after editing `extract.js`; the popup picks up changes on reopen.

## Deliberate simplifications

Marked with `ponytail:` comments in code. Shortcuts with a known ceiling name the ceiling and the
upgrade path. Deferred by decision, not oversight: Kubernetes (separate project), Firebase Auth
(API key until user #2), Notion sync (dropped), analytics. Don't add them back without asking.
