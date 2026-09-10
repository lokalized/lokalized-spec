#!/usr/bin/env node
// @ts-check
/**
 * Builds `generated/behavioral-vectors.json` — the cross-implementation behavioral corpus of plan
 * v7 section 8.2/8.3.
 *
 * The governing principle: NO `expected` BLOCK IS EVER WRITTEN BY HAND. Case files under `cases/`
 * carry inputs only. This driver materializes each fixture's strings files, runs them through an
 * unmodified lokalized-java 3.0.0 on the pinned JDK, and records what that implementation actually
 * does. A JS/Python/Go implementation is then compared against Java's real behavior rather than
 * against someone's reading of it — the same reason the IANA table is derived from the JDK oracle
 * instead of reconciled with it.
 *
 * The one thing this driver DOES assert is the seed table published in plan section 8.3. That table
 * was written by hand, so it is treated as a claim to be checked, not as truth.
 *
 *   node tools/vector-oracle/build.mjs --write | --check
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const spec = resolve(here, "../..");
const javaDir = process.env.LOKALIZED_JAVA_DIR ? resolve(process.env.LOKALIZED_JAVA_DIR) : resolve(spec, "../lokalized-java");
const ARTIFACT = join(spec, "generated/behavioral-vectors.json");

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
  const text = `${run.stderr ?? ""}${run.stdout ?? ""}`;
  const version = /version "([^"]+)"/.exec(text)?.[1];
  if (!version) throw new Error(`cannot determine JDK version at ${JDK}`);
  const major = Number(version.split(".")[0]);
  if (major !== REQUIRED_MAJOR)
    throw new Error(`vector oracle requires JDK ${REQUIRED_MAJOR}; found ${version}`);
  return version;
}

function loadFixtures() {
  const dir = join(spec, "fixtures");
  /** @type {Record<string, any>} */
  const fixtures = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const fixture = JSON.parse(readFileSync(join(dir, file), "utf8"));
    if (fixture.id !== file.replace(/\.json$/, ""))
      throw new Error(`fixture ${file} declares id "${fixture.id}"; the two must match`);
    fixtures[fixture.id] = fixture;
  }
  return fixtures;
}

function loadCases() {
  const dir = join(spec, "cases");
  const cases = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".cases.json")).sort())
    cases.push(...JSON.parse(readFileSync(join(dir, file), "utf8")).cases);

  const seen = new Set();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`duplicate case id: ${c.id}`);
    seen.add(c.id);
    if ("expected" in c)
      throw new Error(`case ${c.id} carries a hand-written "expected"; the oracle produces those`);
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Write each fixture's strings files to disk and run the corpus through Java.
 *
 * The files go to disk rather than into the oracle as inlined data so that the real
 * LocalizedStringLoader parses them — loading is part of the behavior under test.
 */
function runOracle(fixtures, cases) {
  const classes = join(javaDir, "target/classes");
  if (!existsSync(classes))
    throw new Error(`lokalized-java is not built: ${classes} is missing. Run 'mvn -q compile' there first.`);

  const work = mkdtempSync(join(tmpdir(), "lokalized-vectors-"));
  try {
    /** @type {Record<string, any>} */
    const request = { fixtures: {}, cases };
    for (const [id, fixture] of Object.entries(fixtures)) {
      const fixtureDir = join(work, "fixtures", id);
      mkdirSync(fixtureDir, { recursive: true });
      // Strings files are extensionless and named by locale tag, matching the loader's convention.
      for (const [tag, contents] of Object.entries(fixture.files ?? {}))
        writeFileSync(join(fixtureDir, tag), `${JSON.stringify(contents, null, 2)}\n`, "utf8");
      // Verbatim text, for content JSON.stringify cannot produce: duplicate members, unclosed
      // structures, magic keys that a JS object would swallow.
      for (const [name, text] of Object.entries(fixture.rawFiles ?? {}))
        writeFileSync(join(fixtureDir, name), text, "utf8");
      // Exact bytes, for malformed UTF-8 and unpaired surrogates, which cannot survive a JS string.
      for (const [name, base64] of Object.entries(fixture.rawFilesBase64 ?? {}))
        writeFileSync(join(fixtureDir, name), Buffer.from(base64, "base64"));
      request.fixtures[id] = {
        dir: fixtureDir,
        loadOnly: fixture.loadOnly ?? false,
        refusesConstruction: fixture.refusesConstruction ?? false,
        constructionOverrides: fixture.constructionOverrides ?? null,
        fallbackLocale: fixture.fallbackLocale,
        instanceLocale: fixture.instanceLocale ?? fixture.fallbackLocale,
        tiebreakers: fixture.tiebreakers ?? null,
        loadingOptions: fixture.loadingOptions ?? null,
        translationFailureHandler: fixture.translationFailureHandler ?? null,
        translationFallbackPolicy: fixture.translationFallbackPolicy ?? null,
        phoneticResolver: fixture.phoneticResolver ?? null,
        localeSupplier: fixture.localeSupplier ?? null,
        localeMatchSupplier: fixture.localeMatchSupplier ?? null,
        runtimeLimits: fixture.runtimeLimits ?? null,
        bidiIsolation: fixture.bidiIsolation ?? null,
      };
    }

    // The oracle needs the JS constant names to emit (axis, name, renderName) tuples. They come from
    // the symbol allowlist, keyed there by Java class name; section 3.7's axis spelling is stated
    // explicitly rather than derived, because "grammatical-case" is not a mechanical transform of
    // "GrammaticalCase" that anything else in the repo relies on.
    const AXIS_BY_JAVA_TYPE = {
      Animacy: "animacy",
      Cardinality: "cardinality",
      Classifier: "classifier",
      Clusivity: "clusivity",
      Definiteness: "definiteness",
      Formality: "formality",
      Gender: "gender",
      GrammaticalCase: "grammatical-case",
      Ordinality: "ordinality",
      Phonetic: "phonetic",
    };
    const allowlist = JSON.parse(readFileSync(join(spec, "symbol-allowlist.json"), "utf8"));
    request.languageFormConstantsByAxis = {};
    for (const [javaType, names] of Object.entries(allowlist.languageFormConstantsByAxis)) {
      const axis = AXIS_BY_JAVA_TYPE[javaType];
      if (!axis) throw new Error(`symbol allowlist carries language forms for unknown type ${javaType}`);
      request.languageFormConstantsByAxis[axis] = names;
    }
    if (Object.keys(request.languageFormConstantsByAxis).length !== Object.keys(AXIS_BY_JAVA_TYPE).length)
      throw new Error("symbol allowlist does not cover every language-form axis");

    const requestPath = join(work, "request.json");
    const outPath = join(work, "out.json");
    writeFileSync(requestPath, JSON.stringify(request), "utf8");

    // Compiled rather than run in single-file source mode: the oracle sits in package
    // com.lokalized to reuse the library's JSON parser, and single-file mode would load it under a
    // separate classloader, putting it in a different runtime package and breaking that access.
    const classesOut = join(work, "oracle-classes");
    mkdirSync(classesOut, { recursive: true });
    const compile = spawnSync(join(JDK, "bin/javac"), ["-cp", classes, "-d", classesOut, join(here, "VectorOracle.java")], { encoding: "utf8" });
    if (compile.status !== 0) throw new Error(`oracle compilation failed:\n${compile.stderr}`);

    const run = spawnSync(join(JDK, "bin/java"), ["-cp", `${classes}:${classesOut}`, "com.lokalized.VectorOracle", requestPath, outPath], { encoding: "utf8" });
    if (run.status !== 0)
      throw new Error(`oracle execution failed (exit ${run.status}${run.signal ? `, signal ${run.signal}` : ""}):\n${run.stderr || "(no stderr)"}\n${run.stdout || ""}`);

    return JSON.parse(readFileSync(outPath, "utf8"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Check the oracle's output against the seed table transcribed from plan section 8.3. */
function verifySeedRows(cases, expectedById) {
  const assertions = JSON.parse(readFileSync(join(spec, "cases/seed-row-assertions.json"), "utf8"));
  const byRow = new Map(assertions.rows.map((r) => [r.seedRow, r]));
  const problems = [];
  let checked = 0;

  for (const c of cases) {
    if (c.seedRow === undefined) continue;
    const claim = byRow.get(c.seedRow);
    if (!claim) { problems.push(`case ${c.id} names seed row ${c.seedRow}, which the assertions file does not define`); continue; }
    const actual = expectedById.get(c.id);
    if (!actual) { problems.push(`case ${c.id} produced no oracle output`); continue; }
    checked++;

    const observed = {
      diagnosticSelection: actual.match?.locale ?? null,
      diagnosticType: actual.match?.matchType ?? null,
      resolvedLocale: actual.result?.resolvedLocale ?? null,
      attemptedLocales: actual.result?.attemptedLocales ?? [],
    };
    for (const field of ["diagnosticSelection", "diagnosticType", "resolvedLocale", "attemptedLocales"]) {
      if (jcs(observed[field]) !== jcs(claim[field]))
        problems.push(`seed row ${c.seedRow} (${claim.request}) ${field}: plan says ${jcs(claim[field])}, Java produced ${jcs(observed[field])}`);
    }
  }
  return { checked, problems };
}

const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;
if (!mode) {
  console.error("usage: node tools/vector-oracle/build.mjs --write | --check");
  process.exit(2);
}

const javaVersion = jdkVersion();
const fixtures = loadFixtures();
const cases = loadCases();
const oracle = runOracle(fixtures, cases);
const expectedById = new Map(oracle.results.map((r) => [r.id, r.expected]));

const seed = verifySeedRows(cases, expectedById);
if (seed.problems.length > 0) {
  console.error(JSON.stringify({ status: "seed-row-divergence", detail: "the Java oracle disagrees with the seed table published in plan section 8.3", problems: seed.problems }, null, 2));
  process.exit(1);
}

/**
 * `refusesConstruction` is a DECLARATION; here it is checked against what Java actually did.
 *
 * WHY THIS GATE EXISTS, and it is a gap a reviewer measured rather than one anyone predicted.
 * `ingest.mjs` cross-checks the flag against `constructionOverrides` in both directions (an override
 * naming a refusing arm must set it; one naming an accepting arm must not) and requires a `construct`
 * case to name the fixture. But `catalogSource:defined` is deliberately filtered OUT of that
 * comparison (`MODEL_DEPENDENT_CONSTRUCTION_OVERRIDES`), because whether a programmatic catalog is
 * refused depends on the MODEL and not on the override — so for exactly the fixtures the
 * `owed-validator` family introduced, the flag became an unchecked assertion while still buying the
 * tiebreaker-rule exemption at `ingest.mjs`. MEASURED in a sandbox before this was written: setting
 * `refusesConstruction: true` on `owed-validator-base`, which constructs, left `--write` at exit 0
 * and banked `{"constructed": true, …}` beside the flag with no gate firing anywhere.
 *
 * The oracle has now RUN, so the flag can be compared against the observation instead of against
 * another declaration. That is the same move `deliberatelyDroppedIds` and the no-counterpart claims
 * made: derive the answer, then fail on the claim that disagrees with it.
 */
{
  /** @type {Map<string, boolean[]>} */
  const constructedByFixture = new Map();
  for (const c of cases) {
    if (c.operation !== "construct") continue;
    const observed = expectedById.get(c.id)?.construct?.constructed;
    if (typeof observed !== "boolean") continue;
    if (!constructedByFixture.has(c.fixture)) constructedByFixture.set(c.fixture, []);
    /** @type {boolean[]} */ (constructedByFixture.get(c.fixture)).push(observed);
  }
  /** @type {string[]} */
  const problems = [];
  for (const [id, fixture] of Object.entries(fixtures)) {
    const observations = constructedByFixture.get(id);
    if (observations === undefined) continue;
    const declared = fixture.refusesConstruction === true;
    if (declared && observations.some((constructed) => constructed))
      problems.push(`fixture ${id} declares refusesConstruction, but Java CONSTRUCTED it in ${observations.filter(Boolean).length} of ${observations.length} construct case(s)`);
    if (!declared && observations.some((constructed) => !constructed))
      problems.push(`fixture ${id} does not declare refusesConstruction, but Java REFUSED it in ${observations.filter((c) => !c).length} of ${observations.length} construct case(s)`);
  }
  if (problems.length > 0) {
    console.error(JSON.stringify({ status: "refuses-construction-declaration-disagrees-with-java", detail: "a fixture's refusesConstruction flag contradicts the outcome the oracle recorded; the flag also buys an ingest exemption, so it may not be left unchecked", problems }, null, 2));
    process.exit(1);
  }
}

const corpus = {
  formatVersion: 1,
  behavioralVectorsVersion: "1.0.0",
  oracle: {
    implementation: "lokalized-java",
    javaVersion,
    // Ties the corpus to the exact library sources that produced it: a library change that alters
    // behavior must reissue the corpus rather than silently invalidate it.
    librarySourcesSha256: sha256(
      Buffer.from(
        jcs(readdirSync(join(javaDir, "src/main/java/com/lokalized")).sort().map((f) => ({
          path: f,
          sha256: sha256(readFileSync(join(javaDir, "src/main/java/com/lokalized", f))),
        }))),
        "utf8",
      ),
    ),
  },
  fixtures: Object.fromEntries(
    Object.entries(fixtures).map(([id, f]) => [id, { description: f.description, fallbackLocale: f.fallbackLocale, instanceLocale: f.instanceLocale ?? f.fallbackLocale, tiebreakers: f.tiebreakers ?? null, loadingOptions: f.loadingOptions ?? null, translationFailureHandler: f.translationFailureHandler ?? null, translationFallbackPolicy: f.translationFallbackPolicy ?? null, phoneticResolver: f.phoneticResolver ?? null, localeSupplier: f.localeSupplier ?? null, localeMatchSupplier: f.localeMatchSupplier ?? null, runtimeLimits: f.runtimeLimits ?? null, bidiIsolation: f.bidiIsolation ?? null, loadOnly: f.loadOnly ?? false, refusesConstruction: f.refusesConstruction ?? false, constructionOverrides: f.constructionOverrides ?? null, files: f.files ?? {}, rawFiles: f.rawFiles ?? {}, rawFilesBase64: f.rawFilesBase64 ?? {} }]),
  ),
  cases: cases.map((c) => ({ ...c, expected: expectedById.get(c.id) })),
};

const bytes = Buffer.from(jcs(corpus), "utf8");

if (mode === "write") {
  mkdirSync(dirname(ARTIFACT), { recursive: true });
  writeFileSync(ARTIFACT, bytes);
  console.log(JSON.stringify({ status: "written", cases: cases.length, fixtures: Object.keys(fixtures).length, seedRowsVerified: seed.checked, bytes: bytes.length, sha256: sha256(bytes) }));
} else {
  if (!existsSync(ARTIFACT)) { console.error(JSON.stringify({ status: "missing", detail: "run --write" })); process.exit(1); }
  if (!readFileSync(ARTIFACT).equals(bytes)) {
    const onDisk = JSON.parse(readFileSync(ARTIFACT, "utf8"));
    const drifted = corpus.cases.filter((c) => jcs(c.expected) !== jcs(onDisk.cases?.find((/** @type {any} */ o) => o.id === c.id)?.expected)).map((c) => c.id);
    console.error(JSON.stringify({ status: "stale", driftedCases: drifted, detail: "Java behavior differs from the recorded corpus; run --write and review the diff" }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "current", cases: cases.length, seedRowsVerified: seed.checked, sha256: sha256(bytes) }));
}
