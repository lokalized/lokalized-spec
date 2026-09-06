/**
 * Where the INTERNAL planning material lives.
 *
 * `IMPLEMENTATION-PLAN-v7.md` and the `M*-STATUS.md` documents are working material, not published
 * artifacts, so they sit outside every checkout beside `planning-archive/` — the same reasoning that
 * keeps `CLAUDE.md` out of the repos.
 *
 * The plan is nevertheless a REAL INPUT to this repository's tooling: eight scripts parse it and
 * `pre-m0/CHECKSUMS.sha256` pins its digest. Its absence must therefore fail loudly with the remedy,
 * never skip — a gate that quietly passes when its input is missing has stopped gating, and this repo
 * has already had one gate report a result nothing consumed.
 *
 * Override with `LOKALIZED_PLANNING_DIR`, mirroring the existing `LOKALIZED_JAVA_DIR` and
 * `LOKALIZED_ORACLE_JDK` conventions.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const specDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const planningDirectory = process.env.LOKALIZED_PLANNING_DIR
  ? resolve(process.env.LOKALIZED_PLANNING_DIR)
  : resolve(specDirectory, "../planning");

/** Absolute path to the plan, or a loud exit naming the remedy. */
export function planPath() {
  const path = join(planningDirectory, "IMPLEMENTATION-PLAN-v7.md");
  if (!existsSync(path)) {
    console.error(`plan not found at ${path}\n`
      + `  IMPLEMENTATION-PLAN-v7.md is internal working material and is not committed to this\n`
      + `  repository. Point LOKALIZED_PLANNING_DIR at the directory holding it.`);
    process.exit(2);
  }
  return path;
}
