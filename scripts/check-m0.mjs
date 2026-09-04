#!/usr/bin/env node
// @ts-check
/**
 * The M0 engineering gate.
 *
 * Per M0-STATUS.md, M0 is tracked by these gates rather than by the pre-m0 certification ceremony.
 * This runs every gate across all three sibling repositories and prints one verdict.
 *
 * Sibling repos are resolved from the container directory, matching how lokalized.com already
 * consumes lokalized-java. A missing sibling is reported as SKIP, not as a pass.
 *
 *   node scripts/check-m0.mjs [--json]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const container = resolve(spec, "..");
const javaDir = join(container, "lokalized-java");
const jsDir = join(container, "lokalized-js");

const JAVA_HOME = process.env.JAVA_HOME ?? "/Users/agents/Java/amazon-corretto-26.jdk/Contents/Home";

/** @type {{name: string, cwd: string, cmd: string, args: string[], needs?: string}[]} */
const GATES = [
  { name: "java: test suite", cwd: javaDir, cmd: "mvn", args: ["-o", "-q", "test"], needs: javaDir },
  {
    name: "java: generated artifacts reproduce",
    cwd: javaDir,
    cmd: join(JAVA_HOME, "bin/java"),
    args: ["-cp", "target/test-classes:target/classes", "com.lokalized.cldr.CldrDataGenerator", javaDir, "--check"],
    needs: join(javaDir, "target/classes"),
  },
  { name: "js: package + declarations + tests", cwd: jsDir, cmd: "npm", args: ["run", "--silent", "verify"], needs: jsDir },
  { name: "spec: vendored snapshot", cwd: spec, cmd: "node", args: ["scripts/java-snapshot.mjs", "--check"] },
  { name: "spec: symbol allowlist", cwd: spec, cmd: "node", args: ["scripts/symbol-allowlist.mjs", "--check"] },
  { name: "spec: Java public surface", cwd: spec, cmd: "node", args: ["scripts/java-surface-audit.mjs"] },
  { name: "spec: artifact schemas + JCS", cwd: spec, cmd: "node", args: ["scripts/validate-artifacts.mjs"] },
  { name: "spec: requirement registry", cwd: spec, cmd: "node", args: ["pre-m0/registry-linter.mjs"] },
];

const results = [];
for (const gate of GATES) {
  if (gate.needs && !existsSync(gate.needs)) {
    results.push({ gate: gate.name, status: "skip", detail: `missing ${gate.needs}` });
    continue;
  }
  const run = spawnSync(gate.cmd, gate.args, {
    cwd: gate.cwd,
    encoding: "utf8",
    env: { ...process.env, JAVA_HOME, PATH: `${join(JAVA_HOME, "bin")}:${process.env.PATH}` },
  });
  const ok = run.status === 0;
  results.push({
    gate: gate.name,
    status: ok ? "pass" : "fail",
    detail: ok ? "" : (run.stderr || run.stdout || "").trim().split("\n").slice(-3).join(" | ").slice(0, 200),
  });
}

const failed = results.filter((r) => r.status === "fail");
const skipped = results.filter((r) => r.status === "skip");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ gates: results, passed: results.length - failed.length - skipped.length, failed: failed.length, skipped: skipped.length }, null, 2));
} else {
  console.log("M0 engineering gates\n");
  for (const r of results) {
    const mark = r.status === "pass" ? "  ok  " : r.status === "skip" ? " skip " : " FAIL ";
    console.log(`${mark} ${r.gate}${r.detail ? `\n         ${r.detail}` : ""}`);
  }
  console.log(
    failed.length === 0 && skipped.length === 0
      ? "\nM0 engineering gates: ALL GREEN"
      : `\n${failed.length} failed, ${skipped.length} skipped. M0 is not complete.`,
  );
  console.log("\nCertification (pre-m0/readiness.mjs) is deliberately not a gate; see M0-STATUS.md.");
}

process.exit(failed.length === 0 ? 0 : 1);
