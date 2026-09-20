#!/usr/bin/env node
// @ts-check
/**
 * Hold `pre-m0/selection-record.draft.json`'s digests to the files they name.
 *
 * **THE RECORD CARRIED `null` FOR TWO VALUES THAT WERE COMPUTABLE ALL ALONG**, and the parity
 * report said so in passing: it computes `profileRegistrySha256` itself "rather than copied from
 * the null". A selection record whose whole job is to pin WHICH profile and WHICH requirement set a
 * release was selected against, carrying null for both, pins nothing — while four blocking reasons
 * sat beside it implying the blockers were all human.
 *
 * Two of the four are the maintainer's (reviewer, decision owner) and stay. These two were not.
 *
 * **AND THE FIRST FILL WAS ALREADY STALE WHEN IT WAS WRITTEN.** The profile digest was computed,
 * then the profile's own claims were edited in the same change — so the record pinned the file as
 * it had been a minute earlier. That is the entire reason this gate exists rather than a one-time
 * fill: a digest recorded by hand is stale from the next edit, and nothing here re-derived it.
 *
 *   node tools/selection-record-check.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (/** @type {string} */ path) =>
  createHash("sha256").update(readFileSync(join(spec, path))).digest("hex");

const record = JSON.parse(readFileSync(join(spec, "pre-m0/selection-record.draft.json"), "utf8"));
const problems = [];

/** Each recorded digest and the file it claims to pin. */
const PINNED = [
  ["profileRegistrySha256", "pre-m0/release-profiles.draft.json"],
  ["bootstrapRequirementsSha256", "pre-m0/bootstrap.requirements.candidate.json"],
];

for (const [field, path] of PINNED) {
  const recorded = record[field];
  const live = sha256(path);
  if (recorded === null || recorded === undefined) {
    problems.push(`${field} is null, and ${path} exists and hashes to ${live.slice(0, 16)}…. ` +
      `A selection record that pins nothing is a selection nobody can reproduce.`);
  } else if (recorded !== live) {
    problems.push(`${field} records ${recorded.slice(0, 16)}… and ${path} hashes to ` +
      `${live.slice(0, 16)}…. The file moved after the digest was taken; re-record deliberately.`);
  }
}

/* The selected profile must exist in the registry the record pins. */
const registry = JSON.parse(readFileSync(join(spec, "pre-m0/release-profiles.draft.json"), "utf8"));
const selected = (registry.profiles ?? []).find((/** @type {any} */ p) => p.id === record.selectedProfileId);
if (!selected)
  problems.push(`the record selects profile ${JSON.stringify(record.selectedProfileId)}, which the ` +
    `registry it pins does not contain`);

/**
 * **THE APPROVAL FIELDS ARE NOT CHECKED FOR CONTENT, DELIBERATELY — only for consistency.** Whether
 * a human approved this is a human's act and an agent filling those fields would be forging one.
 * What IS checkable is that the record does not contradict itself: an approved status with unfilled
 * approvals, or filled approvals still carrying a human-blocking reason.
 */
const approvals = record.approvals ?? {};
const unfilled = Object.entries(approvals).filter(([, v]) => v === null).map(([k]) => k);
const humanBlockers = (record.blockingReasons ?? [])
  .filter((/** @type {string} */ r) => /human (reviewer|decision owner)/i.test(r));

if (record.status === "approved" && unfilled.length > 0)
  problems.push(`the record's status is "approved" and ${unfilled.length} approval field(s) are ` +
    `still null: ${unfilled.join(", ")}`);
if (unfilled.length === 0 && humanBlockers.length > 0)
  problems.push(`every approval field is filled and ${humanBlockers.length} human-blocking ` +
    `reason(s) remain: ${JSON.stringify(humanBlockers)}`);

if (problems.length > 0) {
  console.error(`the selection record disagrees with what it pins, ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(JSON.stringify({
  status: record.status, selectedProfileId: record.selectedProfileId,
  digestsPinned: PINNED.length, approvalsUnfilled: unfilled.length,
  humanBlockingReasons: humanBlockers.length,
}));
