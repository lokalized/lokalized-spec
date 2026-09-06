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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const spec = resolve(here, "../..");
const generatedDir = join(spec, "generated");
const ARTIFACT = join(generatedDir, "iana-language-range-equivalents.json");
const LOCK = join(generatedDir, "iana-data-lock.json");

const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";
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

function build() {
  const jdk = jdkVersion();

  // Regenerate the candidate space so it is never stale relative to the CLDR data it derives from,
  // nor relative to the pinned JDK's own equivalence tables, which it now also draws on.
  const candGen = spawnSync("node", [join(here, "candidates.mjs")], { encoding: "utf8" });
  if (candGen.status !== 0) throw new Error(`candidate generation failed: ${candGen.stderr}`);
  const candidatesPath = join(here, "candidates.txt");
  const candidateBytes = readFileSync(candidatesPath);
  const keysPath = join(here, "jdk-equivalence-keys.txt");
  const jdkKeys = readFileSync(keysPath, "utf8").split("\n").filter(Boolean);

  const rawPath = join(here, "closure.raw.json");
  const run = spawnSync(join(JDK, "bin/java"), [join(here, "Extract.java"), candidatesPath, rawPath], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`oracle extraction failed: ${run.stderr}`);
  const probeStats = /probed=(\d+) rejected=(\d+) closureKeys=(\d+)/.exec(run.stderr);

  const raw = JSON.parse(readFileSync(rawPath, "utf8"));

  // COMPLETENESS, checked rather than argued. The losslessness check below verifies that every
  // PROBED range reconstructs, which says nothing about a range nobody probed — and for four keys
  // (`cmn-hans`, `cmn-hant`, `lv-lvs`, `lv-ltg`) nobody did, so the artifact shipped without them
  // and every gate stayed green. The fix is not "a wider guess": it is this assertion, that the
  // extracted closure carries an entry for EVERY key of the JDK's own equivalence tables. Those keys
  // come from `LocaleEquivalentMaps` by reflection — the JDK's input data, not this artifact — so
  // this cannot be satisfied by a probe space derived from the artifact under test.
  const unprobed = jdkKeys.filter((key) => !Object.hasOwn(raw, key));
  if (unprobed.length > 0)
    throw new Error(
      `${unprobed.length} of the JDK's own equivalence keys produced no closure entry, e.g. ` +
        `${unprobed.slice(0, 5).join(", ")}. Either candidates.mjs stopped emitting them or the ` +
        `oracle rejected them; a missing key is a range the port will answer differently from Java.`,
    );

  // Reduce to genuine table entries, shortest key first so a base is available when testing longer keys.
  const table = {};
  for (const key of Object.keys(raw).sort((a, b) => a.split("-").length - b.split("-").length || a.localeCompare(b))) {
    if (!isDerived(key, raw[key], table)) table[key] = raw[key];
  }

  // The reduction must be lossless: every probed expansion reconstructs exactly.
  const lossy = Object.keys(raw).filter((k) => jcs([...expand(k, table)].sort()) !== jcs([...raw[k]].sort()));
  if (lossy.length > 0) throw new Error(`reduction is lossy for ${lossy.length} range(s), e.g. ${lossy.slice(0, 3)}`);

  const artifact = {
    formatVersion: 1,
    closureSchema: "prefix-substituting-equivalence-table/1",
    source: "jdk-oracle",
    jdkVersion: jdk.version,
    jdkVendor: jdk.vendor,
    ianaRegistryFileDate: null,
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
