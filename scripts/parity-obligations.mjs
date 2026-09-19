#!/usr/bin/env node
// @ts-check
/**
 * WHAT PLAN 8.5 REQUIRES OF `lokalized-parity.json`, DERIVED FROM THE PLAN.
 *
 * Section 8.5 lists what the release parity declaration must contain, and **nothing has ever
 * compared a report to that list — because there has never been a report.** This is the obligation
 * half; `lokalized-js/tools/parity-report.mjs` produces the report and
 * `lokalized-js/test/parity-obligations.test.js` compares the two.
 *
 * **THE BULLETS ARE KEPT VERBATIM AND HASHED RATHER THAN SPLIT INTO FIELD NAMES.** A bullet like
 * "exact implementation, Java reference, and data commit SHAs plus the porting-contract archive
 * digest" is four things, and no split this file could perform would be the plan's own. So the
 * obligation is the SENTENCE, the report DECLARES which of its fields discharge each one, and the
 * consumer-side gate checks that every bullet is claimed — `scripts/documentation-topics.mjs`'s
 * split exactly: the judgement of what covers an obligation belongs with the artifact, the
 * obligation belongs with the plan. The hash is over the exact UTF-8 bytes, so a reworded bullet
 * fails here rather than drifting past a report that still cites it.
 *
 * **THE LIST IS NOT ONLY THE BULLETS, and that is the lesson this generator was born with rather
 * than learned.** M-D's row cost a day because a generator read one of its three obligations; 8.5
 * states three more requirements in PROSE after its list — the report is embedded in the packed
 * artifact and byte-identical to the published copy, the strict required partition shows zero
 * failed/xfailed/unsupported, and `DIVERGENCES.md` is generated from the xfail/unsupported records.
 * A completeness term below fails on a normative sentence in 8.5 that no obligation claims.
 *
 *   node scripts/parity-obligations.mjs --write
 *   node scripts/parity-obligations.mjs --check
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { planPath as resolvePlanPath } from "./planning-path.mjs";

const specDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(specDirectory, "parity-obligations.json");
const plan = await readFile(resolvePlanPath(), "utf8");

/** @param {string} message */
function fail(message) {
  console.error(`parity-obligations: ${message}`);
  process.exit(2);
}

/** Section 8.5, from its heading to the next one. */
const SECTION = /^### 8\.5 Release parity declaration\n(?<body>[\s\S]*?)(?=^### )/m;
const section = SECTION.exec(plan)?.groups?.body;
if (!section)
  fail("plan section '### 8.5 Release parity declaration' was not found — the plan's heading " +
    "structure has moved and this extraction is broken, which is not the same as the obligation " +
    "having been dropped");

const sha = (/** @type {string} */ text) => createHash("sha256").update(text, "utf8").digest("hex");
const tidy = (/** @type {string} */ text) => text.replace(/\s+/g, " ").trim();

/**
 * The section split into its bullet list and its prose, LINE BY LINE.
 *
 * A regex over the whole section is wrong here and was wrong on the first attempt: the plan hard-
 * wraps, so `^- (.*?)$` takes only a bullet's FIRST LINE and leaves its continuations behind as
 * text — which then read as prose sentences, and the completeness term below failed on a fragment
 * while the real requirement it was looking for sat two lines further on. A bullet is a `- ` line
 * plus every indented line under it, and nothing else is.
 */
const { bullets, proseText } = (() => {
  /** @type {string[]} */ const items = [];
  /** @type {string[]} */ const rest = [];
  let current = null;
  for (const line of (section ?? "").split("\n")) {
    if (/^- /.test(line)) { if (current !== null) items.push(current); current = line.slice(2); continue; }
    if (current !== null && /^\s+\S/.test(line)) { current += ` ${line.trim()}`; continue; }
    if (current !== null) { items.push(current); current = null; }
    rest.push(line);
  }
  if (current !== null) items.push(current);
  return {
    bullets: items.map(tidy).filter((item) => item.length > 0).map((item) => item.replace(/[;.]$/, "")),
    proseText: rest.join("\n"),
  };
})();

/**
 * The normative sentences OUTSIDE the list.
 *
 * Keyed on a distinguishing phrase rather than on position, because a paragraph gaining a sentence
 * must be noticed rather than absorbed. `kind` is what the consumer-side gate groups by.
 */
const PROSE = [
  { kind: "embedded", phrase: "embedded in the packed npm artifact" },
  { kind: "byteIdentity", phrase: "byte identity between the tested and published copies" },
  { kind: "strictPartition", phrase: "strict required partition must show zero" },
  { kind: "divergences", phrase: "`DIVERGENCES.md` is generated" },
  { kind: "volatileOutside", phrase: "remain CI attestation metadata outside the canonical packed report" },
];

const sentences = proseText
  // The list's lead-in ends in a COLON, so a split on sentence-final periods carries it into the
  // first real sentence. Removed here rather than tolerated, because the obligation's hash is over
  // these exact bytes and "It contains: The report is embedded…" is not a sentence the plan states.
  .replace(/^[\s\S]*?It contains:/, "")
  .split(/(?<=\.)\s+/).map(tidy)
  .filter((text) => text.length > 0 && !text.startsWith("Release-candidate CI generates"));

const prose = [];
for (const { kind, phrase } of PROSE) {
  const found = sentences.find((text) => text.includes(phrase));
  if (!found) fail(`8.5 no longer states the '${kind}' requirement (looked for ${JSON.stringify(phrase)}). ` +
    `Either the plan dropped it — which is a decision, not a generator bug — or this phrase moved.`);
  prose.push({ kind, sentence: found, statementSha256: sha(found ?? "") });
}

/**
 * **EVERY NORMATIVE SENTENCE IS CLAIMED BY SOME OBLIGATION.** Without this the table above finds
 * only what it already knows to look for, which is precisely how M-D's third obligation went
 * unread for a day with a deliverable nobody was comparing anything against.
 */
const claimed = new Set(prose.map((entry) => entry.sentence));
const unclaimed = sentences.filter((text) => !claimed.has(text) &&
  // A sentence stating no requirement of the report. Named explicitly so that adding one is a
  // deliberate edit rather than a widening regex.
  !/^A historical cross-repository dashboard is useful but deferred/.test(text));
if (unclaimed.length > 0)
  fail(`8.5 states ${unclaimed.length} sentence(s) this generator cannot read:\n    ` +
    `${unclaimed.join("\n    ")}\n  Teach PROSE to read them, or the release has a requirement ` +
    `nothing is comparing anything against.`);

// ANTI-VACUITY, before anything is written.
if (bullets.length === 0)
  fail("8.5 lists no bullet — the section's format has moved and this extraction is broken");
if (bullets.length < 7)
  fail(`8.5 lists only ${bullets.length} bullet(s) and this plan had 7. If the plan really dropped ` +
    `one, lower the floor deliberately and say which; a shrinking obligation list must not pass quietly`);

const obligations = [
  ...bullets.map((sentence, index) => ({ kind: "content", index, sentence, statementSha256: sha(sentence) })),
  ...prose.map((entry, index) => ({ kind: entry.kind, index: bullets.length + index, sentence: entry.sentence, statementSha256: entry.statementSha256 })),
];

const artifact = {
  $comment: "DERIVED from plan section 8.5 by scripts/parity-obligations.mjs. Do not edit. The " +
    "report declares which of its fields discharge each obligation; the judgement of what " +
    "discharges one belongs with the report, the obligation belongs with the plan.",
  formatVersion: 1,
  planSection: "8.5",
  obligations,
};

const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (process.argv.includes("--write")) {
  await writeFile(OUTPUT, serialized);
  console.log(JSON.stringify({ status: "written", obligations: obligations.length }));
} else {
  let current = "";
  try { current = await readFile(OUTPUT, "utf8"); }
  catch { fail(`${OUTPUT} does not exist. Run: node scripts/parity-obligations.mjs --write`); }
  if (current !== serialized) {
    console.error("parity-obligations: the checked-in artifact no longer matches the plan.");
    console.error(`  plan 8.5 states ${bullets.length} content bullet(s) and ${prose.length} prose requirement(s)`);
    console.error("  re-derive with: node scripts/parity-obligations.mjs --write");
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "current", obligations: obligations.length }));
}
