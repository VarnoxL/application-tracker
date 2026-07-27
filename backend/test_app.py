"""Run with: python test_app.py

Pure-function tests run anywhere. The round-trip test needs Mongo
(`docker compose up`) and skips itself if it can't reach one.
"""

import os

os.environ.setdefault("API_KEY", "test-key")

from bson import ObjectId  # noqa: E402
from app import STATUSES, apps, canonical, client, ensure_indexes  # noqa: E402
from app import app as flask_app  # noqa: E402


def test_canonical():
    # Tracking params are the whole reason this function exists: the same posting
    # reached from Simplify, LinkedIn, or directly must collapse to one URL.
    assert canonical("https://boards.greenhouse.io/acme/jobs/1?gh_src=abc") == \
        "https://boards.greenhouse.io/acme/jobs/1"
    assert canonical("https://job-boards.greenhouse.io/x/jobs/9?utm_source=simplify") == \
        "https://job-boards.greenhouse.io/x/jobs/9"
    assert canonical("https://www.linkedin.com/jobs/view/12345/?refId=xyz&trk=abc") == \
        "https://www.linkedin.com/jobs/view/12345"

    # host case and trailing slash
    assert canonical("https://BOARDS.Greenhouse.IO/acme/jobs/1/") == \
        "https://boards.greenhouse.io/acme/jobs/1"

    # fragments
    assert canonical("https://jobs.lever.co/acme/abc#apply") == \
        "https://jobs.lever.co/acme/abc"

    # surrounding whitespace, since this arrives from a browser input field
    assert canonical("  https://jobs.lever.co/acme/abc  ") == \
        "https://jobs.lever.co/acme/abc"

    for bad in ["", "not a url", "ftp://x.com/j", "javascript:alert(1)", "/relative/path"]:
        try:
            canonical(bad)
            raise AssertionError(f"expected ValueError for {bad!r}")
        except ValueError:
            pass


def test_statuses():
    assert STATUSES == ("Applied", "OA", "Interview", "Offer", "Rejected")


def test_viewer_auth():
    # The viewer is a browser page, so its key comes from ?key=, not the header.
    c = flask_app.test_client()
    assert c.get("/").status_code == 401
    assert c.get("/?key=wrong").status_code == 401


def mongo_available():
    try:
        client.admin.command("ping")
        return True
    except Exception:
        return False


def test_round_trip():
    """POST -> duplicate POST -> GET -> PATCH, against a real Mongo."""
    ensure_indexes()
    c = flask_app.test_client()
    auth = {"X-API-Key": "test-key"}
    url = "https://boards.greenhouse.io/testco/jobs/999"
    apps.delete_many({"url": url})

    r = c.post("/applications", headers=auth, json={
        "company": "TestCo", "role": "SWE Intern", "url": url + "?gh_src=x",
        "date_applied": "2026-07-23",
    })
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["url"] == url, "url should have been canonicalized"
    app_id = r.get_json()["id"]

    # Same posting via a different entry point: updates, does not duplicate.
    r = c.post("/applications", headers=auth, json={
        "company": "TestCo", "role": "Software Engineer Intern",
        "url": url + "?utm_source=linkedin", "date_applied": "2026-07-23",
    })
    assert r.status_code == 200, "duplicate POST should update, not insert"
    assert apps.count_documents({"url": url}) == 1
    assert r.get_json()["role"] == "Software Engineer Intern"

    r = c.get("/applications", headers=auth)
    assert r.status_code == 200
    assert any(d["id"] == app_id for d in r.get_json()["results"])

    r = c.patch(f"/applications/{app_id}", headers=auth, json={"status": "Interview"})
    assert r.status_code == 200 and r.get_json()["status"] == "Interview"

    assert c.patch(f"/applications/{app_id}", headers=auth,
                   json={"status": "Ghosted"}).status_code == 400
    assert c.patch("/applications/not-an-objectid", headers=auth,
                   json={"status": "Offer"}).status_code == 400
    assert c.get("/applications", headers={"X-API-Key": "wrong"}).status_code == 401
    assert c.post("/applications", headers=auth,
                  json={"url": url, "role": "x"}).status_code == 400  # no company

    assert c.delete(f"/applications/{app_id}", headers=auth).status_code == 204
    assert apps.count_documents({"_id": ObjectId(app_id)}) == 0  # actually gone
    assert c.delete(f"/applications/{app_id}", headers=auth).status_code == 404  # already gone

    apps.delete_many({"url": url})


if __name__ == "__main__":
    test_canonical()
    test_statuses()
    test_viewer_auth()
    if mongo_available():
        test_round_trip()
        print("ok (including round trip)")
    else:
        print("ok (pure tests only - start Mongo with `docker compose up` for the rest)")
