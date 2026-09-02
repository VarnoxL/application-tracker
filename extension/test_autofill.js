// Checks the matching logic in autofill.js. The rest of that file is DOM work
// that only a real browser can exercise - this covers the part with decisions in
// it: label scoring, option matching, and which profile fields become targets.
//
//   node extension/test_autofill.js
//
// autofill.js is a plain script (executeScript can't inject a module), so there
// is nothing to import. It hands its pure half over when __autofillTest exists.
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import assert from "node:assert/strict";

const internals = {};
globalThis.__autofillTest = internals;
await runInThisContext(readFileSync(new URL("./autofill.js", import.meta.url), "utf8"));
const { norm, labelScore, matchOption, specsFrom } = internals;

/* ------------------------------------------------------------------- norm */

assert.equal(norm("  First   Name * "), "first name");
assert.equal(norm("E-mail Address:"), "e mail address");
assert.equal(norm("C++ / C#"), "c++ c#");
assert.equal(norm(null), "");

/* ------------------------------------------------------------- labelScore */

const FIRST = ["first name", "given name", "legal first name"];
const NOT_FIRST = ["last", "family", "preferred", "middle"];

assert.equal(labelScore("First Name", FIRST, NOT_FIRST), 1, "exact match scores 1");
assert.equal(labelScore("Legal First Name *", FIRST, NOT_FIRST), 1, "punctuation is normalized away");
assert.ok(labelScore("First name (required)", FIRST, NOT_FIRST) >= 0.7, "trailing words still match");

// The whole reason `not` exists: these read like a first-name field and aren't one.
assert.equal(labelScore("Preferred Name", FIRST, NOT_FIRST), 0);
assert.equal(labelScore("Middle Name", FIRST, NOT_FIRST), 0);
assert.equal(labelScore("Last Name", FIRST, NOT_FIRST), 0);
assert.equal(labelScore("Why do you want to work here?", FIRST, NOT_FIRST), 0);
assert.equal(labelScore("", FIRST, NOT_FIRST), 0);

// A bare "Name" must not be dragged in by the more specific spec.
const NAME = ["full name", "legal name", "name"];
const NOT_NAME = ["first", "last", "given", "family", "company", "file", "user"];
assert.equal(labelScore("Full Name", NAME, NOT_NAME), 1);
assert.equal(labelScore("Company Name", NAME, NOT_NAME), 0);
assert.equal(labelScore("File Name", NAME, NOT_NAME), 0);

// Everything above threshold is a fill; this is the line the constant draws.
const THRESHOLD = 0.7;
assert.ok(labelScore("Your GPA", ["gpa"], []) >= THRESHOLD);
assert.ok(labelScore("Undergraduate institution", ["school", "institution"], []) >= THRESHOLD);

/* ------------------------------------------------------------ matchOption */

const YESNO = ["Please select", "Yes", "No"];
assert.equal(matchOption(YESNO, "Yes"), 1);
assert.equal(matchOption(YESNO, "No"), 2);

// Profile says "Yes", the option is a sentence.
assert.equal(
  matchOption(["Select...", "Yes, I am legally authorized to work in the US", "No"], "Yes"),
  1,
);
// Profile is the longer side, the option is terse.
assert.equal(matchOption(["Select...", "Yes", "No"], "Yes, authorized to work"), 1);

assert.equal(matchOption(["Male", "Female", "Decline to self identify"], "Decline to self identify"), 2);
assert.equal(matchOption(YESNO, "Maybe"), -1, "no match returns -1, so the field stays blank");
assert.equal(matchOption(YESNO, ""), -1, "an unanswered profile field fills nothing");

/* -------------------------------------------------------------- specsFrom */

const profile = {
  parsed: {
    name: "Daniel Liu", firstName: "Daniel", lastName: "Liu",
    email: "d@example.com", phone: "555-0100", location: "Boston, MA",
    links: { linkedin: "https://linkedin.com/in/x", github: "", website: "" },
    education: [{ school: "Northeastern", degree: "BS", field: "CS", gpa: "3.8" }],
    experience: [{ company: "Acme", title: "SWE Intern" }, { company: "Second", title: "Ignored" }],
    skills: ["python"],
  },
  answers: { workAuthorized: "Yes", requiresSponsorship: "No", gender: "", race: "",
             veteran: "", disability: "", pronouns: "" },
};

const specs = specsFrom(profile);
const keys = specs.map((s) => s.key);
const valueOf = (k) => specs.find((s) => s.key === k)?.value;

assert.ok(keys.includes("firstName") && keys.includes("email"));
assert.equal(valueOf("workAuthorized"), "Yes", "answers are targets like anything else");
assert.equal(valueOf("gpa"), "3.8");
assert.equal(valueOf("linkedin"), "https://linkedin.com/in/x");

// Blank profile fields must not become targets - filling "" over a real value is a bug.
assert.ok(!keys.includes("github"), "empty link is not a target");
assert.ok(!keys.includes("gender"), "unanswered demographic is not a target");

// ponytail: first entry only, by decision. A second row needs an "Add another" click.
assert.equal(valueOf("company"), "Acme");
assert.ok(!specs.some((s) => s.value === "Second"), "only the first experience entry is used");

assert.equal(new Set(keys).size, keys.length, "spec keys are unique - they gate one fill each");
assert.deepEqual(specsFrom(undefined), [], "no profile yet means nothing to fill");
assert.deepEqual(specsFrom({ parsed: {}, answers: {} }), []);

console.log("ok");
