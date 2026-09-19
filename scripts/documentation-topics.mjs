#!/usr/bin/env node
// @ts-check
/**
 * THE DOCUMENTATION THE PLAN'S MILESTONE ROWS REQUIRE, DERIVED FROM THE PLAN.
 *
 * Plan v7's M-D row names the topics the documentation must cover, in one sentence, and **nothing
 * has ever compared `README.md` to that sentence.** That is the one-directional-gate shape this
 * project has now closed three times at the symbol level — `test/declared-surface.test.js` (S5) for
 * promised names, `test/allowlist-type-surface.test.js` (S28) for promised categories,
 * `test/plan-surface.test.js` (S30) for signatures the plan declares outside section 3.1 — and never
 * at the documentation level, where the milestone's whole deliverable is.
 *
 * MEASURED 2026-09-17, which is why this exists: of the eleven topics the M-D row names, **RSC and
 * accessibility had ZERO coverage in a 2,400-line README** whose own status record read "README
 * COMPLETE". The single apparent hit for accessibility was the word "variable" matching a grep for
 * "aria". A milestone's scope sentence is exactly the kind of list this project has learned goes
 * unread: it is written once, it reads as settled, and the deliverable drifts from it silently.
 *
 * The list is DERIVED and never transcribed, for `symbol-allowlist.mjs`'s reason: a hand-copied
 * list drifts from the plan without either copy being wrong on its own. Consumers compare their own
 * documentation against the artifact — `lokalized-js/test/readme-topics.test.js` does — so the
 * judgement of what covers a topic lives with the document, and the obligation lives with the plan.
 *
 *   node scripts/documentation-topics.mjs --write
 *   node scripts/documentation-topics.mjs --check
 */
import { planPath as resolvePlanPath } from "./planning-path.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const specDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(specDirectory, "documentation-topics.json");
const plan = await readFile(resolvePlanPath(), "utf8");

/**
 * Every milestone row that states a documentation obligation.
 *
 * Keyed on the SENTENCE rather than on the milestone, because the obligation is the sentence: a
 * second milestone growing one would be picked up here without this file being edited, and a row
 * that stops stating one fails the count check below rather than quietly shrinking the list.
 */
const OBLIGATION = /\|\s*\*\*(?<milestone>M-?[A-Z0-9]+)\*\*\s*\|[^|]*\|[^|]*\|[^|]*\|(?<body>[^|]*(?:Documentation covers|Executed quickstarts cover)[^|]*)\|/g;

/** `a, b, c, and d` -> [a, b, c, d]. The Oxford comma is the plan's own style and is not assumed. */
const listItems = (text) =>
  text.split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

/**
 * Each obligation the row states, as its own entry.
 *
 * **The row carries MORE THAN ONE, and the first version of this took only the second.** M-D's opens
 * "Executed quickstarts cover npm/bundler, direct browser, SSR, and explicit-locale use" before it
 * says anything about documentation, and that sentence went unextracted and therefore unchecked for
 * a day — with the direct-browser quickstart sitting in a ```html block nothing executed. A row is a
 * list of obligations, not one; reading only the sentence you came for is how the second one hides.
 *
 * @type {Array<{ milestone: string, kind: string, items: string[], sentence: string }>}
 */
const obligations = [];
const KINDS = [
  { kind: "documentation", lead: "Documentation covers" },
  { kind: "quickstarts", lead: "Executed quickstarts cover" },
  // The third obligation is a SENTENCE rather than a list, so it contributes one item: itself.
  { kind: "acceptance", lead: "A design partner or maintainer", whole: true },
];
for (const match of plan.matchAll(OBLIGATION)) {
  const body = match.groups?.body ?? "";
  const claimed = [];
  for (const { kind, lead, whole } of KINDS) {
    const sentence = new RegExp(`${lead} (?<list>[^.]*)\\.`).exec(body);
    if (!sentence?.groups?.list) continue;
    const text = `${lead} ${sentence.groups.list}.`;
    claimed.push(text);
    obligations.push({
      milestone: match.groups?.milestone ?? "",
      kind,
      items: whole ? [text] : listItems(sentence.groups.list),
      sentence: text,
    });
  }

  // **EVERY SENTENCE OF A ROW THAT STATES ANY OBLIGATION MUST BE CLAIMED BY SOME KIND.**
  //
  // This is the rule that would have caught the last two misses, and it was found by an agent
  // verdicting M-D's clauses rather than by anything here. M-D's row states THREE obligations: the
  // first version of this generator read ONE, the second read TWO and its own record says "a row is
  // a list of obligations, not one; reading only the sentence you came for is how the second one
  // hides" — and it then left the third unread, with no term that could notice. A table of leads
  // can only find what it already knows to look for, so the completeness check has to be keyed on
  // the SENTENCES rather than on the table: an obligation-shaped row with an unaccounted sentence
  // exits 2 naming it, exactly as the allowlist generator THROWS on a disowning clause it has not
  // been taught to read rather than approximating one.
  if (claimed.length > 0) {
    const sentences = body.split(/(?<=\.)\s+/).map((text) => text.trim()).filter(Boolean);
    const unclaimed = sentences.filter((text) => !claimed.some((known) => known.trim() === text));
    if (unclaimed.length > 0)
      fail(`the ${match.groups?.milestone} row states an obligation this generator can read AND ` +
        `${unclaimed.length} sentence(s) it cannot:\n    ${unclaimed.join("\n    ")}\n  ` +
        `Teach KINDS to read it, or the milestone has a deliverable nothing is comparing anything ` +
        `against. A table of leads finds only what it already knows to look for.`);
  }
}

// ANTI-VACUITY, before anything is written. A regex that stopped matching the plan's table would
// otherwise emit an EMPTY obligation list, and every consumer comparing against it would pass.
if (obligations.length === 0)
  fail("no milestone row states a documentation obligation — the plan's table format has moved and " +
    "this extraction is broken, which is not the same as the obligation having been dropped");
const md = obligations.filter((entry) => entry.milestone === "M-D");
for (const { kind, floor } of [{ kind: "documentation", floor: 8 }, { kind: "quickstarts", floor: 3 },
  { kind: "acceptance", floor: 1 }]) {
  const entry = md.find((candidate) => candidate.kind === kind);
  if (!entry)
    fail(`the M-D row states no ${kind} obligation. If that is deliberate, this generator is the ` +
      `thing to change; if it is not, the plan has lost part of the milestone's deliverable`);
  if (entry.items.length < floor)
    fail(`M-D's ${kind} obligation names only ${entry.items.length} item(s) ` +
      `(${entry.items.join(", ")}) — the list splitter has probably matched a shorter sentence ` +
      `than the row's own`);
}

const artifact = {
  $comment: "DERIVED from the implementation plan's milestone rows by scripts/documentation-topics.mjs. " +
    "Do not edit. A consumer compares its own documentation against this list; the judgement of what " +
    "covers a topic belongs with the document, the obligation belongs with the plan.",
  formatVersion: 1,
  obligations,
};

/** @param {string} message */
function fail(message) {
  console.error(`documentation-topics: ${message}`);
  process.exit(2);
}

const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (process.argv.includes("--write")) {
  await writeFile(OUTPUT, serialized);
  console.log(JSON.stringify({ status: "written", obligations: obligations.length }));
} else {
  let current = "";
  try {
    current = await readFile(OUTPUT, "utf8");
  } catch {
    fail(`${OUTPUT} does not exist. Run: node scripts/documentation-topics.mjs --write`);
  }
  if (current !== serialized) {
    console.error("documentation-topics: the checked-in artifact no longer matches the plan.");
    for (const entry of md) console.error(`  plan names ${entry.items.length} M-D ${entry.kind}: ${entry.items.join(", ")}`);
    console.error("  re-derive with: node scripts/documentation-topics.mjs --write");
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "current", obligations: obligations.length }));
}
