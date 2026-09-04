#!/usr/bin/env node
// @ts-check
/**
 * Builds `generated/cldr-data-lock.json`: the external hash lock for the generated CLDR artifacts,
 * and the shared `dataFingerprint` every implementation exposes.
 *
 * The lock lives OUTSIDE the artifacts it hashes, so no artifact hashes itself, and the fingerprint
 * excludes its own field for the same reason. Java, JS, Python and Go all expose this one source
 * fingerprint rather than a hash of their differing native encodings — that is what makes it
 * comparable across implementations.
 *
 *   node tools/data-lock.mjs --write | --check
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const javaDir = process.env.LOKALIZED_JAVA_DIR ? resolve(process.env.LOKALIZED_JAVA_DIR) : resolve(spec, "../lokalized-java");
const vendorRoot = "vendor/lokalized-java/src/build/resources/cldr";
const LOCK = join(spec, "generated/cldr-data-lock.json");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Canonical JSON: sorted keys, no whitespace. */
const jcs = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(",")}}`;
};

/** The generated CLDR artifacts, in lexicographic path order as the lock requires. */
const ARTIFACT_PATHS = [
  `${vendorRoot}/cldr-conformance-vectors.json`,
  `${vendorRoot}/cldr-locale-data.json`,
  `${vendorRoot}/cldr-plural-data.json`,
].sort();

/**
 * The pinned CLDR source inputs, as SHA-pinned by CldrDataGenerator and compiled into the generated
 * Java. Read from there rather than restated, so a CLDR bump cannot leave this lock behind.
 */
function pinnedInputs() {
  const sources = ["GeneratedCldrLocaleData.java", "GeneratedCldrPluralData.java"].map((f) =>
    readFileSync(join(javaDir, "src/main/java/com/lokalized", f), "utf8"),
  );
  /** @type {Record<string, string>} */
  const resources = {};
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const text of sources) {
    for (const m of text.matchAll(/static final String (\w+)_RESOURCE = "([^"]+)"/g)) resources[m[1]] = m[2];
    for (const m of text.matchAll(/static final String (\w+)_SHA_256 = "([0-9a-f]{64})"/g)) hashes[m[1]] = m[2];
  }
  const inputs = Object.keys(hashes)
    .filter((k) => resources[k])
    .map((k) => ({ path: resources[k], sha256: hashes[k] }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (inputs.length === 0) throw new Error("no pinned CLDR inputs found in the generated Java sources");
  return inputs;
}

function build() {
  const artifacts = ARTIFACT_PATHS.map((path) => {
    const full = join(spec, path);
    if (!existsSync(full)) throw new Error(`missing generated artifact: ${path}`);
    return { path, sha256: sha256(readFileSync(full)) };
  });

  const cldrVersion = JSON.parse(readFileSync(join(spec, vendorRoot, "cldr-locale-data.json"), "utf8")).cldrVersion;
  const inputs = pinnedInputs();

  const lock = {
    formatVersion: 1,
    cldrVersion,
    // Identifies the code that produced the artifacts, so a generator change is visible even when
    // the CLDR inputs are unchanged.
    generatorVersion: sha256(readFileSync(join(javaDir, "src/build/java/com/lokalized/cldr/CldrDataGenerator.java"))),
    inputsSha256: sha256(Buffer.from(jcs(inputs), "utf8")),
    inputs,
    artifacts,
  };

  // Fingerprint over the {formatVersion, cldrVersion, artifacts} projection only, excluding itself.
  lock.dataFingerprint = sha256(
    Buffer.from(jcs({ formatVersion: lock.formatVersion, cldrVersion: lock.cldrVersion, artifacts: lock.artifacts }), "utf8"),
  );
  return lock;
}

const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;
if (!mode) {
  console.error("usage: node tools/data-lock.mjs --write | --check");
  process.exit(2);
}

const lock = build();
const bytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, "utf8");

if (mode === "write") {
  writeFileSync(LOCK, bytes);
  console.log(JSON.stringify({ status: "written", artifacts: lock.artifacts.length, inputs: lock.inputs.length, cldrVersion: lock.cldrVersion, dataFingerprint: lock.dataFingerprint }));
} else {
  if (!existsSync(LOCK)) {
    console.error(JSON.stringify({ status: "missing", detail: "run --write" }));
    process.exit(1);
  }
  if (!readFileSync(LOCK).equals(bytes)) {
    const onDisk = JSON.parse(readFileSync(LOCK, "utf8"));
    const drifted = lock.artifacts.filter((a) => onDisk.artifacts?.find((/** @type {any} */ b) => b.path === a.path)?.sha256 !== a.sha256);
    console.error(JSON.stringify({ status: "stale", driftedArtifacts: drifted.map((a) => a.path), detail: "run --write" }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "current", dataFingerprint: lock.dataFingerprint }));
}
