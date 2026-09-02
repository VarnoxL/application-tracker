// Injected into the active tab (all frames) by popup.js. A plain script, not a
// module: chrome.scripting.executeScript refuses `args` alongside `files`, so
// this reads the profile out of chrome.storage.local itself.
//
// It never submits anything. Blank fields get filled and outlined green; a field
// that already holds something is left alone, and outlined amber when it
// disagrees with the profile so you can eyeball it.
(async () => {
  // ponytail: tuned against Greenhouse/Lever. Lower to ~0.5 if too many fields
  // stay blank on real forms, raise it if wrong values start landing.
  const MATCH_THRESHOLD = 0.7;

  const FILLED_OUTLINE = "2px solid #16a34a";
  const LEFT_OUTLINE = "2px solid #d97706";

  const norm = (s) =>
    (s ?? "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9+#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // Phrase match against one piece of label text. `not` kills the false friends
  // outright - "Preferred name" must never score as the legal first name.
  const labelScore = (text, words, not) => {
    const l = norm(text);
    if (!l) return 0;
    if (not?.some((w) => l.includes(w))) return 0;
    let best = 0;
    for (const w of words) {
      if (l === w) return 1;
      if (l.startsWith(w) || l.endsWith(w)) best = Math.max(best, 0.85);
      else if (l.includes(w)) best = Math.max(best, 0.75);
    }
    return best;
  };

  // Option text -> index. Exact, then prefix, then substring either way round:
  // profile "Yes" has to hit an option reading "Yes, I am authorized to work".
  const matchOption = (texts, want) => {
    const w = norm(want);
    if (!w) return -1;
    const n = texts.map(norm);
    let i = n.indexOf(w);
    if (i !== -1) return i;
    i = n.findIndex((t) => t && t.startsWith(w));
    if (i !== -1) return i;
    i = n.findIndex((t) => t && t.includes(w));
    if (i !== -1) return i;
    // The option can be the shorter side: profile "Yes, authorized" vs option "Yes".
    return n.findIndex((t) => t.length > 2 && w.includes(t));
  };

  const specsFrom = (profile) => {
    const p = profile?.parsed ?? {};
    const a = profile?.answers ?? {};
    const links = p.links ?? {};
    // ponytail: first entry only. Filling a second row needs an "Add another"
    // click first; the rest of the history stays manual.
    const edu = p.education?.[0] ?? {};
    const exp = p.experience?.[0] ?? {};

    return [
      { key: "firstName", value: p.firstName, auto: ["given-name"],
        words: ["first name", "given name", "legal first name", "forename"],
        not: ["last", "family", "preferred", "company", "school", "middle"] },
      { key: "lastName", value: p.lastName, auto: ["family-name"],
        words: ["last name", "family name", "surname", "legal last name"],
        not: ["first", "given", "preferred", "middle"] },
      { key: "name", value: p.name, auto: ["name"],
        words: ["full name", "legal name", "your name", "name"],
        not: ["first", "last", "given", "family", "middle", "preferred", "user",
              "company", "school", "employer", "file", "reference", "recruiter"] },
      { key: "email", value: p.email, auto: ["email"], type: "email",
        words: ["email address", "email", "e mail"],
        not: ["confirm", "verify", "re enter"] },
      { key: "phone", value: p.phone, auto: ["tel"], type: "tel",
        words: ["phone number", "mobile", "telephone", "phone", "cell"],
        not: ["country code", "extension"] },
      { key: "location", value: p.location, auto: ["address-level2"],
        words: ["current location", "city and state", "city", "location"],
        not: ["company", "school", "employer", "relocate", "preferred location"] },

      { key: "linkedin", value: links.linkedin,
        words: ["linkedin profile", "linkedin url", "linkedin"], not: [] },
      { key: "github", value: links.github,
        words: ["github profile", "github url", "github", "git hub"], not: [] },
      { key: "website", value: links.website, auto: ["url"],
        words: ["personal website", "portfolio", "website", "personal site"],
        not: ["linkedin", "github", "company"] },

      { key: "workAuthorized", value: a.workAuthorized,
        words: ["legally authorized to work", "authorized to work", "work authorization",
                "work authorisation"],
        not: ["sponsor"] },
      { key: "requiresSponsorship", value: a.requiresSponsorship,
        words: ["require sponsorship", "visa sponsorship", "sponsorship",
                "immigration sponsorship"], not: [] },
      { key: "gender", value: a.gender, words: ["gender identity", "gender"], not: [] },
      { key: "race", value: a.race,
        words: ["race ethnicity", "ethnicity", "race", "hispanic or latino"], not: [] },
      { key: "veteran", value: a.veteran,
        words: ["protected veteran", "veteran status", "veteran"], not: [] },
      { key: "disability", value: a.disability, words: ["disability status", "disability"], not: [] },
      { key: "pronouns", value: a.pronouns, words: ["preferred pronouns", "pronouns"], not: [] },

      { key: "school", value: edu.school,
        words: ["school", "university", "college", "institution"], not: ["high school", "why"] },
      { key: "degree", value: edu.degree, words: ["degree type", "degree"], not: [] },
      { key: "fieldOfStudy", value: edu.field,
        words: ["field of study", "major", "discipline", "concentration"], not: [] },
      { key: "gpa", value: edu.gpa, words: ["grade point average", "gpa"], not: [] },

      { key: "company", value: exp.company, auto: ["organization"],
        words: ["current company", "current employer", "company", "employer", "organization"],
        not: ["school", "why", "about"] },
      { key: "title", value: exp.title, auto: ["organization-title"],
        words: ["current title", "job title", "title", "current position"],
        not: ["school", "why", "mr", "mrs"] },
      // ponytail: no date fields. "Start date" on an application means your
      // availability, not when your last job began - too easy to get backwards.
    ].filter((s) => typeof s.value === "string" && s.value.trim() !== "");
  };

  /* ---- the pure half ends here; everything below touches the DOM ---- */

  if (globalThis.__autofillTest) {
    Object.assign(globalThis.__autofillTest, { norm, labelScore, matchOption, specsFrom });
    return { filled: 0, left: 0 };
  }

  const { profile } = await chrome.storage.local.get("profile");
  const specs = specsFrom(profile);
  if (!specs.length) return { filled: 0, left: 0, noProfile: true };

  // Visible label text, best signal first. name/id are real signals but weaker
  // than anything the applicant can actually read on screen.
  const labelBits = (el) => {
    const bits = [];
    const push = (text, weight) => {
      if (text && text.trim()) bits.push({ text, weight });
    };

    if (el.id) push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent, 1);
    push(el.closest("label")?.textContent, 1);
    push(el.getAttribute("aria-label"), 1);
    for (const id of (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)) {
      push(document.getElementById(id)?.textContent, 1);
    }
    push(el.closest("fieldset")?.querySelector("legend")?.textContent, 0.95);
    push(el.getAttribute("placeholder"), 0.9);
    push((el.getAttribute("name") ?? "").replace(/[_\-.[\]]+/g, " "), 0.9);
    push((el.id ?? "").replace(/[_\-.]+/g, " "), 0.9);
    return bits;
  };

  const score = (el, spec) => {
    const auto = norm(el.getAttribute("autocomplete"));
    if (auto && spec.auto?.includes(auto)) return 1;
    if (spec.type && el.type === spec.type) return 0.9;
    let best = 0;
    for (const { text, weight } of labelBits(el)) {
      best = Math.max(best, weight * labelScore(text, spec.words, spec.not));
    }
    return best;
  };

  const setNative = (el, value) => {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    // Greenhouse and Lever are React-backed: a plain `el.value =` never reaches
    // React's state and the value vanishes on submit. This is not optional.
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const SKIP_TYPES = ["hidden", "password", "file", "submit", "button", "reset", "image", "checkbox"];
  // ponytail: offsetParent misses position:fixed fields. Cheap and right on every
  // ATS form seen so far; swap for getBoundingClientRect if one turns up.
  const usable = (el) =>
    !el.disabled && !el.readOnly && !SKIP_TYPES.includes(el.type) && el.offsetParent !== null;

  const radioLabel = (input) => {
    const bits = [];
    if (input.id) {
      bits.push(document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent);
    }
    bits.push(input.closest("label")?.textContent, input.getAttribute("aria-label"), input.value);
    return bits.find((t) => t && t.trim()) ?? "";
  };

  // Radios answer as a group, so the group is one target. Everything else is itself.
  const targets = [];
  const radioGroups = new Map();
  for (const el of document.querySelectorAll("input, select, textarea")) {
    if (el.type === "radio") {
      if (el.disabled || !el.name) continue;
      if (!radioGroups.has(el.name)) radioGroups.set(el.name, []);
      radioGroups.get(el.name).push(el);
    } else if (usable(el)) {
      targets.push({ el, kind: el.tagName === "SELECT" ? "select" : "text" });
    }
  }
  for (const group of radioGroups.values()) {
    const visible = group.filter((el) => el.offsetParent !== null);
    if (visible.length) targets.push({ el: visible[0], group: visible, kind: "radio" });
  }

  const currentValue = (t) => {
    if (t.kind === "radio") {
      const checked = t.group.find((el) => el.checked);
      return checked ? radioLabel(checked) : "";
    }
    if (t.kind === "select") {
      return t.el.value === "" ? "" : (t.el.selectedOptions[0]?.text ?? "");
    }
    return t.el.value;
  };

  // Score every pair, then hand out the strongest matches first so a spec and an
  // element are each claimed once. Per-element "best spec" would let a weak early
  // field steal a match a later field wanted more.
  const pairs = [];
  for (const t of targets) {
    for (const spec of specs) {
      const s = score(t.el, spec);
      if (s >= MATCH_THRESHOLD) pairs.push({ t, spec, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s);

  const usedEl = new Set();
  const usedSpec = new Set();
  let filled = 0;
  let left = 0;

  const outline = (el, style) => {
    el.style.outline = style;
    el.style.outlineOffset = "1px";
  };

  for (const { t, spec } of pairs) {
    if (usedEl.has(t.el) || usedSpec.has(spec.key)) continue;
    usedEl.add(t.el);
    usedSpec.add(spec.key);

    const existing = currentValue(t).trim();
    if (existing) {
      // The same answer already sitting there isn't worth flagging; a different one is.
      if (norm(existing) !== norm(spec.value)) {
        outline(t.el, LEFT_OUTLINE);
        t.el.title = `Autofill left this alone. Profile has: ${spec.value}`;
        left++;
      }
      continue;
    }

    if (t.kind === "select") {
      const i = matchOption([...t.el.options].map((o) => o.text), spec.value);
      // Index 0 is nearly always the "Select..." placeholder, and picking it fills nothing.
      if (i > 0 || (i === 0 && t.el.options[0].value !== "")) {
        setNative(t.el, t.el.options[i].value);
        outline(t.el, FILLED_OUTLINE);
        filled++;
      }
    } else if (t.kind === "radio") {
      const i = matchOption(t.group.map(radioLabel), spec.value);
      if (i !== -1) {
        t.group[i].checked = true;
        t.group[i].dispatchEvent(new Event("input", { bubbles: true }));
        t.group[i].dispatchEvent(new Event("change", { bubbles: true }));
        outline(t.group[i], FILLED_OUTLINE);
        filled++;
      }
    } else {
      setNative(t.el, spec.value);
      outline(t.el, FILLED_OUTLINE);
      filled++;
    }
  }

  return { filled, left };
})();
