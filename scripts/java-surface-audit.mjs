#!/usr/bin/env node
// @ts-check
/**
 * Audits plan Appendix B against the real lokalized-java public surface.
 *
 * Plan v7 Appendix B: "M0 checks this table against the Java public surface and records any newly
 * discovered public type or method before API freeze." This makes that a standing check rather than
 * a one-time reading, so a future Java release that adds a public type fails here instead of
 * silently widening the surface the JS port claims to have dispositioned.
 *
 *   node scripts/java-surface-audit.mjs           human-readable
 *   node scripts/java-surface-audit.mjs --json    machine-readable
 *
 * Exits nonzero on any drift.
 */
import { planPath as resolvePlanPath, planningDirectory } from "./planning-path.mjs";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const specDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const javaDirectory = process.env.LOKALIZED_JAVA_DIR
  ? resolve(process.env.LOKALIZED_JAVA_DIR)
  : resolve(specDirectory, "../lokalized-java");
const sourceDirectory = join(javaDirectory, "src/main/java/com/lokalized");
const PLAN = resolvePlanPath();

const OUTER = /^public (?:final |abstract )?(?:class|interface|enum|@interface) (\w+)\b/m;
const NESTED = /^[ \t]+public (?:static )?(?:final )?(?:abstract )?(?:class|interface|enum) (\w+)\b/gm;

/**
 * Public members of a package-private class are not reachable from outside the package, so a
 * nested public type only counts as API when its enclosing type is itself public.
 */
async function javaSurface() {
  const outerTypes = [];
  const nestedTypes = [];

  for (const entry of await readdir(sourceDirectory)) {
    if (!entry.endsWith(".java")) continue;
    const name = basename(entry, ".java");
    const source = await readFile(join(sourceDirectory, entry), "utf8");
    const outer = OUTER.exec(source);
    if (!outer || outer[1] !== name) continue;

    outerTypes.push(name);
    for (const match of source.matchAll(NESTED)) nestedTypes.push(`${name}.${match[1]}`);
  }

  return { outerTypes: outerTypes.sort(), nestedTypes: [...new Set(nestedTypes)].sort() };
}

/** Type names appearing in the first column of Appendix B's disposition table. */
async function appendixTypes() {
  const plan = await readFile(PLAN, "utf8");
  const index = plan.indexOf("## Appendix B");
  if (index < 0) throw new Error("Appendix B not found in the plan");
  return [...new Set([...plan.slice(index).matchAll(/^\|\s*`([A-Za-z.]+)`\s*\|/gm)].map((m) => m[1]))].sort();
}

/**
 * Rows added to Appendix B after the plan was frozen, each naming the amendment that decided it.
 *
 * The plan is not edited (pre-m0/registry-linter.mjs pins its digest), so a public type Java gains
 * later is dispositioned in `java-surface-amendments.json` instead. The rows are held to the same
 * standard as Appendix B's and to two more: a row may not restate a type Appendix B already
 * dispositions (two dispositions for one type would let them disagree), and a row must carry an
 * amendment id and a disposition in words. A row for a type that is no longer public is STALE through
 * the same rule as an Appendix B row.
 *
 * **THE AMENDMENT MUST EXIST.** The id shape alone was checked, so a row naming `A999` — an amendment
 * nobody made — passed with "No drift" (measured). Every amendment is recorded as a `### A<n> ` heading
 * in `planning/M-R-STATUS.md`, the status document for the milestone that pins Java's public surface
 * after the plan froze, and the row's id must name one. The planning directory is already a required
 * input of this audit (it reads the plan), so a missing status document exits 2 naming the remedy
 * rather than passing.
 */
const AMENDMENT_RECORD = "M-R-STATUS.md";
async function amendmentRows() {
  const document = JSON.parse(await readFile(join(specDirectory, "java-surface-amendments.json"), "utf8"));
  const problems = [];
  if (document.formatVersion !== 1) problems.push(`java-surface-amendments.json formatVersion ${document.formatVersion}; this audit reads 1`);
  const rows = Array.isArray(document.rows) ? document.rows : [];
  const recordPath = join(planningDirectory, AMENDMENT_RECORD);
  if (rows.length > 0 && !existsSync(recordPath)) {
    console.error(`${recordPath} not found; it records the amendments java-surface-amendments.json cites.\n`
      + `  Point LOKALIZED_PLANNING_DIR at the directory holding it.`);
    process.exit(2);
  }
  const recordText = rows.length > 0 ? await readFile(recordPath, "utf8") : "";
  for (const row of rows) {
    if (typeof row.type !== "string" || !/^[A-Za-z.]+$/.test(row.type)) problems.push(`amendment row ${JSON.stringify(row.type)} does not name a type`);
    if (typeof row.amendment !== "string" || !/^A\d+$/.test(row.amendment)) problems.push(`amendment row ${row.type} names no amendment (A<n>)`);
    // The heading is the id followed by a SPACE, so A3 does not match A30's heading.
    else if (!recordText.split("\n").some((line) => line.startsWith(`### ${row.amendment} `)))
      problems.push(`amendment row ${row.type} cites ${row.amendment}, which has no '### ${row.amendment} ' heading in planning/${AMENDMENT_RECORD}; a disposition must name an amendment that was made`);
    if (typeof row.disposition !== "string" || row.disposition.trim().length < 20) problems.push(`amendment row ${row.type} states no disposition`);
  }
  return { types: rows.map((row) => row.type), problems };
}

const { outerTypes, nestedTypes } = await javaSurface();
const planAppendix = await appendixTypes();
const amendments = await amendmentRows();
const restated = amendments.types.filter((t) => planAppendix.includes(t));
const repeated = amendments.types.filter((t, i) => amendments.types.indexOf(t) !== i);
const appendix = [...new Set([...planAppendix, ...amendments.types])].sort();

const undispositioned = outerTypes.filter((t) => !appendix.includes(t));
const stale = appendix.filter((t) => !outerTypes.includes(t) && !nestedTypes.includes(t));
// Nested types are API too. They may be dispositioned by name, or by their enclosing type's row.
const nestedUnnamed = nestedTypes.filter(
  (t) => !appendix.includes(t) && !appendix.includes(t.split(".")[0]),
);

const drift = [
  ...undispositioned.map((t) => ({ kind: "undispositioned-public-type", type: t })),
  ...stale.map((t) => ({ kind: "appendix-row-has-no-public-java-type", type: t })),
  ...nestedUnnamed.map((t) => ({ kind: "undispositioned-nested-type", type: t })),
  ...restated.map((t) => ({ kind: "amendment-row-restates-an-appendix-b-row", type: t })),
  ...repeated.map((t) => ({ kind: "amendment-row-repeated", type: t })),
  ...amendments.problems.map((problem) => ({ kind: "malformed-amendment-row", type: problem })),
];

const report = {
  javaPublicOuterTypes: outerTypes.length,
  javaPublicNestedTypes: nestedTypes.length,
  appendixRows: planAppendix.length,
  amendmentRows: amendments.types.length,
  drift,
  // Informational: covered only through the enclosing type's row, never by name. Not drift, but
  // the reason a type-level table cannot by itself prove nested coverage.
  nestedCoveredOnlyByParent: nestedTypes.filter(
    (t) => !appendix.includes(t) && appendix.includes(t.split(".")[0]),
  ),
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `Java public outer types: ${report.javaPublicOuterTypes}   nested: ${report.javaPublicNestedTypes}   Appendix B rows: ${report.appendixRows}   amendment rows: ${report.amendmentRows}`,
  );
  if (drift.length === 0) console.log("\nNo drift: every public type is dispositioned.");
  else {
    console.log(`\n${drift.length} drift item(s):`);
    for (const item of drift) console.log(`  [${item.kind}] ${item.type}`);
  }
  console.log(
    `\nNested types covered only by their enclosing row (${report.nestedCoveredOnlyByParent.length}):`,
  );
  for (const t of report.nestedCoveredOnlyByParent) console.log(`  ${t}`);
}

process.exit(drift.length === 0 ? 0 : 1);
