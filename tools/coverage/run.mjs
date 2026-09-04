#!/usr/bin/env node
// @ts-check
/**
 * M3b coverage: run the behavioral corpus through the Java oracle under JaCoCo, then emit a
 * machine-readable BRANCH report.
 *
 * "Corpus-only" is the operative word in M3b's gate. This deliberately does NOT run Java's own unit
 * tests — the question is what the SHARED CORPUS exercises, because the corpus is what every
 * implementation is held to. A branch Java's own tests cover but the corpus does not is exactly the
 * kind of gap that lets a port ship a silent defect, and two such defects were found by hand during
 * M5b in code the corpus could not discriminate.
 *
 *   node tools/coverage/run.mjs [--write]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const spec = resolve(here, "../..");
const javaDir = process.env.LOKALIZED_JAVA_DIR ? resolve(process.env.LOKALIZED_JAVA_DIR) : resolve(spec, "../lokalized-java");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";
const m2 = join(process.env.HOME ?? "", ".m2/repository");

/**
 * Compare two Maven version directory names NUMERICALLY, segment by segment.
 *
 * This existed as `.sort()` on the raw strings, and the comment above it promised "newest available".
 * A lexical sort does not deliver that: with asm 9.10.1 and 9.9.1 both installed it picks 9.9.1,
 * because "9.9.1" > "9.10.1" as text. That was harmless only by luck -- it picked the same wrong
 * version for all four asm artifacts, so the classpath stayed self-consistent -- and the standing
 * lesson about JaCoCo jar selection is precisely that a silently mis-selected jar mis-attributes
 * probes and corroborates a wrong branch conclusion.
 */
function compareVersions(left, right) {
  const parts = (v) => v.split(/[.-]/).map((piece) => (/^\d+$/.test(piece) ? Number(piece) : piece));
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); ++index) {
    const x = a[index];
    const y = b[index];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/** Every version of a Maven artifact that actually holds a usable jar, newest first. */
function jarVersions(groupPath, artifact) {
  const base = join(m2, groupPath, artifact);
  if (!existsSync(base)) throw new Error(`missing ${artifact} under ${base}`);
  return readdirSync(base)
    .filter((v) => existsSync(join(base, v))
      && readdirSync(join(base, v)).some((f) => f.endsWith(".jar") && !f.endsWith("-sources.jar")))
    .sort(compareVersions)
    .reverse();
}

/** The jar for one artifact at one exact version. */
function jarAt(groupPath, artifact, version) {
  const dir = join(m2, groupPath, artifact, version);
  const files = readdirSync(dir).filter((f) => f.endsWith(".jar") && !f.endsWith("-sources.jar"));
  if (!files.length) throw new Error(`no jar for ${artifact} ${version}`);
  return join(dir, files[0]);
}

/**
 * The newest version present for EVERY artifact in a family, so a family can never be split across
 * versions. Agent 0.8.15 with a 0.8.13 core in the reporter mis-attributes probes for two conditional
 * jumps that share a target -- it reported matchFor:1621 as permanently 3/4 no matter the input, which
 * would have corroborated a wrong "unobservable by construction" verdict. Selecting one version for
 * the whole family makes that failure unreachable rather than merely unlikely.
 */
function jarFamily(groupPath, artifacts) {
  const common = artifacts
    .map((artifact) => new Set(jarVersions(groupPath, artifact)))
    .reduce((left, right) => new Set([...left].filter((v) => right.has(v))));
  const version = [...common].sort(compareVersions).pop();
  if (!version) throw new Error(`no single version of ${artifacts.join(", ")} is installed under ${groupPath}`);
  return { version, jars: artifacts.map((artifact) => jarAt(groupPath, artifact, version)) };
}

const jacoco = jarFamily("org/jacoco", ["org.jacoco.agent", "org.jacoco.core", "org.jacoco.report"]);
const asm = jarFamily("org/ow2/asm", ["asm", "asm-commons", "asm-tree", "asm-analysis"]);
console.log(`jacoco ${jacoco.version}, asm ${asm.version}`);
const [agent, jacocoCore, jacocoReport] = jacoco.jars;
const classes = join(javaDir, "target/classes");
if (!existsSync(classes)) throw new Error(`lokalized-java is not built: ${classes}`);

const work = mkdtempSync(join(tmpdir(), "lokalized-coverage-"));
try {
  // 1. Run the oracle instrumented. build.mjs owns fixture materialization and case execution, so
  //    the coverage run is the SAME execution the corpus is recorded from, not a re-implementation.
  const exec = join(work, "jacoco.exec");
  const run = spawnSync("node", [join(spec, "tools/vector-oracle/build.mjs"), "--check"], {
    encoding: "utf8",
    env: {
      ...process.env,
      LOKALIZED_ORACLE_JDK: JDK,
      // build.mjs launches `java`; the agent rides along via JAVA_TOOL_OPTIONS so no change to the
      // oracle or the driver is needed to measure them.
      JAVA_TOOL_OPTIONS: `-javaagent:${agent}=destfile=${exec},output=file,append=false`,
    },
  });
  if (!existsSync(exec)) throw new Error(`no exec file produced\n${run.stderr ?? ""}`);

  // 2. Analyze.
  const reportClasses = join(work, "report-classes");
  mkdirSync(reportClasses, { recursive: true });
  const cp = [jacocoCore, jacocoReport, ...asm.jars].join(":");
  const compile = spawnSync(join(JDK, "bin/javac"), ["-cp", cp, "-d", reportClasses, join(here, "CoverageReport.java")], { encoding: "utf8" });
  if (compile.status !== 0) throw new Error(`report compilation failed:\n${compile.stderr}`);

  const out = join(spec, "generated/coverage-branches.json");
  const report = spawnSync(join(JDK, "bin/java"), ["-cp", `${cp}:${reportClasses}`, "CoverageReport", exec, classes, out], { encoding: "utf8" });
  if (report.status !== 0) throw new Error(`report failed:\n${report.stderr}`);
  console.log(report.stderr.trim());

  const parsed = JSON.parse(readFileSync(out, "utf8"));
  const pct = ((parsed.coveredBranches / parsed.totalBranches) * 100).toFixed(1);
  console.log(`\ncorpus-only branch coverage: ${parsed.coveredBranches}/${parsed.totalBranches} (${pct}%)`);
  console.log(`partially-covered branch points needing disposition: ${parsed.uncoveredBranchPoints}`);
  console.log(`written: generated/coverage-branches.json`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
