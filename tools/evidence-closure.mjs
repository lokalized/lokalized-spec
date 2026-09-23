#!/usr/bin/env node
// @ts-check
/**
 * Report evidence closure over the bootstrap requirement registry — and it is a REPORT, by
 * amendment A27, not a gate.
 *
 * **THE HEADLINE IS A ZERO AND IT IS MEASURED, NOT INFERRED.** The registry's 1,338 rows each name
 * one or more `evidenceId`s; there are 762 distinct ones. **Nothing in any of the four repositories
 * produces, claims or even mentions a single one of them.** Sampled twelve spread across the set
 * and then swept all 762: zero producers. So closure has no edges in BOTH directions — the corpus
 * carries no `requirementIds` (measured at M8 S27, still 0 of 2,379) and no tool, test or artifact
 * carries an `evidenceId`.
 *
 * **THAT CHANGES WHAT REVIEWING THE ROWS BUYS, which is why this tool exists rather than a review
 * plan.** The recommendation put to the maintainer was to review the 119 rows not stamped M0 and
 * report closure rather than gate it. The second half stands. The first buys less than it sounded:
 * a fully reviewed row still has no producer to link to, so review moves `reviewStatus` and leaves
 * closure at zero. Building the producer side is the work; reviewing is not a substitute for it.
 *
 * WHAT `--check` CANNOT SEE, said here rather than left to be discovered. It re-derives every
 * count from the registry and the corpus and compares the registry, corpus and tool digests — so
 * an input moving under a stale record fails. It does NOT digest the four trees, because the
 * producer sweep reads them whole. So a producer APPEARING is invisible until someone runs
 * `npm run evidence` again. That is the right trade while the count is 6-mentions-in-planning and
 * the wrong one the day a real producer lands; revisit it then.
 *
 * WHAT THIS DOES NOT DO. It does not mark anything reviewed. `reviewStatus` is
 * `unreviewed | human-reviewed | decision-owner-approved`, and both non-default values name a human
 * act — an agent writing either would be forging one, which is the class of thing this project
 * refuses everywhere else.
 *
 *   node tools/evidence-closure.mjs [--json]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["lokalized-spec", "lokalized-js", "lokalized-java", "planning"]
  .map((name) => resolve(spec, "..", name));

const registryPath = join(spec, "pre-m0/bootstrap.requirements.candidate.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const rows = registry.requirements ?? registry;

/** Every evidence id the registry names, and the rows that name it. */
const byEvidence = new Map();
for (const row of rows)
  for (const evidence of row.evidence ?? []) {
    if (!byEvidence.has(evidence.evidenceId)) byEvidence.set(evidence.evidenceId, []);
    byEvidence.get(evidence.evidenceId).push(row.requirementId);
  }

const ids = [...byEvidence.keys()].sort();

/**
 * A producer is any mention of an evidence id OUTSIDE the registry that names it.
 *
 * Deliberately generous: a real producer registry would be stricter, and the point of the generous
 * reading is that it is an UPPER BOUND — a stricter one can only find fewer. So the six below are
 * the most that could possibly be claimed, not a count of six working links.
 *
 * NO `grep`, AND THE REASON IS A MACHINE FACT WORTH KNOWING. The first version ran `grep -rl`
 * per id across each of four trees — 3,048 full-tree walks. Collapsing it to one `-Ff` sweep per
 * root looked instant when tried by hand and was still 162s from inside node, because the two
 * are not the same program: the interactive shell's `grep` here is a SHELL FUNCTION backed by
 * ugrep, while `execFileSync("grep")` gets /usr/bin/grep, BSD grep 2.6.0, which spends 60.8s on
 * ONE root with 762 -F patterns. A hand-run timing is not a timing of the thing the tool runs.
 * So the scan is in JS: one regex pass per file collecting slug-shaped tokens, tested against a
 * Set. Pattern count stops mattering, and nothing depends on which grep the host has.
 */
function producerIndex() {
  const index = new Map(ids.map((id) => [id, []]));
  // Every dotted/hyphenated slug an evidence id could be spelled as, in ONE pass over the bytes.
  const token = /[A-Za-z0-9]+(?:[.\-_][A-Za-z0-9]+)+/g;
  const idSet = new Set(ids);

  const walk = (/** @type {string} */ dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      if (full.endsWith("bootstrap.requirements.candidate.json")) continue;
      let text;
      try { text = readFileSync(full, "latin1"); } catch { continue; }
      if (text.indexOf("\u0000") !== -1) continue; // binary, as grep would skip it
      for (const m of text.matchAll(token))
        if (idSet.has(m[0]) && !index.get(m[0]).includes(full)) index.get(m[0]).push(full);
    }
  };
  for (const root of roots) { try { walk(root); } catch { /* absent sibling */ } }
  return index;
}

// LAZY, and that is the whole point of the split: --check must not pay for the sweep.
let index = new Map();
let withProducer = [];
if (process.argv.includes("--write")) {
  index = producerIndex();
  withProducer = ids.filter((id) => index.get(id).length > 0);
}

const nonM0 = rows.filter((/** @type {any} */ r) => r.activationMilestone !== "M0");
const reviewed = rows.filter((/** @type {any} */ r) => r.reviewStatus !== "unreviewed");
const corpus = JSON.parse(readFileSync(join(spec, "generated/behavioral-vectors.json"), "utf8"));
const casesWithRequirement = corpus.cases.filter((/** @type {any} */ c) => (c.requirementIds ?? []).length > 0);

const recordPath = join(spec, "generated/evidence-closure.json");
const sha256 = (/** @type {string|Buffer} */ bytes) => createHash("sha256").update(bytes).digest("hex");

/** Everything derivable in milliseconds from two files. Recomputed on every --check. */
const cheap = () => ({
  requirements: rows.length,
  reviewed: reviewed.length,
  notActivatedAtM0: nonM0.length,
  distinctEvidenceIds: ids.length,
  corpusCases: corpus.cases.length,
  corpusCasesCarryingARequirementId: casesWithRequirement.length,
});

/** What a --check compares against, so an input moving forces a re-sweep rather than going unnoticed. */
const inputs = () => ({
  registrySha256: sha256(readFileSync(registryPath)),
  corpusSha256: sha256(readFileSync(join(spec, "generated/behavioral-vectors.json"))),
  toolSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
});

const print = (/** @type {any} */ r) => {
  console.log("evidence closure — REPORTED, not gated (amendment A27)");
  console.log(`  requirements                       ${r.requirements}`);
  console.log(`  reviewed by a human                ${r.reviewed}`);
  console.log(`  not activated at M0                ${r.notActivatedAtM0}`);
  console.log(`  distinct evidence ids              ${r.distinctEvidenceIds}`);
  console.log(`  ...with a producer anywhere        ${r.evidenceIdsWithAProducer}`);
  console.log(`  corpus cases                       ${r.corpusCases}`);
  console.log(`  ...carrying a requirement id       ${r.corpusCasesCarryingARequirementId}`);
  console.log("");
  const shipped = Object.values(r.producers ?? {}).flat()
    .filter((/** @type {any} */ f) => !String(f).startsWith("planning/"));
  if (r.corpusCasesCarryingARequirementId === 0 && shipped.length === 0)
    console.log(`closure has no edges in either direction. No corpus case names a requirement, and\n` +
      `the ${r.evidenceIdsWithAProducer} evidence ids mentioned anywhere are mentioned only in planning prose that ships\n` +
      `in no repository. Reviewing rows moves reviewStatus and leaves this here — the producer\n` +
      `side is the work.`);
};

if (process.argv.includes("--write")) {
  const record = {
    formatVersion: 1,
    note: "Evidence closure over the bootstrap requirement registry. REPORTED, not gated (A27). The producer sweep reads four whole trees and costs ~36s, so it runs here and `--check` re-checks this record without sweeping — the same split as diff:all/diff:check.",
    measuredWith: "tools/evidence-closure.mjs",
    inputs: inputs(),
    ...cheap(),
    evidenceIdsWithAProducer: withProducer.length,
    closureEdges: Math.min(withProducer.length, casesWithRequirement.length),
    // Relative to the directory holding the four trees. It sliced at the first "/lokalized" in the
    // absolute path, which named `planning/...` correctly only when that directory's own path
    // contained "/lokalized"; in any other checkout location the record carried absolute paths.
    producers: Object.fromEntries(withProducer.map((id) =>
      [id, index.get(id).map((/** @type {string} */ f) => relative(resolve(spec, ".."), f).split(sep).join("/"))])),
  };
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  if (process.argv.includes("--json")) console.log(JSON.stringify(record, null, 2));
  else { print(record); console.log(`\nrecorded generated/evidence-closure.json`); }
} else {
  // --check: no sweep. What is GATED is that the record is CURRENT, never that closure is closed.
  if (!existsSync(recordPath)) {
    console.error("generated/evidence-closure.json is absent; run `npm run evidence`. A report with no record has not passed, it has not run.");
    process.exit(1);
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const drift = [];
  for (const [k, v] of Object.entries(cheap()))
    if (record[k] !== v) drift.push({ field: k, recorded: record[k] ?? null, now: v });
  for (const [k, v] of Object.entries(inputs()))
    if (record.inputs?.[k] !== v) drift.push({ field: `inputs.${k}`, recorded: record.inputs?.[k] ?? null, now: v });
  if (drift.length > 0) {
    console.error(JSON.stringify({ status: "stale", detail: "the recorded evidence-closure report no longer describes these inputs; re-run `npm run evidence`", drift }, null, 2));
    process.exit(1);
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(record, null, 2));
  else print(record);
}

// The ONE thing this gates about the measurement itself: the registry must be readable and
// non-empty. A report over nothing would print a tidy row of zeroes indistinguishable from the
// finding.
if (rows.length === 0 || ids.length === 0) {
  console.error("\nthe requirement registry is empty or carries no evidence ids; this report would " +
    "be zeroes that mean 'not measured' rather than zeroes that mean 'no closure'");
  process.exit(1);
}
