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
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const specDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const javaDirectory = process.env.LOKALIZED_JAVA_DIR
  ? resolve(process.env.LOKALIZED_JAVA_DIR)
  : resolve(specDirectory, "../lokalized-java");
const sourceDirectory = join(javaDirectory, "src/main/java/com/lokalized");
const PLAN = join(specDirectory, "IMPLEMENTATION-PLAN-v7.md");

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

const { outerTypes, nestedTypes } = await javaSurface();
const appendix = await appendixTypes();

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
];

const report = {
  javaPublicOuterTypes: outerTypes.length,
  javaPublicNestedTypes: nestedTypes.length,
  appendixRows: appendix.length,
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
    `Java public outer types: ${report.javaPublicOuterTypes}   nested: ${report.javaPublicNestedTypes}   Appendix B rows: ${report.appendixRows}`,
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
