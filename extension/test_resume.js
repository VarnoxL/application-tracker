// Run with: node extension/test_resume.js
//
// Same shape as backend/test_app.py - plain asserts, no framework, no deps. The
// fixtures are hand-built pdf.js items and lines, so this needs neither a PDF nor
// a browser. That's the whole reason resume.js takes no pdf.js dependency.

import assert from "node:assert";
import { GAP, linesFrom, parseProfile } from "./resume.js";

// pdf.js item shape: the useful bits are transform[4]/[5] (x/y) and height (font size).
const item = (str, x, y, w, size = 10, page = 0, fontName = "g_d0_f1") => ({
  str,
  width: w,
  height: size,
  fontName,
  page,
  transform: [size, 0, 0, size, x, y],
});

function test_lines_from_items() {
  const lines = linesFrom([
    // Deliberately out of reading order: position, not item order, decides the layout.
    item("May 2024 - Aug 2024", 400, 600, 90),
    item("Acme Corp", 50, 600, 55),
    item("DANIEL LIU", 50, 700, 80, 16),
    item("World", 82, 500, 30),
    item("Hello", 50, 500, 30),
    item("page two", 50, 700, 40, 10, 1),
  ]);

  assert.deepStrictEqual(
    lines.map((l) => l.text),
    ["DANIEL LIU", "Acme Corp\tMay 2024 - Aug 2024", "Hello World", "page two"],
  );
  // A wide gap is a column break (tab); a normal word gap is just a space.
  assert.ok(lines[1].text.includes(GAP));
  assert.ok(!lines[2].text.includes(GAP));
  // Page 2 must not merge into page 1 even though both sit at y=700.
  assert.strictEqual(lines[3].page, 1);
  assert.strictEqual(lines[0].size, 16);
}

const L = (text, size = 10) => ({ text, size });

// One resume covering both entry layouts: "Company - Title <tab> dates" on a single
// line, and "Company <tab> dates" with the title on the following line.
const RESUME = [
  L("DANIEL LIU", 16),
  L("danielliu070809@gmail.com\t(555) 123-4567"),
  L("linkedin.com/in/danielliu\tgithub.com/VarnoxL"),
  L("Houston, TX"),
  L("EDUCATION", 12),
  L("University of Houston\tAug 2023 - May 2027", 11),
  L("Bachelor of Science in Computer Science\tGPA: 3.85"),
  L("EXPERIENCE", 12),
  L("Acme Corp — Software Engineer Intern\tMay 2024 - Aug 2024", 11),
  L("Houston, TX"),
  L("• Built a thing that did stuff"),
  L("• Shipped another thing"),
  L("Globex\tJun 2023 - Aug 2023", 11),
  L("Data Analyst Intern\tRemote"),
  L("• Analyzed data"),
  L("SKILLS", 12),
  L("Languages: Python, JavaScript, C++"),
];

function test_contact() {
  const p = parseProfile(RESUME);
  // Caps banner gets tidied - forms should not receive "DANIEL LIU".
  assert.strictEqual(p.name, "Daniel Liu");
  assert.strictEqual(p.firstName, "Daniel");
  assert.strictEqual(p.lastName, "Liu");
  assert.strictEqual(p.email, "danielliu070809@gmail.com");
  assert.strictEqual(p.phone, "(555) 123-4567");
  assert.strictEqual(p.location, "Houston, TX");
  assert.strictEqual(p.links.linkedin, "linkedin.com/in/danielliu");
  assert.strictEqual(p.links.github, "github.com/VarnoxL");
  // The email's domain must not be mistaken for a personal site.
  assert.strictEqual(p.links.website, "");
}

function test_education() {
  const [e, ...rest] = parseProfile(RESUME).education;
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(e.school, "University of Houston");
  assert.strictEqual(e.degree, "Bachelor of Science");
  assert.strictEqual(e.field, "Computer Science");
  assert.strictEqual(e.gpa, "3.85");
  assert.strictEqual(e.start, "Aug 2023");
  assert.strictEqual(e.end, "May 2027");
}

function test_experience() {
  const jobs = parseProfile(RESUME).experience;
  assert.strictEqual(jobs.length, 2);

  // Layout A: company and title on the date line, location on its own line after.
  assert.strictEqual(jobs[0].company, "Acme Corp");
  assert.strictEqual(jobs[0].title, "Software Engineer Intern");
  assert.strictEqual(jobs[0].location, "Houston, TX");
  assert.strictEqual(jobs[0].start, "May 2024");
  assert.strictEqual(jobs[0].end, "Aug 2024");
  assert.deepStrictEqual(jobs[0].bullets, [
    "Built a thing that did stuff",
    "Shipped another thing",
  ]);

  // Layout B: title lives on the line below the company/date line.
  assert.strictEqual(jobs[1].company, "Globex");
  assert.strictEqual(jobs[1].title, "Data Analyst Intern");
  assert.strictEqual(jobs[1].location, "Remote");
  assert.deepStrictEqual(jobs[1].bullets, ["Analyzed data"]);
}

function test_skills() {
  // The "Languages:" label is not a skill.
  assert.deepStrictEqual(parseProfile(RESUME).skills, ["Python", "JavaScript", "C++"]);
}

function test_degrades_quietly() {
  // A scanned PDF yields no text at all; nothing here may throw.
  const empty = parseProfile([]);
  assert.strictEqual(empty.name, "");
  assert.deepStrictEqual(empty.experience, []);
  assert.deepStrictEqual(empty.skills, []);
  assert.strictEqual(parseProfile(null).rawText, "");

  // Prose with no recognisable sections must not invent entries.
  const junk = parseProfile([L("just some words"), L("and some more")]);
  assert.deepStrictEqual(junk.experience, []);
  assert.deepStrictEqual(junk.education, []);
}

for (const t of [
  test_lines_from_items,
  test_contact,
  test_education,
  test_experience,
  test_skills,
  test_degrades_quietly,
]) {
  t();
}
console.log("ok");
