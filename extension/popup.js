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
  extracted = await extract();

  $("company").value = extracted.company ?? "";
  $("role").value = extracted.role ?? "";
  $("location").value = extracted.location ?? "";
  $("date_applied").value = new Date().toISOString().slice(0, 10);

  if (extracted.found === "meta") {
    msg("No structured data on this page - check the fields.");
  }
}

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
