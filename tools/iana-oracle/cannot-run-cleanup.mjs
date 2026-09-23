#!/usr/bin/env node
// @ts-check
/**
 * THE JDK CHECK MUST NOT LEAK ITS WORK DIRECTORY WHEN IT STOPS AS "cannot run".
 *
 * `build.mjs` makes a `lokalized-iana-check-*` directory under the system temp folder and removes it in
 * a `finally`. Three of its `cannotRun` calls sit INSIDE that `try` — a probe that does not compile, a
 * dump that fails, a parse that fails — and `process.exit` does not run `finally`, so each one left the
 * directory behind: measured, a compile failure moved the count from 1 to 2, and a 1 MB directory from
 * an earlier run was still in the temp folder. It is the class of the 2.0 GB conformance temp-dir leak.
 *
 * This forces each of the three, with NO JDK and NO lokalized-java: a fake JDK (two `sh` scripts) that
 * answers `-version` as 21 and then fails at the step under test, a fake lokalized-java directory
 * holding just the files `build.mjs` looks for before it makes the directory, and a PRIVATE `TMPDIR`
 * so the count is of this run's directories and nothing else on the machine. For each arm it requires:
 *
 *   - exit 2 with status `cannot-run` and the detail THAT ARM forces — so the stop really came from
 *     inside the `try`, after the directory was made, and not from an earlier guard;
 *   - a WITNESS: the fake `javac` records the `-d` path it was handed, which lies inside the work
 *     directory, so the directory is proven to have EXISTED during the run (a counter that could never
 *     see one would pass every arm vacuously);
 *   - zero `lokalized-iana-check-*` entries in the private temp folder afterwards.
 *
 * It removes its own scaffolding in a `finally` it never exits past.
 *
 *   node tools/iana-oracle/cannot-run-cleanup.mjs
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BUILD = join(here, "build.mjs");
const PREFIX = "lokalized-iana-check-";

/** What the fake `bin/java` does once `-version` has been answered. */
const ARMS = [
  { name: "compile", javac: "fail", java: "unused", detail: /IanaCheckProbe did not compile/ },
  { name: "dump", javac: "ok", java: "fail-dump", detail: /IanaCheckProbe dump failed/ },
  { name: "parse", javac: "ok", java: "fail-parse", detail: /IanaCheckProbe parse failed/ },
];

/** A dump with nothing in it: enough for build.mjs to reach the parse step and no further. */
const EMPTY_DUMP = JSON.stringify({ library: { languageEquivalents: {} }, jdk: { singleEquivKeys: [], multiEquivsKeys: [] } });

/** @param {string} path @param {string} text */
const script = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };

/** @type {string[]} */
const problems = [];
const scaffold = mkdtempSync(join(tmpdir(), "lokalized-iana-cleanup-check-"));
try {
  // The fake lokalized-java: build.mjs checks for these two class files and reads the version out of
  // pom.xml and the source digest out of src/main/java/com/lokalized BEFORE it makes its directory.
  const javaDir = join(scaffold, "lokalized-java");
  mkdirSync(join(javaDir, "target/classes/com/lokalized"), { recursive: true });
  for (const file of ["IanaLanguageEquivalents.class", "LanguageRangeEquivalents.class"])
    writeFileSync(join(javaDir, "target/classes/com/lokalized", file), "");
  mkdirSync(join(javaDir, "src/main/java/com/lokalized"), { recursive: true });
  writeFileSync(join(javaDir, "pom.xml"), "<project><artifactId>lokalized</artifactId><version>0.0.0-cleanup-check</version></project>\n");

  for (const arm of ARMS) {
    const armDir = join(scaffold, arm.name);
    const jdk = join(armDir, "jdk");
    const privateTmp = join(armDir, "tmp");
    const witness = join(armDir, "witness.txt");
    mkdirSync(join(jdk, "bin"), { recursive: true });
    mkdirSync(privateTmp, { recursive: true });

    // javac: record the -d directory, then fail or succeed.
    script(join(jdk, "bin/javac"), [
      "#!/bin/sh",
      "previous=''",
      `for argument in "$@"; do [ "$previous" = "-d" ] && printf '%s' "$argument" > '${witness}'; previous="$argument"; done`,
      arm.javac === "fail" ? "echo 'forced compile failure (cannot-run-cleanup.mjs)' 1>&2; exit 1" : "exit 0",
      "",
    ].join("\n"));
    // java: answer -version as JDK 21; otherwise fail at the step under test.
    script(join(jdk, "bin/java"), [
      "#!/bin/sh",
      `if [ "$1" = "-version" ]; then echo 'openjdk version "21.0.0" 2099-01-01' 1>&2; exit 0; fi`,
      "step=''; target=''; previous=''",
      `for argument in "$@"; do case "$argument" in dump|parse) step="$argument";; esac; [ "$previous" = "dump" ] && target="$argument"; previous="$argument"; done`,
      arm.java === "fail-dump" ? `[ "$step" = "dump" ] && { echo 'forced dump failure' 1>&2; exit 3; }` : "",
      arm.java === "fail-parse" ? `[ "$step" = "dump" ] && { printf '%s' '${EMPTY_DUMP}' > "$target"; exit 0; }` : "",
      arm.java === "fail-parse" ? `[ "$step" = "parse" ] && { echo 'forced parse failure' 1>&2; exit 3; }` : "",
      "echo 'unexpected invocation' 1>&2; exit 9",
      "",
    ].join("\n"));

    const run = spawnSync(process.execPath, [BUILD, "--check"], {
      encoding: "utf8",
      env: { ...process.env, LOKALIZED_ORACLE_JDK: jdk, LOKALIZED_JAVA_DIR: javaDir, TMPDIR: privateTmp, TMP: privateTmp, TEMP: privateTmp },
    });
    /** @type {any} */
    let report = null;
    try { report = JSON.parse(run.stderr); } catch { /* reported below */ }

    if (run.status !== 2 || report?.status !== "cannot-run" || !arm.detail.test(String(report?.detail)))
      problems.push(`arm ${arm.name}: build.mjs exited ${run.status} with ${JSON.stringify(report?.status ?? run.stderr.slice(0, 300))}${report ? `: ${String(report.detail).split("\n")[0]}` : ""}; the forced stop did not happen where this arm forces it, so nothing below is evidence`);

    const witnessed = existsSync(witness) ? readFileSync(witness, "utf8") : null;
    const workDirectory = witnessed === null ? null : dirname(witnessed);
    if (workDirectory === null || dirname(workDirectory) !== resolve(privateTmp) || !basename(workDirectory).startsWith(PREFIX))
      problems.push(`arm ${arm.name}: no work directory was witnessed inside the private temp folder (javac saw -d ${JSON.stringify(witnessed)}); the count below could not have seen a leak`);

    const left = readdirSync(privateTmp).filter((entry) => entry.startsWith(PREFIX));
    if (left.length > 0)
      problems.push(`arm ${arm.name}: build.mjs stopped as cannot-run and left ${left.length} work director${left.length === 1 ? "y" : "ies"} behind (${left.join(", ")}); process.exit skips finally, so cannotRun must remove it`);
    else if (workDirectory !== null && existsSync(workDirectory))
      problems.push(`arm ${arm.name}: the witnessed work directory ${workDirectory} still exists`);
  }
} finally {
  rmSync(scaffold, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(JSON.stringify({ status: "leaks", problems }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: "clean", arms: ARMS.map(({ name }) => name), detail: "each forced cannot-run inside build.mjs's try removed its work directory" }));
