#!/usr/bin/env node
// @ts-check
/**
 * THE JDK CHECK on `generated/iana-language-equivalences.json`. It produces no data: the artifact is
 * generated from the pinned registry with no JDK by `generate.mjs` (amendment A30), and this holds
 * it to the two implementations that must agree with it — lokalized-java, which does not read the
 * artifact but derives its own table from its own copy of the same registry snapshot, and the JDK 21
 * whose `LanguageRange#parse` lokalized-java 3.0.0 used and whose region/variant order the artifact's
 * one authored input records.
 *
 * It needs the pinned JDK 21 (`LOKALIZED_ORACLE_JDK`) and lokalized-java's built classes
 * (`LOKALIZED_JAVA_DIR`, default `../lokalized-java`, `target/classes`). It writes ONLY its record,
 * `generated/iana-jdk-check.json`, and only when every gate passes; `--check` re-runs it and requires
 * the committed record byte for byte. `generate.mjs --check` holds that record to the current
 * artifact and to these tools' digests with no JDK, which is what makes this binding in CI.
 *
 * GATES — every one fails the run:
 *   table            lokalized-java's reflected LANGUAGE_EQUIVALENTS equals the artifact's classes read
 *                    as "each member to the class without it", key for key, ORDER INCLUDED;
 *   pairs            its REGION_VARIANT_EQUIVALENTS equals the artifact's pairs, in order;
 *   jdkOrder         the JDK's regionVariantEquivMap, in iteration order, equals the artifact's pairs —
 *                    the authored order's source label, verified rather than trusted;
 *   constants        its REGISTRY_FILE_DATE and REGISTRY_SHA256 equal the artifact's registry block;
 *   vendoredCopies   every copy lokalized-java keeps of this repository's inputs is byte-identical
 *                    (exit 2 when it keeps none, because then nothing ties the two together);
 *   libraryDefault   the library's PUBLIC `parseLanguageRanges`, on an instance that never sets
 *                    `languageRangeEquivalents`, equals `model.mjs` on every probe: ranges, weights,
 *                    and for a refusal the exception class and message;
 *   libraryJdkMode   the same method with `LanguageRangeEquivalents.JDK` equals the JDK's own
 *                    `LanguageRange#parse` on every probe;
 *   probed           every artifact member and every library and JDK table key is in the probe space.
 *
 * ANTI-VACUITY — each also fails the run: the ordered region/variant pair probes are all present
 * (without them a reordering of the substitutions is invisible — measured, 0 of 116,229 probes moved);
 * some probe is refused; and the JDK's parse differs from the model on at least one probe, or the
 * default and JDK channels would be indistinguishable and `libraryJdkMode` would prove nothing.
 *
 * INFORMATIONAL, re-derived every run and recorded: `jdkParseDiffers`, the probes where the JDK's
 * parse and the registry's disagree, with their first ranges.
 *
 *   node tools/iana-oracle/build.mjs --write | --check
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cldrCandidates, classHeaders, grammarProbes, orderedPairProbes, probeSpace } from "./candidates.mjs";
import { modelFor } from "./model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const spec = resolve(here, "../..");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";
const JAVA_DIR = process.env.LOKALIZED_JAVA_DIR ? resolve(process.env.LOKALIZED_JAVA_DIR) : resolve(spec, "../lokalized-java");
const REQUIRED_MAJOR = 21;

const ARTIFACT = "generated/iana-language-equivalences.json";
const RECORD = "generated/iana-jdk-check.json";
/** Kept identical to generate.mjs's CHECK_TOOLS; its record arm fails on any difference. */
const CHECK_TOOLS = [
  "tools/iana-oracle/build.mjs",
  "tools/iana-oracle/candidates.mjs",
  "tools/iana-oracle/library/com/lokalized/IanaCheckProbe.java",
  "tools/iana-oracle/model.mjs",
];
/** Inputs of this repository that lokalized-java may keep its own copy of, under src/build/resources/iana/. */
const VENDORABLE = [
  { spec: ARTIFACT, java: "src/build/resources/iana/iana-language-equivalences.json" },
  { spec: "tools/iana-oracle/language-subtag-registry.txt", java: "src/build/resources/iana/language-subtag-registry.txt" },
];

const sha256 = (/** @type {Buffer | string} */ bytes) => createHash("sha256").update(bytes).digest("hex");
const jcs = (/** @type {any} */ value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(",")}}`;
};
const bytewise = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);

const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;
if (!mode) {
  console.error("usage: node tools/iana-oracle/build.mjs --write | --check");
  process.exit(2);
}

/**
 * The temporary work directory, once one exists. Module scope and declared BEFORE the first call to
 * `cannotRun`, which reads it.
 * @type {string | null}
 */
let work = null;

/**
 * Stop with exit 2: the check could not run, which is never a pass. @param {string} message
 *
 * **IT REMOVES THE WORK DIRECTORY ITSELF, because `process.exit` does not run `finally`.** Three of
 * these calls sit inside the `try` whose `finally` removes it, and before this each one left a
 * `lokalized-iana-check-*` directory in the system temp folder — measured, a compile failure moved
 * their count from 1 to 2, and a 1 MB directory from an earlier run was still there. The same class
 * as the 2.0 GB conformance temp-dir leak. `tools/iana-oracle/cannot-run-cleanup.mjs` forces each of
 * the three and counts the directories left behind.
 */
function cannotRun(message) {
  if (work !== null) rmSync(work, { recursive: true, force: true });
  console.error(JSON.stringify({ status: "cannot-run", detail: message }, null, 2));
  process.exit(2);
}

/* ------------------------------------------------------------------------------ the oracles */

const javaVersionText = (() => {
  const run = spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" });
  return `${run.stderr ?? ""}${run.stdout ?? ""}`;
})();
const jdkVersion = /version "([^"]+)"/.exec(javaVersionText)?.[1];
if (!jdkVersion) cannotRun(`no JDK at ${JDK}; set LOKALIZED_ORACLE_JDK to the pinned JDK 21`);
if (Number(/** @type {string} */ (jdkVersion).split(".")[0]) !== REQUIRED_MAJOR)
  cannotRun(`this check requires JDK ${REQUIRED_MAJOR}; found ${jdkVersion}. The JDK's table and region/variant order are version-dependent, which is why the source label names one.`);

const classes = join(JAVA_DIR, "target/classes");
if (!existsSync(join(classes, "com/lokalized/IanaLanguageEquivalents.class")) || !existsSync(join(classes, "com/lokalized/LanguageRangeEquivalents.class")))
  cannotRun(`lokalized-java is not built with its IANA table and LanguageRangeEquivalents at ${classes}; run 'mvn -o -q compile' there`);

const libraryVersion = /<artifactId>lokalized<\/artifactId>\s*<version>([^<]+)<\/version>/.exec(readFileSync(join(JAVA_DIR, "pom.xml"), "utf8"))?.[1]?.trim();
if (!libraryVersion) cannotRun(`cannot read lokalized-java's own version from ${join(JAVA_DIR, "pom.xml")}`);

/** The same recipe as tools/vector-oracle/build.mjs, so the two records can be matched. */
const librarySourcesSha256 = (() => {
  const sources = join(JAVA_DIR, "src/main/java/com/lokalized");
  return sha256(Buffer.from(jcs(readdirSync(sources).sort().map((file) => ({ path: file, sha256: sha256(readFileSync(join(sources, file))) }))), "utf8"));
})();

const artifactBytes = readFileSync(join(spec, ARTIFACT));
/** @type {{ registry: { fileDate: string, sha256: string }, languageEquivalenceClasses: string[][], regionVariantEquivalents: [string, string][] }} */
const artifact = JSON.parse(artifactBytes.toString("utf8"));
const model = modelFor(artifact);
const artifactMembers = artifact.languageEquivalenceClasses.flat();

const workDirectory = mkdtempSync(join(tmpdir(), "lokalized-iana-check-"));
work = workDirectory;
/** @type {any} */
let dump;
/** @type {string[]} */
let probes;
/** @type {any[]} */
let rows;
try {
  const compiled = join(workDirectory, "classes");
  const compile = spawnSync(join(JDK, "bin/javac"), ["-nowarn", "-cp", classes, "-d", compiled,
    join(here, "library/com/lokalized/IanaCheckProbe.java")], { encoding: "utf8" });
  if (compile.status !== 0) cannotRun(`IanaCheckProbe did not compile against ${classes}:\n${compile.stderr}`);
  const java = (/** @type {string[]} */ args) => spawnSync(join(JDK, "bin/java"), [
    "--add-exports", "java.base/sun.util.locale=ALL-UNNAMED",
    "--add-opens", "java.base/sun.util.locale=ALL-UNNAMED",
    "-cp", `${classes}:${compiled}`, "com.lokalized.IanaCheckProbe", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });

  const dumpPath = join(workDirectory, "dump.json");
  const dumped = java(["dump", dumpPath]);
  if (dumped.status !== 0) cannotRun(`IanaCheckProbe dump failed (exit ${dumped.status}):\n${dumped.stderr}`);
  dump = JSON.parse(readFileSync(dumpPath, "utf8"));

  const libraryKeys = Object.keys(dump.library.languageEquivalents);
  const jdkKeys = [...dump.jdk.singleEquivKeys, ...dump.jdk.multiEquivsKeys];
  const members = new Set(artifactMembers);
  const extraKeys = [...new Set([...libraryKeys, ...jdkKeys])].filter((key) => !members.has(key)).sort(bytewise);
  probes = probeSpace(artifact, extraKeys);

  const probesPath = join(workDirectory, "probes.json");
  writeFileSync(probesPath, JSON.stringify(probes));
  const outPath = join(workDirectory, "parsed.jsonl");
  const parsed = java(["parse", probesPath, outPath]);
  if (parsed.status !== 0) cannotRun(`IanaCheckProbe parse failed (exit ${parsed.status}):\n${parsed.stderr}`);
  rows = readFileSync(outPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  dump.extraKeys = extraKeys;
  dump.libraryKeys = libraryKeys;
  dump.jdkKeys = [...new Set(jdkKeys)];
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
  work = null;
}

/* ---------------------------------------------------------------------------------- gates */

/** @type {string[]} */
const problems = [];
/** @type {string[]} */
const samples = [];
const sample = (/** @type {string} */ text) => { if (samples.length < 12) samples.push(text); };

// table
const expectedTable = new Map();
for (const members of artifact.languageEquivalenceClasses)
  for (const key of members) expectedTable.set(key, members.filter((member) => member !== key));
const tableKeys = [...new Set([...expectedTable.keys(), ...Object.keys(dump.library.languageEquivalents)])].sort(bytewise);
let tableDifferences = 0;
for (const key of tableKeys) {
  const expected = expectedTable.get(key) ?? null;
  const actual = dump.library.languageEquivalents[key] ?? null;
  if (jcs(expected) !== jcs(actual)) {
    tableDifferences++;
    sample(`table ${key}: artifact ${JSON.stringify(expected)}, lokalized-java ${JSON.stringify(actual)}`);
  }
}
if (tableDifferences > 0) problems.push(`lokalized-java's language table differs from the artifact on ${tableDifferences} key(s)`);

// pairs, jdkOrder
const artifactPairs = jcs(artifact.regionVariantEquivalents);
const libraryPairsEqual = jcs(dump.library.regionVariantEquivalents) === artifactPairs;
if (!libraryPairsEqual) problems.push(`lokalized-java's REGION_VARIANT_EQUIVALENTS ${JSON.stringify(dump.library.regionVariantEquivalents)} is not the artifact's ${artifactPairs}`);
const jdkOrderEqual = jcs(dump.jdk.regionVariantOrder) === artifactPairs;
if (!jdkOrderEqual) problems.push(`JDK ${jdkVersion}'s regionVariantEquivMap iterates ${JSON.stringify(dump.jdk.regionVariantOrder)}, not the authored ${artifactPairs}; the compatibility file's source label is false for this JDK`);

// constants
const constantsEqual = dump.library.registryFileDate === artifact.registry.fileDate && dump.library.registrySha256 === artifact.registry.sha256;
if (!constantsEqual) problems.push(`lokalized-java names registry ${dump.library.registryFileDate} ${dump.library.registrySha256}; the artifact names ${artifact.registry.fileDate} ${artifact.registry.sha256}`);

// vendoredCopies
const vendoredCopies = VENDORABLE.filter(({ java }) => existsSync(join(JAVA_DIR, java))).map(({ spec: specPath, java }) => ({
  path: java,
  equal: readFileSync(join(JAVA_DIR, java)).equals(readFileSync(join(spec, specPath))),
}));
if (vendoredCopies.length === 0)
  cannotRun(`lokalized-java keeps neither ${VENDORABLE.map(({ java }) => java).join(" nor ")}; nothing ties its table to this repository's inputs`);
for (const copy of vendoredCopies) if (!copy.equal) problems.push(`lokalized-java's ${copy.path} is not byte-identical to this repository's copy`);

// the three parse columns
const describeModel = (/** @type {string} */ header) => {
  try {
    return { ok: model.parse(header) };
  } catch (error) {
    const refusal = /** @type {any} */ (error);
    if (!refusal.javaClass) throw error;
    return { refused: refusal.javaClass, message: refusal.message };
  }
};
const agrees = (/** @type {any} */ expected, /** @type {any} */ java) => {
  if (expected.refused !== undefined || java.refused !== undefined)
    return expected.refused === java.refused && expected.message === java.message;
  if (expected.ok.length !== java.ok.length) return false;
  return expected.ok.every((/** @type {{ range: string, weight: number }} */ entry, /** @type {number} */ index) =>
    entry.range === java.ok[index][0] && Object.is(entry.weight, Number(java.ok[index][1])));
};
const show = (/** @type {any} */ outcome) => (outcome.refused !== undefined
  ? `refused ${outcome.refused}: ${outcome.message}`
  : outcome.ok.map((/** @type {any} */ entry) => (Array.isArray(entry) ? `${entry[0]};${entry[1]}` : `${entry.range};${entry.weight}`)).join(","));

if (rows.length !== probes.length) cannotRun(`IanaCheckProbe answered ${rows.length} probes of ${probes.length}`);
let refused = 0;
let defaultMismatches = 0;
let jdkModeMismatches = 0;
let jdkParseDiffers = 0;
const jdkDifferFirstRanges = new Set();
const refusalClasses = new Set();
for (const [index, registry, jdkSetting, jdkParse] of rows) {
  const header = /** @type {string} */ (probes[index]);
  const expected = describeModel(header);
  if (registry.refused !== undefined) { refused++; refusalClasses.add(registry.refused); }
  if (!agrees(expected, registry)) {
    defaultMismatches++;
    sample(`default ${JSON.stringify(header)}: model ${show(expected)} | lokalized-java ${show(registry)}`);
  }
  if (jcs(jdkSetting) !== jcs(jdkParse)) {
    jdkModeMismatches++;
    sample(`JDK setting ${JSON.stringify(header)}: lokalized-java ${show(jdkSetting)} | LanguageRange.parse ${show(jdkParse)}`);
  }
  if (!agrees(expected, jdkParse)) {
    jdkParseDiffers++;
    jdkDifferFirstRanges.add(expected.ok?.[0]?.range ?? header);
  }
}
if (defaultMismatches > 0) problems.push(`lokalized-java's parseLanguageRanges (default setting) differs from model.mjs on ${defaultMismatches} probe(s)`);
if (jdkModeMismatches > 0) problems.push(`lokalized-java's parseLanguageRanges with LanguageRangeEquivalents.JDK differs from LanguageRange.parse on ${jdkModeMismatches} probe(s)`);

// probed
const probeSet = new Set(probes);
const unprobed = [...new Set([...artifactMembers, ...dump.libraryKeys, ...dump.jdkKeys])].filter((key) => !probeSet.has(key));
if (unprobed.length > 0) problems.push(`${unprobed.length} table key(s) were not probed, e.g. ${unprobed.slice(0, 5).join(", ")}`);

// anti-vacuity
const pairProbes = orderedPairProbes(artifact);
const distinctFrom = new Set(artifact.regionVariantEquivalents.map(([from]) => from)).size;
if (distinctFrom < 2 || pairProbes.length !== distinctFrom * (distinctFrom - 1) * 2 || !pairProbes.every((probe) => probeSet.has(probe)))
  problems.push(`the ordered region/variant pair probes are incomplete (${pairProbes.length} for ${distinctFrom} subtags); a reordering of the substitutions would be invisible without them`);
if (refused === 0) problems.push("no probe was refused; the grammar arm exercised nothing");
if (jdkParseDiffers === 0) problems.push("the JDK's LanguageRange.parse agrees with the model on every probe, so the default and JDK channels are indistinguishable and the JDK-setting arm proves nothing");
const allowedRefusals = new Set(["java.lang.IllegalArgumentException", "java.lang.ArrayIndexOutOfBoundsException"]);
for (const refusal of refusalClasses)
  if (!allowedRefusals.has(refusal)) problems.push(`the default parse refused a probe with ${refusal}, which its contract does not name`);

/* --------------------------------------------------------------------------------- the record */

const record = {
  formatVersion: 1,
  note: "Written by tools/iana-oracle/build.mjs --write (npm run iana:jdk-check) on the pinned JDK 21, only when every gate passes. NOT fingerprinted. tools/iana-oracle/generate.mjs --check (npm run check:iana-registry, no JDK) requires artifact.sha256 and every tools[].sha256 to be current and every mismatch count to be zero, rebuilds the probe space from probeSpace.extraKeys and requires its count, its sha256 and model.mjs's refusal count over it, and requires JDK 21, libraryRegionVariantOrder.equal, a non-zero jdkParseDiffers and the librarySourcesSha256 of generated/behavioral-vectors.json.",
  artifact: { path: ARTIFACT, sha256: sha256(artifactBytes) },
  tools: CHECK_TOOLS.map((path) => ({ path, sha256: sha256(readFileSync(join(spec, path))) })),
  oracle: {
    jdkVersion,
    jdkVendor: dump.javaVendor,
    jdkRuntimeVersion: dump.javaRuntimeVersion,
    libraryVersion,
    librarySourcesSha256,
  },
  probeSpace: {
    probes: probes.length,
    sha256: sha256(Buffer.from(JSON.stringify(probes), "utf8")),
    cldrDerived: cldrCandidates().length,
    artifactMembers: artifactMembers.length,
    libraryKeys: dump.libraryKeys.length,
    jdkKeys: dump.jdkKeys.length,
    extraKeys: dump.extraKeys,
    compoundClassHeaders: classHeaders(artifact).length,
    orderedPairProbes: pairProbes.length,
    grammarProbes: grammarProbes().length,
    recipe: "candidates.mjs probeSpace(artifact, extraKeys): the sorted, de-duplicated union of cldrCandidates(), every artifact member, extraKeys, classHeaders(artifact), orderedPairProbes(artifact) and grammarProbes(); sha256 is over JSON.stringify of that array",
  },
  results: {
    table: { keys: tableKeys.length, classes: artifact.languageEquivalenceClasses.length, regionVariantPairs: artifact.regionVariantEquivalents.length, differences: tableDifferences },
    registryConstants: { equal: constantsEqual },
    libraryRegionVariantOrder: { equal: libraryPairsEqual },
    jdkRegionVariantOrder: { equal: jdkOrderEqual },
    vendoredCopies,
    libraryDefault: { probes: rows.length, refused, refusalClasses: [...refusalClasses].sort(bytewise), mismatches: defaultMismatches },
    libraryJdkMode: { probes: rows.length, mismatchesAgainstJdkParse: jdkModeMismatches },
    jdkParseDiffers: { probes: jdkParseDiffers, firstRanges: [...jdkDifferFirstRanges].sort(bytewise) },
  },
};
const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");

if (problems.length > 0) {
  console.error(JSON.stringify({ status: "failed", detail: mode === "write" ? "the record was NOT written" : "gates failed", problems, samples, results: record.results }, null, 2));
  process.exit(1);
}

if (mode === "write") {
  writeFileSync(join(spec, RECORD), recordBytes);
  console.log(JSON.stringify({ status: "written", probes: probes.length, refused, jdkParseDiffers, recordSha256: sha256(recordBytes) }));
  process.exit(0);
}

const onDisk = existsSync(join(spec, RECORD)) ? readFileSync(join(spec, RECORD)) : null;
if (!onDisk || !onDisk.equals(recordBytes)) {
  /** @type {string[]} */
  const drift = [];
  if (onDisk) {
    const committed = JSON.parse(onDisk.toString("utf8"));
    const walk = (/** @type {any} */ a, /** @type {any} */ b, /** @type {string} */ path) => {
      if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], path ? `${path}.${key}` : key);
      } else if (jcs(a) !== jcs(b)) drift.push(path);
    };
    walk(committed, record, "");
  }
  console.error(JSON.stringify({ status: "stale", detail: onDisk ? "the committed record differs from this run; re-run npm run iana:jdk-check and review" : `${RECORD} is missing; run npm run iana:jdk-check`, drift }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: "current", probes: probes.length, refused, jdkParseDiffers }));
