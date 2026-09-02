import { linesFrom, parseProfile } from "./resume.js";

const API = "http://localhost:5000";

const $ = (id) => document.getElementById(id);
const msg = (text, kind = "") => {
  $("msg").textContent = text;
  $("msg").className = kind;
};

// pdf.js needs its worker addressed by extension URL; it's same-origin here, so no
// web_accessible_resources entry is required.
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.js");

let extracted = {}; // kept for raw_source; the form is the source of truth on save
let profile; // { parsed, answers, resume? } - see getProfile()

/* ---------------------------------------------------------------- views */

const VIEWS = { form: "navLog", list: "navList", profile: "navProfile" };

function show(view) {
  for (const [id, nav] of Object.entries(VIEWS)) {
    $(id).hidden = id !== view;
    $(nav).setAttribute("aria-current", String(id === view));
  }
}

/* -------------------------------------------------------------- posting */

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

async function loadList() {
  msg("Loading...");
  try {
    const r = await api("/applications?per_page=100");
    const body = await r.json();
    if (!r.ok) return msg(body.error ?? "Couldn't load.", "error");
    renderList(body.results);
    show("list");
    msg("");
  } catch {
    msg("Backend unreachable - is it running?", "error");
  }
}

/* -------------------------------------------------------------- profile */

// Resume-derived fields live under `parsed`; `answers` are the ones no resume carries
// (work authorization, EEO, pronouns) and must survive re-importing a resume.
const EMPTY_ANSWERS = {
  workAuthorized: "",
  requiresSponsorship: "",
  gender: "",
  race: "",
  veteran: "",
  disability: "",
  pronouns: "",
};

const blankParsed = () => ({
  name: "", firstName: "", lastName: "", email: "", phone: "", location: "",
  links: { linkedin: "", github: "", website: "" },
  education: [], experience: [], skills: [], rawText: "",
});

async function getProfile() {
  const { profile: stored } = await chrome.storage.local.get("profile");
  return {
    ...stored,
    parsed: {
      ...blankParsed(),
      ...stored?.parsed,
      links: { ...blankParsed().links, ...stored?.parsed?.links },
    },
    answers: { ...EMPTY_ANSWERS, ...stored?.answers },
  };
}

const CONTACT = ["firstName", "lastName", "email", "phone", "location"];
const LINKS = ["linkedin", "github", "website"];
const ANSWERS = Object.keys(EMPTY_ANSWERS);

const EDU_FIELDS = [
  ["school", "School"], ["degree", "Degree"], ["field", "Field of study"],
  ["start", "Start"], ["end", "End"], ["gpa", "GPA"],
];
const EXP_FIELDS = [
  ["company", "Company"], ["title", "Title"], ["location", "Location"],
  ["start", "Start"], ["end", "End"],
];

// Entry inputs write straight back into the entry object, so only the flat fields
// need collecting on save.
function entryNode(entry, fields, onRemove) {
  const box = document.createElement("div");
  box.className = "entry";

  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "rm";
  rm.textContent = "×";
  rm.title = "Remove";
  rm.addEventListener("click", onRemove);
  box.append(rm);

  for (const [key, label] of fields) {
    const l = document.createElement("label");
    l.textContent = label;
    const input = document.createElement("input");
    input.value = entry[key] ?? "";
    input.addEventListener("input", () => { entry[key] = input.value; });
    l.append(input);
    box.append(l);
  }
  return box;
}

function renderEntries(containerId, list, fields) {
  const render = () => {
    $(containerId).replaceChildren(
      ...list.map((entry, i) =>
        entryNode(entry, fields, () => { list.splice(i, 1); render(); })),
    );
  };
  render();
}

const renderEdu = () => renderEntries("eduRows", profile.parsed.education, EDU_FIELDS);
const renderExp = () => renderEntries("expRows", profile.parsed.experience, EXP_FIELDS);

function resumeStatus() {
  const p = profile.parsed;
  if (!profile.resume && !p.rawText) return "No resume imported yet.";
  const bits = profile.resume?.name ? [profile.resume.name] : [];
  bits.push(
    `${p.experience.length} roles`,
    `${p.education.length} schools`,
    `${p.skills.length} skills`,
  );
  return bits.join(" · ");
}

function renderProfile() {
  const p = profile.parsed;
  for (const k of CONTACT) $(`p_${k}`).value = p[k] ?? "";
  for (const k of LINKS) $(`p_${k}`).value = p.links[k] ?? "";
  for (const k of ANSWERS) $(`a_${k}`).value = profile.answers[k] ?? "";
  $("p_skills").value = (p.skills ?? []).join(", ");
  $("resumeStatus").textContent = resumeStatus();
  renderEdu();
  renderExp();
}

function collectProfile() {
  const p = profile.parsed;
  for (const k of CONTACT) p[k] = $(`p_${k}`).value.trim();
  for (const k of LINKS) p.links[k] = $(`p_${k}`).value.trim();
  for (const k of ANSWERS) profile.answers[k] = $(`a_${k}`).value;
  p.name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  p.skills = $("p_skills").value.split(",").map((s) => s.trim()).filter(Boolean);
}

async function textItems(buf) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const items = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    for (const it of content.items) {
      let fontName = it.fontName;
      // pdf.js hands out font ids like "g_d0_f1"; the resolved name is what shows bold.
      try {
        fontName = page.commonObjs.get(it.fontName)?.name || fontName;
      } catch {
        // font not in commonObjs - bold detection just stays off for this run
      }
      items.push({ ...it, fontName, page: n - 1 });
    }
  }
  return items;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  // Chunked: String.fromCharCode has an argument-count limit well below a PDF's size.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

$("resumeFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  $("resumeStatus").textContent = "Parsing…";
  msg("");
  try {
    const buf = await file.arrayBuffer();
    // Keep the bytes for the file-upload field before pdf.js gets a chance to detach them.
    const resume = { name: file.name, type: file.type || "application/pdf", data: toBase64(buf) };
    const parsed = parseProfile(linesFrom(await textItems(buf)));

    if (!parsed.rawText.trim()) {
      $("resumeStatus").textContent = "";
      msg("That PDF has no text layer - likely a scan. Fill the fields in by hand.", "error");
      return;
    }
    // answers survive a re-import; they were never in the resume to begin with.
    profile.parsed = parsed;
    profile.resume = resume;
    await chrome.storage.local.set({ profile });
    renderProfile();
    msg("Resume imported - check the fields below.", "ok");
  } catch (err) {
    $("resumeStatus").textContent = "";
    msg(`Couldn't read that PDF: ${err.message}`, "error");
  }
});

$("addEdu").addEventListener("click", () => {
  profile.parsed.education.push({ school: "", degree: "", field: "", start: "", end: "", gpa: "" });
  renderEdu();
});

$("addExp").addEventListener("click", () => {
  profile.parsed.experience.push({ company: "", title: "", location: "", start: "", end: "", bullets: [] });
  renderExp();
});

$("saveProfile").addEventListener("click", async () => {
  collectProfile();
  await chrome.storage.local.set({ profile });
  msg("Profile saved.", "ok");
});

/* ------------------------------------------------------------------ nav */

$("navLog").addEventListener("click", () => { msg(""); show("form"); });
$("navList").addEventListener("click", loadList);
$("navProfile").addEventListener("click", () => { msg(""); renderProfile(); show("profile"); });

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

  try {
    // Read the inputs, not `extracted` - that's what makes edits actually save.
    const response = await api("/applications", {
      method: "POST",
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

async function init() {
  profile = await getProfile();

  const { apiKey } = await chrome.storage.sync.get("apiKey");
  if (!apiKey) {
    $("setup").hidden = false;
    msg("Set your API key to start.");
    return;
  }

  $("nav").hidden = false;
  show("form");
  extracted = await extract();

  $("company").value = extracted.company ?? "";
  $("role").value = extracted.role ?? "";
  $("location").value = extracted.location ?? "";
  $("date_applied").value = new Date().toISOString().slice(0, 10);

  if (extracted.found === "meta") {
    msg("No structured data on this page - check the fields.");
  }
}

init();
