#!/usr/bin/env node
// @ts-check
/**
 * M3b's gate: every uncovered branch in a named semantic class carries a reviewed disposition.
 *
 * Not a coverage percentage. A percentage cannot be reviewed, and chasing one rewards writing cases
 * that touch code rather than cases that DISCRIMINATE behavior. The two defects found by hand during
 * M5b — missing tiebreaker validation, and tiebreaker tags compared raw against normalized supported
 * tags — both lived in branches the corpus reached but no case distinguished. A percentage would have
 * looked healthy either way.
 *
 * Two failure modes, both fatal:
 *   UNDISPOSITIONED  an uncovered branch nobody has reviewed
 *   STALE            a disposition for a branch that is now covered — the review is out of date
 *
 * The stale check is what keeps this honest over time. Without it the table becomes a list of
 * excuses that outlives the reasons for them.
 *
 *   node tools/coverage/check.mjs [--list-undispositioned] [--class <substring>]
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const coverage = JSON.parse(readFileSync(join(spec, "generated/coverage-branches.json"), "utf8"));
const review = JSON.parse(readFileSync(join(spec, "generated/coverage-dispositions.json"), "utf8"));

const listAll = process.argv.includes("--list-undispositioned");
const classFilter = process.argv.includes("--class") ? process.argv[process.argv.indexOf("--class") + 1] : null;

const key = (cls, method, signature, line) => `${cls}#${method}${signature}:${line}`;

const excludedClass = (cls) =>
  review.excludedClasses.find((/** @type {any} */ e) => cls.startsWith(e.pattern)) ?? null;
const classDisposition = (cls) =>
  (review.classDispositions ?? []).find((/** @type {any} */ e) => e.class === cls) ?? null;

/** @type {Map<string, any>} */
const byKey = new Map();
for (const entry of review.branchDispositions ?? [])
  byKey.set(key(entry.class, entry.method, entry.signature, entry.line), entry);

const undispositioned = [];
const counts = { required: 0, excluded: 0, nonportable: 0, byExcludedClass: 0, byClassDisposition: 0 };
const seen = new Set();

for (const cc of coverage.classes) {
  if (classFilter && !cc.class.includes(classFilter)) continue;
  const classLevel = excludedClass(cc.class) ?? classDisposition(cc.class);

  for (const mc of cc.methods) {
    for (const point of mc.uncovered) {
      const id = key(cc.class, mc.method, mc.signature, point.line);
      if (classLevel) {
        counts[excludedClass(cc.class) ? "byExcludedClass" : "byClassDisposition"]++;
        continue;
      }
      const entry = byKey.get(id);
      if (!entry) { undispositioned.push({ id, cls: cc.class, method: mc.method, line: point.line, branches: point.branches, covered: point.covered }); continue; }
      seen.add(id);
      counts[entry.disposition] = (counts[entry.disposition] ?? 0) + 1;
    }
  }
}

// STALE: a disposition whose branch is no longer uncovered. Either a case now discriminates it — in
// which case the entry should be deleted and the win recorded — or the code moved and the entry now
// points at nothing, which is worse because it looks reviewed.
const stale = [...byKey.keys()].filter((id) => !seen.has(id) && !classFilter);

const pct = ((coverage.coveredBranches / coverage.totalBranches) * 100).toFixed(1);
console.log(`corpus-only branch coverage: ${coverage.coveredBranches}/${coverage.totalBranches} (${pct}%)`);
console.log(`uncovered branch points: ${coverage.uncoveredBranchPoints}\n`);
console.log(`  excluded by class rule   ${String(counts.byExcludedClass).padStart(5)}`);
console.log(`  dispositioned by class   ${String(counts.byClassDisposition).padStart(5)}`);
console.log(`  required (owed a case)   ${String(counts.required).padStart(5)}`);
console.log(`  excluded                 ${String(counts.excluded).padStart(5)}`);
console.log(`  nonportable              ${String(counts.nonportable).padStart(5)}`);
console.log(`  UNDISPOSITIONED          ${String(undispositioned.length).padStart(5)}`);
if (stale.length) console.log(`  STALE dispositions       ${String(stale.length).padStart(5)}`);

if (undispositioned.length && listAll) {
  console.log(`\nundispositioned:`);
  for (const u of undispositioned) console.log(`  ${u.id}  (${u.covered}/${u.branches} branches)`);
} else if (undispositioned.length) {
  const byClass = new Map();
  for (const u of undispositioned) byClass.set(u.cls, (byClass.get(u.cls) ?? 0) + 1);
  console.log(`\nundispositioned by class (--list-undispositioned for each):`);
  for (const [cls, n] of [...byClass].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`  ${String(n).padStart(4)}  ${cls.replace("com.lokalized.", "")}`);
}

if (stale.length) {
  console.log(`\nSTALE — these branches are now covered; delete the entries (and record the win):`);
  for (const id of stale.slice(0, 15)) console.log(`  ${id}`);
}

process.exit(undispositioned.length === 0 && stale.length === 0 ? 0 : 1);
