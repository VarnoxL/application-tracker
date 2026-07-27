const API = "http://localhost:5000";

const $ = (id) => document.getElementById(id);
const msg = (text, kind = "") => {
  $("msg").textContent = text;
  $("msg").className = kind;
};

let extracted = {}; // kept for raw_source; the form is the source of truth on save

async function extract() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["extract.js"],
    });
    return result ?? {};
  } catch {
    // chrome:// pages, the web store, and PDFs all refuse injection.
    msg("Can't read this page - fill it in by hand.", "error");
    return { url: tab.url ?? "" };
  }
}

async function init() {
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  if (!apiKey) {
    $("setup").hidden = false;
    msg("Set your API key to start.");
    return;
  }

  $("form").hidden = false;
  $("toggle").hidden = false;
  extracted = await extract();

  $("company").value = extracted.company ?? "";
  $("role").value = extracted.role ?? "";
  $("location").value = extracted.location ?? "";
  $("date_applied").value = new Date().toISOString().slice(0, 10);

  if (extracted.found === "meta") {
    msg("No structured data on this page - check the fields.");
  }
}

const STATUSES = ["Applied", "OA", "Interview", "Offer", "Rejected"];

async function api(path, options) {
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  return fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey, ...options?.headers },
  });
}

// Build rows with textContent, never innerHTML - company/role come off arbitrary
// pages and must not be able to inject markup into the popup.
function renderList(apps) {
  const list = $("list");
  list.replaceChildren();
  if (!apps.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Nothing logged yet.";
    list.append(p);
    return;
  }
  const table = document.createElement("table");
  for (const a of apps) {
    const tr = table.insertRow();
    const left = tr.insertCell();
    const co = document.createElement("div");
    co.className = "co";
    co.textContent = a.company;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [a.role, a.location, a.date_applied].filter(Boolean).join(" - ");
    left.append(co, meta);

    const right = tr.insertCell();
    right.className = "st";

    const select = document.createElement("select");
    for (const s of STATUSES) {
      const opt = new Option(s, s, false, s === a.status);
      select.add(opt);
    }
    select.addEventListener("change", async () => {
      const prev = a.status;
      const r = await api(`/applications/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: select.value }),
      });
      if (r.ok) { a.status = select.value; msg("Updated.", "ok"); }
      else { select.value = prev; msg("Update failed.", "error"); }
    });

    const del = document.createElement("button");
    del.textContent = "x";
    del.className = "del";
    del.title = "Delete";
    del.addEventListener("click", async () => {
      if (!confirm(`Delete ${a.company} - ${a.role}?`)) return;
      const r = await api(`/applications/${a.id}`, { method: "DELETE" });
      if (r.ok) { tr.remove(); msg("Deleted.", "ok"); }
      else { msg("Delete failed.", "error"); }
    });

    right.append(select, del);
  }
  list.append(table);
}

$("toggle").addEventListener("click", async () => {
  const showingList = !$("list").hidden;
  if (showingList) {
    $("list").hidden = true;
    $("form").hidden = false;
    $("toggle").textContent = "View saved applications";
    return;
  }
  msg("Loading...");
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  try {
    const r = await fetch(`${API}/applications?per_page=100`, {
      headers: { "X-API-Key": apiKey },
    });
    const body = await r.json();
    if (!r.ok) return msg(body.error ?? "Couldn't load.", "error");
    renderList(body.results);
    $("form").hidden = true;
    $("list").hidden = false;
    $("toggle").textContent = "Back to logging";
    msg("");
  } catch {
    msg("Backend unreachable - is it running?", "error");
  }
});

$("saveKey").addEventListener("click", async () => {
  const key = $("key").value.trim();
  if (!key) return msg("Key can't be empty.", "error");
  await chrome.storage.sync.set({ apiKey: key });
  $("setup").hidden = true;
  msg("");
  init();
});

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("save").disabled = true;
  msg("Saving...");

  const { apiKey } = await chrome.storage.sync.get("apiKey");
  try {
    // Read the inputs, not `extracted` - that's what makes edits actually save.
    const response = await fetch(`${API}/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        company: $("company").value,
        role: $("role").value,
        location: $("location").value,
        date_applied: $("date_applied").value,
        status: $("status").value,
        url: extracted.url,
        raw_source: extracted,
      }),
    });
    const body = await response.json();
    if (!response.ok) return msg(body.error ?? "Save failed.", "error");
    msg(response.status === 201 ? "Saved." : "Updated existing entry.", "ok");
  } catch {
    msg("Backend unreachable - is it running?", "error");
  } finally {
    $("save").disabled = false;
  }
});

init();
