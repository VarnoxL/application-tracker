import hmac
import os
from datetime import date, datetime, timezone
from functools import wraps
from urllib.parse import urlsplit, urlunsplit

from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
from flask import Flask, g, jsonify, render_template_string, request
from pymongo import ASCENDING, DESCENDING, MongoClient, ReturnDocument

load_dotenv()
app = Flask(__name__)

client = MongoClient(
    os.getenv("MONGO_URI", "mongodb://localhost:27017"),
    serverSelectionTimeoutMS=3000,  # fail fast instead of the 30s default
)
apps = client[os.getenv("MONGO_DB", "tracker")].applications

STATUSES = ("Applied", "OA", "Interview", "Offer", "Rejected")

# ponytail: one key, one user, both from env. Move to an api_keys collection at user #2.
API_KEY = os.getenv("API_KEY", "")
USER_ID = os.getenv("USER_ID", "me")


def ensure_indexes():
    apps.create_index([("user_id", ASCENDING), ("date_applied", DESCENDING)])
    # Load-bearing: this is what makes the upsert in create() idempotent.
    apps.create_index([("user_id", ASCENDING), ("url", ASCENDING)], unique=True)


# Idempotent, so running on every boot repairs a missing index. Wrapped because
# test_app.py imports this module to test pure functions without a running Mongo;
# docker-compose waits on a healthcheck so the real startup path never lands here.
try:
    ensure_indexes()
except Exception as exc:
    app.logger.warning("index creation deferred: %s", exc)


def canonical(url):
    """Strip query and fragment, lowercase host, drop trailing slash."""
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("url must be http(s)")
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path.rstrip("/"), "", ""))


def require_key(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        sent = request.headers.get("X-API-Key", "")
        # compare_digest is constant-time, so a wrong key leaks nothing via timing.
        if not API_KEY or not hmac.compare_digest(sent, API_KEY):
            return jsonify({"error": "bad api key"}), 401
        g.user_id = USER_ID
        return f(*args, **kwargs)

    return wrapper


def serialize(doc):
    doc["id"] = str(doc.pop("_id"))
    return doc


@app.post("/applications")
@require_key
def create():
    body = request.get_json(silent=True) or {}

    try:
        url = canonical(body.get("url", ""))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    company = (body.get("company") or "").strip()
    role = (body.get("role") or "").strip()
    if not company or not role:
        return jsonify({"error": "company and role are required"}), 400

    status = body.get("status", "Applied")
    if status not in STATUSES:
        return jsonify({"error": f"status must be one of {', '.join(STATUSES)}"}), 400

    date_applied = body.get("date_applied") or date.today().isoformat()
    try:
        date.fromisoformat(date_applied)  # ISO strings sort correctly, so store the string
    except ValueError:
        return jsonify({"error": "date_applied must be YYYY-MM-DD"}), 400

    result = apps.update_one(
        {"user_id": g.user_id, "url": url},
        {
            "$set": {
                "company": company,
                "role": role,
                "location": (body.get("location") or "").strip(),
                "status": status,
                "date_applied": date_applied,
                "raw_source": body.get("raw_source"),
            },
            "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    doc = apps.find_one({"user_id": g.user_id, "url": url})
    return jsonify(serialize(doc)), 201 if result.upserted_id else 200


@app.get("/applications")
@require_key
def index():
    page = max(request.args.get("page", 1, type=int), 1)
    per_page = min(max(request.args.get("per_page", 20, type=int), 1), 100)
    query = {"user_id": g.user_id}
    cursor = (
        apps.find(query)
        .sort("date_applied", DESCENDING)
        .skip((page - 1) * per_page)
        .limit(per_page)
    )
    return jsonify(
        {
            "page": page,
            "per_page": per_page,
            "total": apps.count_documents(query),
            "results": [serialize(d) for d in cursor],
        }
    )


@app.patch("/applications/<id>")
@require_key
def update_status(id):
    try:
        oid = ObjectId(id)
    except (InvalidId, TypeError):
        return jsonify({"error": "bad id"}), 400

    status = (request.get_json(silent=True) or {}).get("status")
    if status not in STATUSES:
        return jsonify({"error": f"status must be one of {', '.join(STATUSES)}"}), 400

    # user_id in the filter, not just the decorator: authentication is not authorization.
    doc = apps.find_one_and_update(
        {"_id": oid, "user_id": g.user_id},
        {"$set": {"status": status}},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        return jsonify({"error": "not found"}), 404
    return jsonify(serialize(doc))


PAGE = """<!doctype html>
<title>Applications</title>
<style>
  body { font: 15px system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
  h1 { font-size: 1.3rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #ddd; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  tr:hover td { background: #f6f6f6; }
  .status { font-size: .8rem; padding: .1rem .5rem; border-radius: 1rem; background: #eee; }
  a { color: inherit; }
  .empty { color: #666; }
</style>
<h1>Applications <span class="empty">({{ apps|length }})</span></h1>
{% if apps %}
<table>
  <tr><th>Applied</th><th>Company</th><th>Role</th><th>Location</th><th>Status</th></tr>
  {% for a in apps %}
  <tr>
    <td>{{ a.date_applied }}</td>
    <td>{{ a.company }}</td>
    <td><a href="{{ a.url }}" target="_blank" rel="noopener">{{ a.role }}</a></td>
    <td>{{ a.location }}</td>
    <td><span class="status">{{ a.status }}</span></td>
  </tr>
  {% endfor %}
</table>
{% else %}
<p class="empty">Nothing logged yet. Save one from the extension.</p>
{% endif %}
"""


@app.get("/")
def viewer():
    # Browser navigation can't set X-API-Key, so the page takes the key as ?key=.
    # ponytail: query-param key is fine for a single-user localhost tool; it lands in
    # browser history and access logs, so move to a session cookie if this goes multi-user.
    key = request.args.get("key", "")
    if not API_KEY or not hmac.compare_digest(key, API_KEY):
        return "add ?key=YOUR_API_KEY to the URL", 401
    docs = list(apps.find({"user_id": USER_ID}).sort("date_applied", DESCENDING))
    return render_template_string(PAGE, apps=docs)


@app.delete("/applications/<id>")
@require_key
def delete(id):
    try:
        oid = ObjectId(id)
    except (InvalidId, TypeError):
        return jsonify({"error": "bad id"}), 400
    # user_id in the filter so you can only delete your own.
    result = apps.delete_one({"_id": oid, "user_id": g.user_id})
    if not result.deleted_count:
        return jsonify({"error": "not found"}), 404
    return "", 204


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    app.run(debug=True)
