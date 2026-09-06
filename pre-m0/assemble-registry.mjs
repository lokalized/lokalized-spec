#!/usr/bin/env node
// @ts-check
/**
 * Assembles requirements.json from atomization output.
 *
 * Division of labour: the atomizers supply SEMANTICS (statement, marker, classification, evidence);
 * this script supplies every MECHANICAL field (ids, hashes, block provenance) so those are correct
 * by construction rather than by an agent's arithmetic. It also rejects records that violate the
 * constraints the linter will later enforce, so a bad record never reaches the registry.
 *
 *   node pre-m0/assemble-registry.mjs --input atomized.json [--out pre-m0/requirements.json]
 */
import { planPath as resolvePlanPath } from "../scripts/planning-path.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const specDirectory = resolve(here, "..");

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const inputPath = resolve(argOf("--input", ""));
const outputPath = resolve(argOf("--out", join(here, "bootstrap.requirements.candidate.json")));
if (!inputPath) {
  console.error("usage: node pre-m0/assemble-registry.mjs --input atomized.json [--out PATH]");
  process.exit(2);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
/**
 * Canonical JSON, matching validate-artifacts.mjs exactly: object keys sorted, no whitespace.
 * Plain JSON.stringify preserves insertion order and produces a different hash, which is why
 * every evidence-expression hash disagreed on the first pass.
 */
const jcs = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (typeof value === "object")
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(",")}}`;
  throw new Error(`cannot canonicalize ${typeof value}`);
};

/** Milestone DAG, mirroring validate-artifacts.mjs. */
const DEPS = new Map([
  ["M0", []], ["M1", ["M0"]], ["M3a", ["M0"]], ["M2", ["M0", "M1", "M3a"]],
  ["M3b", ["M2", "M3a"]], ["M4", ["M1", "M2"]], ["M5a", ["M2", "M3a"]],
  ["M5b", ["M2", "M3a", "M4", "M5a"]], ["M6", ["M2", "M3a", "M4"]],
  ["M7", ["M3b", "M4", "M5b", "M6"]], ["M8", ["M7"]], ["M9", ["M7", "M8"]],
  ["M-D", ["M8", "M9"]],
  ["M-R", ["M3a", "M3b", "M4", "M5a", "M5b", "M6", "M7", "M8", "M9", "M-D"]],
  ["M-E", ["M-R"]], ["M-X", []],
]);
const ancestorsOf = (m, seen = new Set()) => {
  for (const d of DEPS.get(m) ?? []) if (!seen.has(d)) { seen.add(d); ancestorsOf(d, seen); }
  return seen;
};
const isAncestorOrEqual = (a, b) => a === b || ancestorsOf(b).has(a);

const planPath = resolvePlanPath();
const planLines = readFileSync(planPath, "utf8").split("\n");
const planSha = sha256(readFileSync(planPath));
const worklist = JSON.parse(readFileSync(join(here, "bootstrap-worklist.json"), "utf8"));
const blocksById = new Map(worklist.blocks.map((b) => [b.inventoryId, b]));

const MILESTONES = new Set(["M0", "M1", "M2", "M3a", "M3b", "M4", "M5a", "M5b", "M6", "M7", "M8", "M9", "M-D", "M-R", "M-X"]);
const ORDER = ["M0", "M1", "M2", "M3a", "M3b", "M4", "M5a", "M5b", "M6", "M7", "M8", "M9", "M-D", "M-R", "M-X"];

const input = JSON.parse(readFileSync(inputPath, "utf8"));
const inputBlocks = Array.isArray(input) ? input : (input.blocks ?? []);

const accepted = [];
const rejected = [];
const repaired = [];
const clamped = [];
const seenStatements = new Map();

for (const block of inputBlocks) {
  const meta = blocksById.get(block.inventoryId);
  if (!meta) {
    rejected.push({ inventoryId: block.inventoryId, reason: "unknown inventoryId" });
    continue;
  }

  for (const record of block.records ?? []) {
    const reject = (reason) =>
      rejected.push({
        inventoryId: block.inventoryId,
        statement: (record.statement ?? "").slice(0, 90),
        reason,
      });

    const line = Number(record.sourceLine);
    if (!Number.isInteger(line) || line < meta.sourceLineStart || line > meta.sourceLineEnd) {
      reject(`sourceLine ${record.sourceLine} outside block range ${meta.sourceLineStart}-${meta.sourceLineEnd}`);
      continue;
    }

    // The marker must be verbatim in the cited line. This is the check that makes a registry
    // statement traceable to the plan, and agents get it wrong by paraphrasing.
    //
    // One systematic near-miss is worth repairing rather than rejecting: the plan is hard-wrapped,
    // so a proposition can span two lines and the marker lands on the neighbour. The marker must
    // still appear VERBATIM, and only within this block's own line range, so re-pointing changes
    // the citation without weakening the check. An ambiguous marker (present on several lines) is
    // rejected, because then the citation would not identify a unique clause.
    let citedLine = line;
    const marker = record.sourceMarker;
    if (typeof marker !== "string" || marker.length === 0) {
      reject("sourceMarker missing");
      continue;
    }
    if (!(planLines[citedLine - 1] ?? "").includes(marker)) {
      const matches = [];
      for (let n = meta.sourceLineStart; n <= meta.sourceLineEnd; n++) {
        if ((planLines[n - 1] ?? "").includes(marker)) matches.push(n);
      }
      if (matches.length === 1) {
        citedLine = matches[0];
        repaired.push({ inventoryId: block.inventoryId, from: line, to: citedLine, marker });
      } else {
        reject(
          matches.length === 0
            ? `sourceMarker not a verbatim substring of any line in the block`
            : `sourceMarker is ambiguous: appears on lines ${matches.join(", ")}`,
        );
        continue;
      }
    }

    if (!record.statement || record.statement.trim().length < 8) {
      reject("statement missing or too short");
      continue;
    }
    if (!MILESTONES.has(record.activationMilestone)) {
      reject(`unknown activationMilestone ${record.activationMilestone}`);
      continue;
    }
    if (!MILESTONES.has(record.evidenceProducerMilestone)) {
      reject(`unknown evidenceProducerMilestone ${record.evidenceProducerMilestone}`);
      continue;
    }
    if (ORDER.indexOf(record.evidenceProducerMilestone) < ORDER.indexOf(record.activationMilestone)) {
      reject("evidence is produced before the requirement activates");
      continue;
    }
    if (record.verificationClass === "runtime-behavior" && record.evidenceKind === "decision-record") {
      reject("runtime behavior cannot be discharged by a decision record");
      continue;
    }

    const statement = record.statement.trim();
    const statementSha256 = sha256(jcs(statement));
    const priorId = seenStatements.get(statementSha256);
    if (priorId) {
      reject(`duplicate proposition, already registered as ${priorId}`);
      continue;
    }

    // The agent proposes a milestone; the DAG constrains it. Anything not an ancestor-or-equal of
    // the block's owner milestone is clamped to the owner, which is always valid by definition.
    const activationMilestone = isAncestorOrEqual(record.activationMilestone, meta.ownerMilestone)
      ? record.activationMilestone
      : meta.ownerMilestone;
    const producerMilestone = isAncestorOrEqual(record.evidenceProducerMilestone, meta.ownerMilestone)
      ? record.evidenceProducerMilestone
      : meta.ownerMilestone;
    if (activationMilestone !== record.activationMilestone || producerMilestone !== record.evidenceProducerMilestone)
      clamped.push({ inventoryId: block.inventoryId, owner: meta.ownerMilestone,
                     from: [record.activationMilestone, record.evidenceProducerMilestone],
                     to: [activationMilestone, producerMilestone] });

    const evidence = [
      { kind: record.evidenceKind, producerMilestone, evidenceId: record.evidenceId },
    ];

    const requirementId = `BOOT-M0-${String(accepted.length + 1).padStart(4, "0")}`;
    seenStatements.set(statementSha256, requirementId);

    accepted.push({
      requirementId,
      inventoryId: block.inventoryId,
      sourceBlockSha256: meta.sourceBlockSha256,
      statement,
      statementSha256,
      sourceAnchor: meta.sourceAnchor,
      sourceMarker: requirementId,
      sourceLineStart: citedLine,
      sourceLineEnd: citedLine,
      verificationClass: record.verificationClass,
      parityClass: meta.parityClass === "process-only" ? "implementation-required" : meta.parityClass,
      activationMilestone,
      ownerMilestone: meta.ownerMilestone,
      registrationBefore: meta.registrationBefore,
      releaseProfileIds: [worklist.selectedProfileId],
      evidence,
      evidenceExpressionSha256: sha256(jcs(evidence)),
      reviewStatus: "unreviewed",
    });
  }
}

const registry = {
  formatVersion: 1,
  status: "bootstrap-candidate",
  sourcePlanSha256: planSha,
  selectedProfileId: worklist.selectedProfileId,
  markerSchema: null,
  markerArtifact: null,
  registryLinter: {
    entrypoint: {
      path: "registry-linter.mjs",
      sha256: sha256(readFileSync(join(here, "registry-linter.mjs"))),
    },
    dependencies: [],
  },
  requirements: accepted,
};

writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);

const covered = new Set(accepted.map((r) => r.inventoryId));
const m0Blocks = worklist.blocks.filter((b) => b.registrationBefore.includes("M0"));
const byReason = {};
for (const r of rejected) {
  const key = r.reason.replace(/\d+/g, "N").slice(0, 60);
  byReason[key] = (byReason[key] ?? 0) + 1;
}

console.log(
  JSON.stringify(
    {
      accepted: accepted.length,
      rejected: rejected.length,
      repairedLineCitations: repaired.length,
      clampedMilestones: clamped.length,
      blocksCovered: covered.size,
      m0FrontierBlocks: m0Blocks.length,
      uncoveredBlocks: m0Blocks.filter((b) => !covered.has(b.inventoryId)).length,
      rejectionsByReason: byReason,
    },
    null,
    2,
  ),
);

if (rejected.length > 0) {
  writeFileSync(join(here, "assembly-rejects.json"), `${JSON.stringify(rejected, null, 2)}\n`);
  console.log(`\nrejected records written to pre-m0/assembly-rejects.json`);
}
