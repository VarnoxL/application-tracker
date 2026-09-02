// Pure resume parsing: PDF text items in, structured profile out.
//
// No DOM and no pdf.js import on purpose - `node extension/test_resume.js` exercises
// this without a browser or a real PDF. popup.js owns the pdf.js side and hands us
// plain items. Keep it that way; a parser you can't run in isolation can't be tested.

// A wide horizontal gap inside one visual line carries meaning: it's what separates
// "Company" from "May 2024 - Aug 2024" on a right-aligned resume. Preserve it as a tab.
export const GAP = "\t";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]*[a-z]{2,}/i;

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE = `(?:${MONTH}\\s*'?\\d{2,4}|\\d{1,2}/\\d{2,4}|\\d{4})`;
const DATE_RANGE = new RegExp(
  `(${DATE})\\s*(?:-|–|—|to|until|through)\\s*(${DATE}|present|current|now|ongoing)`,
  "i",
);
const BULLET = /^\s*[•●▪◦‣*]\s*|^\s*[-–—]\s+/;

const TITLE_WORDS =
  /\b(intern|engineer|developer|analyst|manager|scientist|designer|consultant|researcher|assistant|associate|architect|lead|director|specialist|technician|administrator|coordinator|fellow|volunteer|instructor|tutor|ambassador|president|treasurer|founder)\b/i;
const SCHOOL = /\b(university|college|institute|school|academy|polytechnic)\b/i;
const DEGREE =
  /\b(bachelor(?:'?s)?|master(?:'?s)?|associate(?:'?s)?|doctorate|ph\.?\s?d|b\.?\s?s\.?|b\.?\s?a\.?|m\.?\s?s\.?|m\.?\s?a\.?|m\.?b\.?a\.?|b\.?eng|m\.?eng|b\.?tech)\b/i;
const PLACE = /^[A-Z][a-zA-Z.'-]+(?:[\s-][A-Z][a-zA-Z.'-]+){0,2},\s*(?:[A-Z]{2}|[A-Z][a-z]{2,})\.?$/;

// Only known section words start a section. An unrecognised heading is the milder
// failure (its lines land in the previous section) than mistaking an ALL-CAPS company
// name for a heading, which would drop every entry after it.
// ponytail: keyword list, not styling. Unconventional headings ("Where I've Worked")
// aren't detected - add the phrase here when a real resume proves it matters.
const SECTIONS = [
  [
    "experience",
    /^(?:work|professional|relevant|industry|additional)?\s*experience$|^employment(?:\s+history)?$|^work\s+history$/,
  ],
  ["education", /^education(?:\s*(?:and|&)\s*training)?$|^academic(?:s|\s+background)?$/],
  [
    "skills",
    /^(?:technical|core|key|relevant)?\s*skills(?:\s*(?:and|&)\s*[a-z]+)?$|^technologies$|^(?:technical\s+)?competencies$/,
  ],
  ["projects", /^(?:personal|academic|selected|technical)?\s*projects$/],
  [
    "other",
    /^(?:awards?|honors?|certifications?|certificates?|activities|leadership|publications?|interests|hobbies|references|summary|objective|profile|about(?:\s+me)?|(?:relevant\s+)?coursework|involvement|volunteering|volunteer(?:\s+experience)?|languages|extracurriculars?)$/,
  ],
];

function sectionKind(text) {
  const s = clean(text).replace(/[:•]+$/, "").trim().toLowerCase();
  for (const [kind, re] of SECTIONS) if (re.test(s)) return kind;
  return null;
}

/**
 * Rebuild visual lines from pdf.js text items.
 *
 * Raw pdf.js reading order interleaves columns, so the x/y coordinates - not the item
 * order - are what make the text parseable at all. Items must carry `page`; without it
 * page 2 would merge into page 1 wherever the y values happen to collide.
 */
export function linesFrom(items) {
  const kept = [];
  for (const it of items || []) {
    if (!it || typeof it.str !== "string" || !it.str.trim()) continue;
    const t = it.transform || [];
    kept.push({
      str: it.str,
      x: Number(t[4]) || 0,
      y: Number(t[5]) || 0,
      w: Number(it.width) || 0,
      size: Number(it.height) || 0,
      bold: /bold|black|heavy|semibold/i.test(it.fontName || ""),
      page: Number(it.page) || 0,
    });
  }
  kept.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);

  const rows = [];
  let cur = null;
  for (const it of kept) {
    const tol = Math.max(2, (it.size || 10) * 0.5);
    if (!cur || cur.page !== it.page || Math.abs(cur.y - it.y) > tol) {
      cur = { page: it.page, y: it.y, items: [it] };
      rows.push(cur);
    } else {
      cur.items.push(it);
    }
  }

  return rows
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      let text = "";
      let prevEnd = null;
      for (const it of row.items) {
        if (prevEnd !== null) {
          const gap = it.x - prevEnd;
          const em = it.size || 10;
          if (gap > em * 1.5) text += GAP;
          else if (gap > em * 0.15 && !/[ \t]$/.test(text)) text += " ";
        }
        text += it.str;
        prevEnd = it.x + it.w;
      }
      return {
        text: text.replace(/[ \t]+$/, "").replace(/^[ \t]+/, ""),
        size: Math.max(...row.items.map((i) => i.size || 0)),
        bold: row.items.some((i) => i.bold),
        page: row.page,
        y: row.y,
      };
    })
    .filter((l) => l.text.trim());
}

function isHeading(line) {
  const t = clean(line.text);
  if (!t || t.length > 40) return false;
  if (line.text.includes(GAP)) return false; // headings aren't columnar
  if (DATE_RANGE.test(t)) return false; // "May 2024 - Present" is an entry, not a heading
  return sectionKind(t) !== null;
}

function splitSections(lines) {
  const header = [];
  const sections = {};
  let cur = null;
  for (const line of lines) {
    if (isHeading(line)) {
      const kind = sectionKind(line.text) || "other";
      cur = sections[kind] || (sections[kind] = []);
      continue;
    }
    (cur || header).push(line);
  }
  return { header, sections };
}

const segments = (text) =>
  String(text)
    .split(/\t|\s*\|\s*|\s+[–—]\s+|\s+-\s+|\s*•\s*/)
    .map(clean)
    .filter(Boolean);

const isPlace = (s) => /^remote$/i.test(s) || PLACE.test(s);

function findPhone(text) {
  const re = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
  for (const m of text.match(re) || []) {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 13) return clean(m);
  }
  return "";
}

const stripUrl = (u) => (u ? clean(u).replace(/[).,;]+$/, "").replace(/\/+$/, "") : "");

function findWebsite(text, taken) {
  const re =
    /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|dev|io|me|net|org|xyz|app|co|tech|page)\b(?:\/[\w./#?=&-]*)?/gi;
  for (const m of text.match(re) || []) {
    const u = stripUrl(m);
    if (/linkedin\.|github\.|@/i.test(u)) continue;
    if (taken.some((t) => t && u && t.includes(u))) continue;
    return u;
  }
  return "";
}

function findName(header) {
  let best = null;
  for (const line of header.slice(0, 8)) {
    for (const seg of line.text.split(GAP)) {
      const t = clean(seg);
      if (!t || t.length > 60 || /[@\d]/.test(t)) continue;
      if (/https?:|www\.|linkedin|github/i.test(t)) continue;
      const words = t.split(/\s+/);
      if (words.length < 2 || words.length > 5) continue;
      if (!/^[A-Za-z][A-Za-z.'’-]*$/.test(words[0])) continue;
      if (!best || line.size > best.size) best = { t, size: line.size };
    }
  }
  // A resume banner is often set in caps; "DANIEL LIU" would autofill as-is otherwise.
  return best ? best.t.replace(/^[A-Z][A-Z.'’ -]+$/, (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())) : "";
}

function findLocation(header) {
  for (const line of header) {
    for (const seg of line.text.split(GAP)) {
      const t = clean(seg).replace(/\|/g, "").trim();
      if (isPlace(t)) return t;
    }
  }
  return "";
}

function nameParts(full) {
  const w = clean(full).split(/\s+/).filter(Boolean);
  if (!w.length) return { firstName: "", lastName: "" };
  if (w.length === 1) return { firstName: w[0], lastName: "" };
  return { firstName: w[0], lastName: w[w.length - 1] };
}

function fillHeader(entry, text, preferTitle) {
  for (const p of segments(text)) {
    if (!entry.location && isPlace(p)) entry.location = p;
    else if (!entry.title && (preferTitle || TITLE_WORDS.test(p))) entry.title = p;
    else if (!entry.company) entry.company = p;
    else if (!entry.title) entry.title = p;
  }
}

// Entries are delimited by their date range - it's the one element every resume layout
// puts on the entry's header line.
// ponytail: an entry with no date is invisible to this splitter and gets absorbed into
// the previous one. Upgrade path is font-size/bold grouping if that shows up for real.
function parseExperience(lines) {
  const entries = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bullet = BULLET.test(line.text);
    const m = bullet ? null : line.text.match(DATE_RANGE);

    if (m) {
      cur = { company: "", title: "", location: "", start: m[1], end: m[2], bullets: [] };
      entries.push(cur);
      fillHeader(cur, line.text.replace(m[0], GAP));
      // Layout: company + dates on one line, title (and location) on the next.
      const next = lines[i + 1];
      if (!cur.title && next && !DATE_RANGE.test(next.text) && !BULLET.test(next.text)) {
        fillHeader(cur, next.text, true);
        i++;
      }
      continue;
    }
    if (!cur) continue;

    const t = clean(line.text.replace(BULLET, ""));
    if (!t) continue;
    if (!cur.location && isPlace(t)) cur.location = t;
    else if (bullet || !cur.bullets.length) cur.bullets.push(t);
    else cur.bullets[cur.bullets.length - 1] += ` ${t}`; // wrapped continuation
  }
  return entries.filter((e) => e.company || e.title);
}

function splitDegree(seg) {
  const m = DEGREE.exec(seg);
  if (!m) return null;
  const rest = seg.slice(m.index);
  const inIdx = rest.search(/\s+in\s+/i);
  if (inIdx >= 0) {
    return {
      degree: clean(rest.slice(0, inIdx)),
      field: clean(rest.slice(inIdx).replace(/^\s+in\s+/i, "")),
    };
  }
  const after = clean(rest.slice(m[0].length).replace(/^[,.\s]+/, ""));
  // "Bachelor of Science" - the tail belongs to the degree, not the field of study.
  if (/^of\s+/i.test(after)) return { degree: clean(`${m[0]} ${after}`), field: "" };
  return { degree: clean(m[0]), field: after };
}

function parseEducation(lines) {
  const entries = [];
  let cur = null;
  const start = () => {
    cur = { school: "", degree: "", field: "", location: "", start: "", end: "", gpa: "" };
    entries.push(cur);
  };

  for (const line of lines) {
    if (SCHOOL.test(line.text) || !cur) start();

    const m = line.text.match(DATE_RANGE);
    if (m) {
      cur.start = cur.start || m[1];
      cur.end = cur.end || m[2];
    }
    const gpa = line.text.match(/\bgpa\b:?\s*([0-4](?:\.\d{1,2})?)/i);
    if (gpa && !cur.gpa) cur.gpa = gpa[1];

    for (const seg of segments(m ? line.text.replace(m[0], GAP) : line.text)) {
      if (/\bgpa\b/i.test(seg)) continue;
      if (!cur.school && SCHOOL.test(seg)) cur.school = seg;
      else if (!cur.location && isPlace(seg)) cur.location = seg;
      else if (!cur.degree) {
        const d = splitDegree(seg);
        if (d) {
          cur.degree = d.degree;
          cur.field = cur.field || d.field;
        }
      }
    }
  }
  return entries.filter((e) => e.school || e.degree);
}

function parseSkills(lines) {
  const out = [];
  for (const line of lines) {
    let t = line.text.split(GAP).join(" ").replace(BULLET, "");
    t = t.replace(/^[A-Za-z][\w /&+-]{0,30}:\s*/, ""); // drop "Languages:" style labels
    for (const piece of t.split(/[,;|•·]/)) {
      const v = clean(piece);
      if (v && v.length <= 40 && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** Lines in, the `parsed` half of the stored profile out. Never throws. */
export function parseProfile(lines) {
  const rows = (lines || []).filter((l) => l && typeof l.text === "string" && l.text.trim());
  const rawText = rows.map((l) => l.text.split(GAP).join("  ")).join("\n");
  const { header, sections } = splitSections(rows);

  const name = findName(header);
  const linkedin = stripUrl(
    (rawText.match(/(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/[\w%-]+/i) || [])[0],
  );
  const github = stripUrl((rawText.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w.-]+/i) || [])[0]);

  return {
    name,
    ...nameParts(name),
    email: (rawText.match(EMAIL) || [])[0] || "",
    phone: findPhone(rawText),
    location: findLocation(header),
    links: {
      linkedin,
      github,
      // Blank the emails first, or "gmail.com" reads as a personal site.
      website: findWebsite(rawText.replace(new RegExp(EMAIL, "gi"), " "), [linkedin, github]),
    },
    education: parseEducation(sections.education || []),
    experience: parseExperience(sections.experience || []),
    skills: parseSkills(sections.skills || []),
    rawText,
  };
}
