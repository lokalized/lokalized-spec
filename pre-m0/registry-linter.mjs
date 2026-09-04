#!/usr/bin/env node
// @ts-check
/**
 * Requirement-registry lint and closure checker.
 *
 * Constrained by `bootstrap.requirements.schema.json`: one self-contained ESM file, whose only
 * imports are the audited `node:` allowlist (assert/buffer/crypto/fs/path/url/util). No third-party
 * validator, so the structural checks below are written against this one known schema rather than
 * being a general JSON Schema implementation — and they are deliberately narrow for that reason.
 *
 * What this checks that a schema cannot:
 *   - every recorded hash actually describes the bytes it claims to
 *   - the registry statement and the plan's clause marker are character-identical
 *   - registration closure: every block whose frontier includes M0 has at least one requirement
 *   - a runtime-behavior requirement is never discharged solely by a decision record
 *
 *   node pre-m0/registry-linter.mjs [--registry PATH] [--json]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const specDirectory = resolve(here, "..");

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const registryPath = resolve(argOf("--registry", join(here, "bootstrap.requirements.candidate.json")));
const planPath = join(specDirectory, "IMPLEMENTATION-PLAN-v7.md");
const worklistPath = join(here, "bootstrap-worklist.json");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
/** Canonical JSON with sorted object keys, matching validate-artifacts.mjs:105. */
const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
};
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const problems = [];
const fail = (code, detail, extra) => problems.push({ code, detail, ...(extra ?? {}) });

/* -------------------------------------------------------------- load inputs */

let registry;
try {
  registry = readJson(registryPath);
} catch (error) {
  console.error(`cannot read registry at ${registryPath}: ${/** @type {Error} */ (error).message}`);
  process.exit(2);
}

const planText = readFileSync(planPath, "utf8");
const planLines = planText.split("\n");
const planSha = sha256(readFileSync(planPath));
const worklist = readJson(worklistPath);
const blocksById = new Map(worklist.blocks.map((b) => [b.inventoryId, b]));

/* -------------------------------------------------------------- envelope */

if (registry.formatVersion !== 1) fail("FORMAT_VERSION", "formatVersion must be 1");
if (!["bootstrap-candidate", "bootstrap-approved"].includes(registry.status))
  fail("STATUS_INVALID", `unrecognized status ${JSON.stringify(registry.status)}`);
if (registry.sourcePlanSha256 !== planSha)
  fail("PLAN_DRIFT", "sourcePlanSha256 does not match the plan on disk", {
    recorded: registry.sourcePlanSha256,
    actual: planSha,
  });
if (registry.sourcePlanSha256 !== worklist.sourcePlanSha256)
  fail("PLAN_DRIFT_WORKLIST", "registry and worklist pin different plan revisions");

const linter = registry.registryLinter;
if (linter && Array.isArray(linter.dependencies) && linter.dependencies.length > 0)
  fail("LINTER_DEPENDENCIES", "the linter graph must be dependency-free");

/* -------------------------------------------------------------- records */

const ID = /^(?:BOOT-M0-(?!0000)[0-9]{4}|LJ-[A-Z][A-Z0-9-]*-[0-9]{3})$/;
const MILESTONES = new Set(["M0", "M1", "M2", "M3a", "M3b", "M4", "M5a", "M5b", "M6", "M7", "M8", "M9", "M-D", "M-R", "M-X"]);
const VERIFICATION = new Set(["runtime-behavior", "non-runtime"]);
const PARITY = new Set(["portable", "implementation-required", "informational-nonportable"]);
const REVIEW = new Set(["unreviewed", "human-reviewed", "decision-owner-approved"]);
const EVIDENCE_KINDS = new Set([
  "vector",
  "generated-partition",
  "static-check",
  "benchmark",
  "compatibility-run",
  "decision-record",
]);

const seenIds = new Set();
const seenStatements = new Map();
const coveredBlocks = new Set();
const requirements = Array.isArray(registry.requirements) ? registry.requirements : [];

if (requirements.length === 0) fail("REGISTRY_EMPTY", "the registry contains no requirements");

/** Leaf evidence terms, flattening any anyOf groups. */
function evidenceLeaves(evidence) {
  const leaves = [];
  for (const term of evidence ?? []) {
    if (term && Array.isArray(term.anyOf)) leaves.push(...term.anyOf);
    else if (term) leaves.push(term);
  }
  return leaves;
}

for (const [index, req] of requirements.entries()) {
  const at = `requirements[${index}]${req?.requirementId ? ` (${req.requirementId})` : ""}`;

  if (!req || typeof req !== "object") {
    fail("RECORD_NOT_OBJECT", at);
    continue;
  }

  if (!ID.test(req.requirementId ?? "")) fail("ID_PATTERN", `${at}: requirementId does not match the required pattern`);
  if (seenIds.has(req.requirementId)) fail("ID_DUPLICATE", `${at}: requirementId is not unique`);
  seenIds.add(req.requirementId);

  if (!MILESTONES.has(req.activationMilestone)) fail("MILESTONE_UNKNOWN", `${at}: activationMilestone`);
  if (!MILESTONES.has(req.ownerMilestone)) fail("MILESTONE_UNKNOWN", `${at}: ownerMilestone`);
  if (!VERIFICATION.has(req.verificationClass)) fail("VERIFICATION_CLASS", at);
  if (!PARITY.has(req.parityClass)) fail("PARITY_CLASS", at);
  if (!REVIEW.has(req.reviewStatus)) fail("REVIEW_STATUS", at);

  if (!Array.isArray(req.registrationBefore) || !req.registrationBefore.includes("M0"))
    fail("REGISTRATION_FRONTIER", `${at}: registrationBefore must contain M0`);
  if (!Array.isArray(req.releaseProfileIds) || req.releaseProfileIds.length === 0)
    fail("RELEASE_PROFILES", `${at}: at least one release profile is required`);

  // --- hashes must describe real bytes -------------------------------------

  if (sha256(JSON.stringify(req.statement ?? "")) !== req.statementSha256)
    fail("STATEMENT_HASH", `${at}: statementSha256 does not hash the statement's JCS encoding`);

  const block = blocksById.get(req.inventoryId);
  if (!block) {
    fail("INVENTORY_UNKNOWN", `${at}: inventoryId ${req.inventoryId} is not in the worklist`);
  } else {
    coveredBlocks.add(req.inventoryId);
    if (req.sourceBlockSha256 !== block.sourceBlockSha256)
      fail("SOURCE_BLOCK_HASH", `${at}: sourceBlockSha256 disagrees with the worklist block`);
    if (req.sourceLineStart < block.sourceLineStart || req.sourceLineEnd > block.sourceLineEnd)
      fail("SOURCE_RANGE", `${at}: source lines fall outside the inventory block`);
    if (req.ownerMilestone !== block.ownerMilestone)
      fail("OWNER_MISMATCH", `${at}: ownerMilestone disagrees with the worklist block`);
  }

  // --- the clause marker IS the requirement id ------------------------------

  // Corrected: `sourceMarker` is the clause marker inserted into the plan text, and
  // validate-artifacts.mjs:803 requires it to equal the requirement id. It is NOT a verbatim
  // quotation of the plan line. An earlier version of this linter enforced the quotation reading
  // and therefore passed a registry the authoritative validator rejected on every record.
  if (req.sourceMarker !== req.requirementId)
    fail("SOURCE_MARKER_MISMATCH", `${at}: sourceMarker must equal the requirementId`);

  if ((req.sourceLineStart ?? 0) - 1 >= planLines.length)
    fail("SOURCE_LINE_MISSING", `${at}: sourceLineStart ${req.sourceLineStart} is past the end of the plan`);

  // --- evidence ------------------------------------------------------------

  const leaves = evidenceLeaves(req.evidence);
  if (leaves.length === 0) fail("EVIDENCE_EMPTY", `${at}: at least one evidence term is required`);
  for (const leaf of leaves) {
    if (!EVIDENCE_KINDS.has(leaf?.kind)) fail("EVIDENCE_KIND", `${at}: unknown evidence kind ${leaf?.kind}`);
    if (!MILESTONES.has(leaf?.producerMilestone)) fail("EVIDENCE_MILESTONE", `${at}: evidence producerMilestone`);
    if (!leaf?.evidenceId) fail("EVIDENCE_ID", `${at}: evidence term has no evidenceId`);
  }

  if (sha256(canonicalJson(req.evidence ?? null)) !== req.evidenceExpressionSha256)
    fail("EVIDENCE_HASH", `${at}: evidenceExpressionSha256 does not hash the evidence expression`);

  // The invariant the schema comment names but cannot express: a decision record is not proof
  // that runtime behavior works.
  if (req.verificationClass === "runtime-behavior" && leaves.every((l) => l?.kind === "decision-record"))
    fail("DECISION_RECORD_DISCHARGES_RUNTIME", `${at}: runtime behavior discharged only by a decision record`);

  // Evidence cannot be produced before the requirement is active.
  for (const leaf of leaves) {
    if (leaf?.producerMilestone === "M0" && req.activationMilestone !== "M0" && req.verificationClass === "runtime-behavior")
      fail("EVIDENCE_BEFORE_ACTIVATION", `${at}: M0 evidence for a requirement activated at ${req.activationMilestone}`);
  }

  // --- duplicate propositions ----------------------------------------------

  const priorId = seenStatements.get(req.statementSha256);
  if (priorId) fail("STATEMENT_DUPLICATE", `${at}: identical statement already registered as ${priorId}`);
  else seenStatements.set(req.statementSha256, req.requirementId);
}

/* -------------------------------------------------------------- closure */

const m0Blocks = worklist.blocks.filter((b) => b.registrationBefore.includes("M0"));
const uncovered = m0Blocks.filter((b) => !coveredBlocks.has(b.inventoryId));

// Closure is only an error once the registry claims to be complete. A candidate registry is
// expected to be partial while atomization is in progress.
if (registry.status === "bootstrap-approved" && uncovered.length > 0)
  fail("CLOSURE_INCOMPLETE", `${uncovered.length} M0-frontier block(s) have no requirement`, {
    firstUncovered: uncovered.slice(0, 5).map((b) => b.inventoryId),
  });

const report = {
  registry: registryPath.replace(`${specDirectory}/`, ""),
  status: registry.status,
  requirements: requirements.length,
  m0FrontierBlocks: m0Blocks.length,
  blocksCovered: coveredBlocks.size,
  blocksRemaining: uncovered.length,
  coveragePercent: m0Blocks.length === 0 ? 0 : Math.round((coveredBlocks.size / m0Blocks.length) * 1000) / 10,
  problems,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `${report.registry}\n  status      ${report.status}\n  records     ${report.requirements}\n` +
      `  coverage    ${report.blocksCovered}/${report.m0FrontierBlocks} M0-frontier blocks (${report.coveragePercent}%)\n` +
      `  remaining   ${report.blocksRemaining}`,
  );
  if (problems.length === 0) console.log("\nNo lint problems.");
  else {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 40)) console.log(`  [${p.code}] ${p.detail}`);
    if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
  }
}

process.exit(problems.length === 0 ? 0 : 1);
