#!/usr/bin/env node
// @ts-check
/**
 * Plan 8.2's PARTITION RULE, as a gate — because for five milestones it was only a convention.
 *
 * `../CLAUDE.md` asserted that this rule was already enforced: "the invariant now lives at ingest
 * instead: `ingest.mjs` REFUSES a `loadClasspath`/`loadClasspathResources` case that is not
 * `informationalIds`. Negative-tested." MEASURED 2026-09-13: `ingest.mjs` contains ZERO occurrences
 * of `informationalIds`, `requiredPortableIds` or `loadClasspath`, and NO executable file in this
 * repository read the `partition` field at all — only the schema's enum and its
 * `requiredImplementationIds -> implementationFamily` conditional touched it. The corpus satisfied
 * the rule by authoring discipline. This file is the gate that sentence claimed.
 *
 * WHAT THE RULE IS. Plan 8.2 partitions every case and says a strict parity-backed release
 * "requires every `requiredPortableId` to pass and empty failed, xfailed, and unsupported sets for
 * that partition"; 8.5 repeats it. A case a portable implementation can NEVER run therefore may not
 * sit in a required partition — not as a matter of taste, but because one such case makes that
 * release unreachable forever. That is not hypothetical here: 145 classpath cases were partitioned
 * `requiredPortableIds` and had to be moved, and the same defect was found again in a second family
 * on 2026-09-14.
 *
 * WHAT THIS GATE DOES NOT COVER, SAID PLAINLY RATHER THAN LEFT TO BE DISCOVERED. It is keyed on the
 * OPERATION, and an operation name is only one of the axes a permanently unrunnable case can arrive
 * on. The second family — 43 cases whose FIXTURE overrides a plan-4.6 runtime limit — is invisible
 * here and always will be, because whether such a case is convertible depends on whether the
 * override changed Java's answer, which only a RUN can decide (59 of those 102 cases pass). The
 * general form of this rule is therefore keyed on the OUTCOME and lives in the port's conformance
 * runner, `lokalized-js/tools/conformance.mjs`, where a run is available. This gate is the half a
 * repository with no implementation in it can check: it catches a misauthored case before a JVM
 * round trip and in a clone that has no port beside it.
 *
 *   node tools/partition-check.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const specDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Operations no portable implementation can ever run, with the reason sourced to the JVM concept
 * rather than to a preference. Each entry is checked in BOTH directions: every case naming the
 * operation must be informational, and an entry no case names at all is STALE and fails, so this
 * cannot rot into a list of excuses the way three known-gap lists in this project already have.
 */
const JVM_ONLY_OPERATIONS = {
  loadClasspath:
    "scans a JVM classpath package through ClassLoader.getResources, including JAR package directory " +
    "entries and the reserved META-INF/versions multi-release namespace. No JS runtime has a classpath",
  loadClasspathResources:
    "resolves one resource per locale through a ClassLoader, whose first-wins order across classpath " +
    "roots is a JVM property with no JS equivalent",
};

/** Plan 8.2's two required partitions. `informationalIds` "may be unsupported" and is the safe one. */
const REQUIRED_PARTITIONS = new Set(["requiredPortableIds", "requiredImplementationIds"]);

const authored = new Map();
const caseFiles = readdirSync(join(specDirectory, "cases")).filter((name) => name.endsWith(".cases.json"));
for (const name of caseFiles)
  for (const testCase of JSON.parse(readFileSync(join(specDirectory, "cases", name), "utf8")).cases)
    authored.set(testCase.id, { ...testCase, sourceFile: name });

const generated = JSON.parse(readFileSync(join(specDirectory, "generated", "behavioral-vectors.json"), "utf8"));

/** @type {string[]} */
const problems = [];

// --- 1. a JVM-only operation may not sit in a partition a release must clear -----------------------
for (const [id, testCase] of authored)
  if (JVM_ONLY_OPERATIONS[testCase.operation] && REQUIRED_PARTITIONS.has(testCase.partition))
    problems.push(
      `${id}\n      is '${testCase.partition}' in ${testCase.sourceFile}, but operation ` +
      `'${testCase.operation}' ${JVM_ONLY_OPERATIONS[testCase.operation]}.\n      Plan 8.2 requires that ` +
      `partition to show an EMPTY unsupported set at release, so as partitioned no portable release ` +
      `can ever qualify. Make it informationalIds.`);

// --- 2. the declaration itself goes stale ---------------------------------------------------------
const operationsPresent = new Set([...authored.values()].map((testCase) => testCase.operation));
for (const operation of Object.keys(JVM_ONLY_OPERATIONS))
  if (!operationsPresent.has(operation))
    problems.push(
      `JVM_ONLY_OPERATIONS names '${operation}' and no case uses it.\n      A nonportability claim ` +
      `nobody exercises is a sentence, not a rule: delete the entry, or find out why the cases went.`);

// --- 3. the authored partition and the SHIPPED one must agree -------------------------------------
//
// The generated corpus is what every implementation reads, and `build.mjs`'s fixture writer is a
// hand-listed projection — the shape that silently dropped `pathShape` and `entries` in S14 and let
// the Java oracle bank a believable expectation for an input the corpus did not contain. Nothing
// downstream reads `partition`, so a projection that lost it would be invisible everywhere else.
const generatedIds = new Set();
for (const testCase of generated.cases) {
  generatedIds.add(testCase.id);
  const source = authored.get(testCase.id);
  if (!source)
    problems.push(`${testCase.id}\n      is in the generated corpus and in no cases/*.cases.json file.`);
  else if (source.partition !== testCase.partition)
    problems.push(
      `${testCase.id}\n      is authored '${source.partition}' in ${source.sourceFile} and shipped ` +
      `'${testCase.partition}'. The generated corpus is what implementations read.`);
}
for (const id of authored.keys())
  if (!generatedIds.has(id))
    problems.push(`${id}\n      is authored in ${authored.get(id).sourceFile} and absent from the generated corpus.`);

// --- report ---------------------------------------------------------------------------------------
const counts = new Map();
for (const testCase of authored.values())
  counts.set(testCase.partition, (counts.get(testCase.partition) ?? 0) + 1);

console.log(`partitions over ${authored.size} cases in ${caseFiles.length} files:`);
for (const [partition, n] of [...counts].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(5)}  ${partition}`);
for (const operation of Object.keys(JVM_ONLY_OPERATIONS)) {
  const all = [...authored.values()].filter((testCase) => testCase.operation === operation);
  console.log(`  ${String(all.length).padStart(5)}  ${operation} — JVM-only, all informational: ` +
    `${all.every((testCase) => testCase.partition === "informationalIds")}`);
}

if (problems.length) {
  console.error(`\nPARTITION DEFECT (${problems.length}):`);
  for (const problem of problems) console.error(`    ${problem}`);
  process.exit(1);
}
console.log("ok    every JVM-only case is informational, every declaration is live, authored == shipped");
