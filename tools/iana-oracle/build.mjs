#!/usr/bin/env node
// @ts-check
/**
 * Builds `generated/iana-language-range-equivalents.json` and its external lock.
 *
 * PROVENANCE, stated plainly because it differs from plan v7 section 5.1's design:
 * v7 specifies generating the closure from a pinned IANA Language Subtag Registry snapshot and then
 * adding JDK-compatibility override rows wherever the snapshot and the JDK disagree. This build
 * instead derives the closure DIRECTLY FROM THE JDK 21 ORACLE by exhaustive probe.
 *
 * Why: the artifact's stated purpose is parity with lokalized-java 3.0.0, whose negotiation calls
 * `java.util.Locale.LanguageRange.parse`. Deriving from the oracle makes divergence structurally
 * impossible — there is nothing to reconcile and no override rows exist. The cost is that the
 * artifact records no IANA `File-Date`; it is pinned to a JDK build rather than to a registry
 * release. See generated/IANA-PROVENANCE.md.
 *
 *   node tools/iana-oracle/build.mjs --write
 *   node tools/iana-oracle/build.mjs --check
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const spec = resolve(here, "../..");
const generatedDir = join(spec, "generated");
const ARTIFACT = join(generatedDir, "iana-language-range-equivalents.json");
const LOCK = join(generatedDir, "iana-data-lock.json");

const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";

/**
 * Probe lokalized-java's own table rather than the JDK's.
 *
 * **THE MODE IS READ BACK OUT OF THE ARTIFACT, not left to whoever types the command.** `--check`
 * has to regenerate the same way `--write` did or it compares a library-derived artifact against a
 * JDK-derived regeneration and reports drift that is not there — measured, it did exactly that
 * once. The artifact records its own `source`, so it can say which oracle produced it; the flag
 * only has to be passed the first time, when the source is being changed deliberately.
 */
const LIBRARY = process.argv.includes("--library") || (() => {
  try {
    return JSON.parse(readFileSync(join(spec, "generated/iana-language-range-equivalents.json"), "utf8"))
      .source === "lokalized-java";
  } catch { return false; }
})();
const JAVA_DIR = process.env.LOKALIZED_JAVA_DIR ?? resolve(spec, "../lokalized-java");
/** Written by the library probe: the oracle table's own key set, for the completeness assertion. */
const LIBRARY_KEYS = join(here, "library-equivalence-keys.txt");

/**
 * Compile and run the library probe against lokalized-java's built classes.
 *
 * `IanaLanguageEquivalents` is package-private, so the probe lives in `com.lokalized` and is
 * compiled against `target/classes`. Making the class public to suit a build tool would widen the
 * library's API surface for the convenience of a probe.
 */
/**
 * Dump the oracle table's own keys, BEFORE the candidate space is generated from them.
 *
 * Ordering is the whole point and it is why this is a separate class rather than a second output of
 * the extraction: `candidates.mjs` has to be able to READ these keys, and the extraction runs after
 * `candidates.mjs`. A dump produced by the extraction could only ever seed the NEXT run's probe
 * space, which is a bootstrapping trap dressed as a check.
 */
/**
 * The oracle's VERSION, read from its own pom rather than restated here.
 *
 * `source: "lokalized-java"` alone cannot distinguish two builds of the library whose tables
 * differ, and the port ships a `ianaClosureSource` constant naming where its closure came from —
 * which read `jdk-corretto:21.0.11` for a slice after the oracle stopped being the JDK, because
 * nothing derived it. A hand-maintained provenance string is the thing this whole file exists to
 * avoid.
 */
function libraryVersion() {
  const pom = readFileSync(join(JAVA_DIR, "pom.xml"), "utf8");
  // The FIRST <version> after the artifactId, i.e. the project's own — not a dependency's.
  const version = /<artifactId>lokalized<\/artifactId>\s*<version>([^<]+)<\/version>/.exec(pom)?.[1];
  if (!version)
    throw new Error(`could not read lokalized-java's own version from ${join(JAVA_DIR, "pom.xml")}; ` +
      `the artifact would record an oracle it cannot name`);
  return version.trim();
}

function dumpLibraryKeys() {
  const classes = join(JAVA_DIR, "target/classes");
  if (!existsSync(join(classes, "com/lokalized/IanaLanguageEquivalents.class")))
    throw new Error(`--library needs lokalized-java built with its IANA table: ${classes} has no ` +
      `com/lokalized/IanaLanguageEquivalents.class. Run 'mvn -q compile' there first.`);

  const source = join(here, "library/com/lokalized/LibraryEquivalenceKeys.java");
  const out = mkdtempSync(join(tmpdir(), "lokalized-library-keys-"));
  const compile = spawnSync(join(JDK, "bin/javac"), ["-nowarn", "-cp", classes, "-d", out, source], { encoding: "utf8" });
  if (compile.status !== 0) throw new Error(`library key dumper did not compile: ${compile.stderr}`);

  const run = spawnSync(join(JDK, "bin/java"), ["-cp", `${classes}:${out}`,
    "com.lokalized.LibraryEquivalenceKeys", LIBRARY_KEYS], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`library key dump failed: ${run.stderr}`);

  return Number(/libraryEquivalenceKeys=(\d+)/.exec(run.stderr)?.[1] ?? 0);
}

function extractFromLibrary(candidatesPath, rawPath) {
  const classes = join(JAVA_DIR, "target/classes");
  if (!existsSync(join(classes, "com/lokalized/IanaLanguageEquivalents.class")))
    throw new Error(`--library needs lokalized-java built with its IANA table: ${classes} has no ` +
      `com/lokalized/IanaLanguageEquivalents.class. Run 'mvn -q compile' there first.`);

  const source = join(here, "library/com/lokalized/ExtractLibrary.java");
  const out = mkdtempSync(join(tmpdir(), "lokalized-extract-library-"));
  const compile = spawnSync(join(JDK, "bin/javac"), ["-nowarn", "-cp", classes, "-d", out, source], { encoding: "utf8" });
  if (compile.status !== 0) throw new Error(`library probe did not compile: ${compile.stderr}`);

  return spawnSync(join(JDK, "bin/java"), ["-cp", `${classes}:${out}`, "com.lokalized.ExtractLibrary",
    candidatesPath, rawPath], { encoding: "utf8" });
}
const REQUIRED_MAJOR = 21;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Canonical JSON: sorted keys, no whitespace. Same rule as every other artifact here. */
const jcs = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(",")}}`;
};

function jdkVersion() {
  const run = spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" });
  const text = `${run.stderr}${run.stdout}`;
  const version = /version "([^"]+)"/.exec(text)?.[1];
  if (!version) throw new Error(`cannot determine JDK version at ${JDK}`);
  const major = Number(version.split(".")[0]);
  if (major !== REQUIRED_MAJOR)
    throw new Error(`oracle requires JDK ${REQUIRED_MAJOR}; found ${version}. The equivalence table is JDK-version-dependent, which is the whole reason it is pinned.`);
  return { version, vendor: /(\w[\w ]*?)\s+Runtime Environment/.exec(text)?.[1] ?? "unknown" };
}

/** An entry is derived when a shorter entry yields it by prefix substitution. */
const isDerived = (key, values, table) => {
  const parts = key.split("-");
  for (let n = 1; n < parts.length; n++) {
    const prefix = parts.slice(0, n).join("-");
    const rest = parts.slice(n).join("-");
    const base = table[prefix];
    if (!base) continue;
    const expected = base.map((p) => `${p}-${rest}`).sort();
    const actual = [...values].sort();
    if (expected.length === actual.length && expected.every((v, i) => v === actual[i])) return true;
  }
  return false;
};

/** Reconstruct any probed range from the reduced table, applying prefix substitution. */
const expand = (key, table) => {
  if (table[key]) return table[key];
  const parts = key.split("-");
  for (let n = parts.length - 1; n >= 1; n--) {
    const base = table[parts.slice(0, n).join("-")];
    if (base) return base.map((p) => `${p}-${parts.slice(n).join("-")}`);
  }
  return [key];
};

/**
 * Reduce a probed closure to genuine table entries, shortest key first so a base is available when
 * testing longer keys, then verify the reduction is LOSSLESS -- every probed expansion reconstructs
 * exactly. Factored out of `build` when the JDK cross-check below arrived, because comparing two
 * closures is only meaningful if both were reduced by the same operation; a second hand-written
 * copy of this loop is exactly the drift `tools/graph-walk.mjs`'s extraction was done to avoid.
 */
function reduce(raw) {
  const table = {};
  for (const key of Object.keys(raw).sort((a, b) => a.split("-").length - b.split("-").length || a.localeCompare(b))) {
    if (!isDerived(key, raw[key], table)) table[key] = raw[key];
  }

  const lossy = Object.keys(raw).filter((k) => jcs([...expand(k, table)].sort()) !== jcs([...raw[k]].sort()));
  if (lossy.length > 0) throw new Error(`reduction is lossy for ${lossy.length} range(s), e.g. ${lossy.slice(0, 3)}`);

  return table;
}

/**
 * **WHY A LIBRARY-DERIVED ARTIFACT STILL HAS TO PROBE THE JDK.**
 *
 * lokalized-java 3.1.0 carries TWO expansion tables and uses them in different places:
 * `java.util.Locale.LanguageRange.parse` -- the JDK's -- is what a CALLER uses to build the list it
 * hands `matchFor`, and `IanaLanguageEquivalents.parse` -- the registry's -- is what
 * `bestMatchForAcceptLanguage` and `DefaultStrings#addParsedLanguageRangeIdentities` use INSIDE the
 * library. `VectorOracle.languageRangesFrom` says so in its own comment: a `matchFor` case's string
 * input is parsed "before the library is entered". So the port needs both tables too, or its public
 * `parseLanguageRanges` -- which the conformance runner calls exactly where the oracle calls
 * `LanguageRange.parse` -- answers a question the recorded Java answer was not asked.
 *
 * Shipping two closures would double ~23 KB in every browser graph. Measured instead: on this probe
 * space the library's table is a strict SUPERSET of the JDK's, so the artifact carries one table
 * plus the list of tags the JDK's lacks. **That superset property is the assertion, not the
 * assumption** -- a shared key whose class MOVED, or a key the JDK has and the library does not,
 * fails here rather than silently giving the public parse the wrong answer. The delta is derived
 * from a real second extraction every run; it is never hand-maintained.
 */
function jdkAbsentTagsFor(libraryTable, candidatesPath) {
  const rawPath = join(mkdtempSync(join(tmpdir(), "lokalized-jdk-crosscheck-")), "closure.raw.json");
  const run = spawnSync(join(JDK, "bin/java"), [join(here, "Extract.java"), candidatesPath, rawPath], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`JDK cross-check extraction failed: ${run.stderr}`);

  const jdkTable = reduce(JSON.parse(readFileSync(rawPath, "utf8")));

  const jdkOnly = Object.keys(jdkTable).filter((key) => !Object.hasOwn(libraryTable, key));
  if (jdkOnly.length > 0)
    throw new Error(
      `${jdkOnly.length} equivalence key(s) exist in the JDK's table and not in the library's, e.g. ` +
        `${jdkOnly.slice(0, 5).join(", ")}. The artifact carries ONE table plus the tags the JDK ` +
        `lacks, which can only represent a library table that is a superset. Ship both closures, or ` +
        `find out why the library stopped expanding a range the JDK expands.`,
    );

  // **ORDER-EXACT, AND SORTING BOTH SIDES WAS A REAL HOLE.** The first version compared
  // `jcs([...a].sort())` against `jcs([...b].sort())`, i.e. the classes as SETS — while the port
  // recovers the JDK's insertion order OUT OF the stored class (`recoverLanguageEquivalents` in
  // `src/negotiate/index.js`) and `parseLanguageRanges` returns members in that order, which the
  // JDK differential compares position by position. A shared key whose class was REORDERED would
  // have passed this check and handed the port's public parse the library's order under the name
  // of the JDK's. The encoding cannot express that either, so it fails here.
  const moved = Object.keys(jdkTable).filter((key) =>
    jcs(jdkTable[key]) !== jcs(libraryTable[key]));
  if (moved.length > 0)
    throw new Error(
      `${moved.length} equivalence class(es) differ between the JDK's table and the library's, e.g. ` +
        `${moved.slice(0, 5).map((k) => `${k}: ${JSON.stringify(jdkTable[k])} vs ` +
          `${JSON.stringify(libraryTable[k])}`).join("; ")}. The single-table-plus-delta encoding ` +
        `cannot express a class that MOVED, only one the JDK is missing entirely.`,
    );

  const absent = Object.keys(libraryTable).filter((key) => !Object.hasOwn(jdkTable, key)).sort();
  if (absent.length === 0)
    throw new Error(
      "the library's table and the JDK's are identical, so nothing distinguishes the two parse " +
        "channels and the port's split would be untestable. Either the library lost its registry " +
        "table or this probed the wrong classes.",
    );

  return { absent, jdkEntries: Object.keys(jdkTable).length };
}

function build() {
  const jdk = jdkVersion();

  // Regenerate the candidate space so it is never stale relative to the CLDR data it derives from,
  // nor relative to the pinned JDK's own equivalence tables, which it now also draws on.
  const dumpedLibraryKeys = LIBRARY ? dumpLibraryKeys() : 0;

  const candGen = spawnSync("node", [join(here, "candidates.mjs")], { encoding: "utf8" });
  if (candGen.status !== 0) throw new Error(`candidate generation failed: ${candGen.stderr}`);
  const candidatesPath = join(here, "candidates.txt");
  const candidateBytes = readFileSync(candidatesPath);
  const keysPath = join(here, "jdk-equivalence-keys.txt");
  const jdkKeys = readFileSync(keysPath, "utf8").split("\n").filter(Boolean);

  const rawPath = join(here, "closure.raw.json");

  // **WHICH ORACLE.** Until lokalized-java 3.1.0 the library called
  // `java.util.Locale.LanguageRange.parse`, so the JDK was the oracle and `Extract.java` probed it.
  // 3.1.0 carries its own registry-sourced table, so the oracle moved and `ExtractLibrary.java`
  // probes the library. Deriving from the oracle rather than reconciling against it is the property
  // IANA-PROVENANCE.md argues for; it is preserved, just pointed at the implementation that now
  // decides the answer. The JDK mode is kept because it is what produced every artifact before this
  // and a comparison between the two is the whole evidence for the change.
  const run = LIBRARY
    ? extractFromLibrary(candidatesPath, rawPath)
    : spawnSync(join(JDK, "bin/java"), [join(here, "Extract.java"), candidatesPath, rawPath], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`oracle extraction failed: ${run.stderr}`);
  const probeStats = /probed=(\d+) rejected=(\d+) closureKeys=(\d+)/.exec(run.stderr);
  const registryFileDate = /registryFileDate=(\S+)/.exec(run.stderr)?.[1] ?? null;

  // TWO INDEPENDENT READS OF THE SAME FIELD must agree, or a stale keys file seeded a narrower
  // probe space than the table the extraction just questioned — and the completeness assertion
  // below would then be checking the artifact against yesterday's key list.
  const probedLibraryKeys = Number(/libraryKeys=(\d+)/.exec(run.stderr)?.[1] ?? 0);
  if (LIBRARY && probedLibraryKeys !== dumpedLibraryKeys)
    throw new Error(`the key dump saw ${dumpedLibraryKeys} equivalence keys and the extraction saw ` +
      `${probedLibraryKeys}; ${LIBRARY_KEYS} is stale relative to the classes being probed`);

  const raw = JSON.parse(readFileSync(rawPath, "utf8"));

  // COMPLETENESS, checked rather than argued. The losslessness check below verifies that every
  // PROBED range reconstructs, which says nothing about a range nobody probed — and for four keys
  // (`cmn-hans`, `cmn-hant`, `lv-lvs`, `lv-ltg`) nobody did, so the artifact shipped without them
  // and every gate stayed green. The fix is not "a wider guess": it is this assertion, that the
  // extracted closure carries an entry for EVERY key of the JDK's own equivalence tables. Those keys
  // come from `LocaleEquivalentMaps` by reflection — the JDK's input data, not this artifact — so
  // this cannot be satisfied by a probe space derived from the artifact under test.
  // **AND THE ORACLE'S OWN KEYS, not just the JDK's.** `jdkKeys` is the JDK's input data, which was
  // the right probe space while the JDK was the oracle. lokalized-java 3.1.0 carries its own
  // 781-key table, so a space derived only from the JDK's is blind to a key the LIBRARY has and the
  // JDK does not — measured, four of them reached no closure entry. Both lists are required now, so
  // the assertion is keyed on whichever implementation is answering.
  const libraryKeys = LIBRARY
    ? readFileSync(LIBRARY_KEYS, "utf8").split("\n").filter(Boolean)
    : [];
  const unprobed = [...new Set([...jdkKeys, ...libraryKeys])].filter((key) => !Object.hasOwn(raw, key));
  if (unprobed.length > 0)
    throw new Error(
      `${unprobed.length} of the oracle's own equivalence keys produced no closure entry, e.g. ` +
        `${unprobed.slice(0, 5).join(", ")}. Either candidates.mjs stopped emitting them or the ` +
        `oracle rejected them; a missing key is a range the port will answer differently from Java.`,
    );

  const table = reduce(raw);

  // A SECOND EXTRACTION, against the JDK, whenever the library is the oracle. See jdkAbsentTagsFor.
  const crossCheck = LIBRARY ? jdkAbsentTagsFor(table, candidatesPath) : null;

  const artifact = {
    formatVersion: 1,
    closureSchema: "prefix-substituting-equivalence-table/1",
    source: LIBRARY ? "lokalized-java" : "jdk-oracle",
    jdkVersion: jdk.version,
    jdkVendor: jdk.vendor,
    ianaRegistryFileDate: registryFileDate,
    // Present ONLY on a library-derived artifact: a JDK-derived one IS the JDK's table, so the
    // delta would be empty and an empty list reads as "checked and equal" rather than "not asked".
    ...(LIBRARY ? { jdkAbsentTags: crossCheck.absent, libraryVersion: libraryVersion() } : {}),
    equivalents: table,
  };

  const artifactBytes = Buffer.from(jcs(artifact), "utf8");
  const lock = {
    formatVersion: 1,
    artifacts: [{ path: "generated/iana-language-range-equivalents.json", sha256: sha256(artifactBytes) }],
    inputs: [
      { path: "tools/iana-oracle/Extract.java", sha256: sha256(readFileSync(join(here, "Extract.java"))) },
      { path: "tools/iana-oracle/EquivalenceKeys.java", sha256: sha256(readFileSync(join(here, "EquivalenceKeys.java"))) },
      { path: "tools/iana-oracle/candidates.mjs", sha256: sha256(readFileSync(join(here, "candidates.mjs"))) },
      { path: "tools/iana-oracle/candidates.txt", sha256: sha256(candidateBytes) },
      // The probe space's second source is locked too: a JDK whose table changed shape would
      // otherwise change the artifact with nothing in the lock recording that it had.
      { path: "tools/iana-oracle/jdk-equivalence-keys.txt", sha256: sha256(readFileSync(keysPath)) },
      // The oracle's own key list joins the lock for the same reason the JDK's is in it: it is half
      // the probe space, and a probe space that moved without the artifact moving is exactly the
      // drift this lock exists to record.
      ...(LIBRARY ? [{ path: "tools/iana-oracle/library-equivalence-keys.txt", sha256: sha256(readFileSync(LIBRARY_KEYS)) }] : []),
    ],
    oracle: { jdkVersion: jdk.version, jdkVendor: jdk.vendor, requiredMajor: REQUIRED_MAJOR },
    probe: probeStats
      ? {
          probed: Number(probeStats[1]),
          rejected: Number(probeStats[2]),
          rawClosureKeys: Number(probeStats[3]),
          reducedEntries: Object.keys(table).length,
          jdkEquivalenceKeys: jdkKeys.length,
        }
      : null,
    jdkCompatibilityOverrides: [],
  };
  // Fingerprint excludes itself, matching the CLDR lock's construction.
  lock.ianaDataFingerprint = sha256(Buffer.from(jcs({ formatVersion: lock.formatVersion, artifacts: lock.artifacts }), "utf8"));

  return { artifactBytes, lock };
}

const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;
if (!mode) {
  console.error("usage: node tools/iana-oracle/build.mjs --write | --check");
  process.exit(2);
}

const { artifactBytes, lock } = build();
const lockBytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, "utf8");

if (mode === "write") {
  writeFileSync(ARTIFACT, artifactBytes);
  writeFileSync(LOCK, lockBytes);
  console.log(JSON.stringify({ status: "written", entries: Object.keys(JSON.parse(artifactBytes.toString()).equivalents).length, bytes: artifactBytes.length, ianaDataFingerprint: lock.ianaDataFingerprint }));
} else {
  const problems = [];
  if (!existsSync(ARTIFACT)) problems.push("artifact missing; run --write");
  else if (!readFileSync(ARTIFACT).equals(artifactBytes)) problems.push("artifact bytes differ from regeneration");
  if (!existsSync(LOCK)) problems.push("lock missing; run --write");
  else if (!readFileSync(LOCK).equals(lockBytes)) problems.push("lock differs from regeneration");
  if (problems.length) {
    console.error(JSON.stringify({ status: "stale", problems }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "current", ianaDataFingerprint: lock.ianaDataFingerprint }));
}
