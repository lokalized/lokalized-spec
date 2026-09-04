import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Compatibility entry point. Keep one authoritative readiness implementation so
// bootstrap provenance, calibration binding, capacity, and approval gates cannot
// drift between two validators.
const directory = dirname(fileURLToPath(import.meta.url));
const validatorPath = join(directory, "validate-artifacts.mjs");
const requestedArguments = process.argv.slice(2);
const reportOnly = requestedArguments.includes("--report-only");
const forwardedArguments = requestedArguments.filter((argument) => argument !== "--report-only");
if (!reportOnly && !forwardedArguments.includes("--assert-ready")) {
  forwardedArguments.push("--assert-ready");
}
const result = spawnSync(process.execPath, [validatorPath, ...forwardedArguments], {
  cwd: join(directory, ".."),
  encoding: "utf8"
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
