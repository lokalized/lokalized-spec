import { planPath as resolvePlanPath } from "../scripts/planning-path.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(directory, "..");
const planPath = resolvePlanPath();
const inventoryPaths = [
  join(directory, "inventory", "sections-1-4.json"),
  join(directory, "inventory", "sections-5-7.json"),
  join(directory, "inventory", "sections-8-14.json")
];

const fail = (message) => {
  throw new Error(message);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const planBytes = readFileSync(planPath);
const plan = planBytes.toString("utf8");
const planLines = plan.split("\n");
if (planLines.at(-1) === "") planLines.pop();
const planSha256 = sha256(planBytes);
const earlyMilestones = new Set(["M0", "M1", "M3a", "M2"]);
const milestones = new Set([
  "M0",
  "M1",
  "M2",
  "M3a",
  "M3b",
  "M4",
  "M5a",
  "M5b",
  "M6",
  "M7",
  "M8",
  "M9",
  "M-D",
  "M-R",
  "M-E",
  "M-X"
]);
const milestoneDependencies = new Map([
  ["M0", []],
  ["M1", ["M0"]],
  ["M3a", ["M0"]],
  ["M2", ["M0", "M1", "M3a"]],
  ["M3b", ["M2", "M3a"]],
  ["M4", ["M1", "M2"]],
  ["M5a", ["M2", "M3a"]],
  ["M5b", ["M2", "M3a", "M4", "M5a"]],
  ["M6", ["M2", "M3a", "M4"]],
  ["M7", ["M3b", "M4", "M5b", "M6"]],
  ["M8", ["M7"]],
  ["M9", ["M7", "M8"]],
  ["M-D", ["M8", "M9"]],
  ["M-R", ["M3a", "M3b", "M4", "M5a", "M5b", "M6", "M7", "M8", "M9", "M-D"]],
  ["M-E", ["M-R"]],
  ["M-X", []]
]);
const ancestorCache = new Map();
const ancestorsOf = (milestone) => {
  if (ancestorCache.has(milestone)) return ancestorCache.get(milestone);
  const ancestors = new Set();
  for (const dependency of milestoneDependencies.get(milestone) ?? []) {
    ancestors.add(dependency);
    for (const ancestor of ancestorsOf(dependency)) ancestors.add(ancestor);
  }
  ancestorCache.set(milestone, ancestors);
  return ancestors;
};
const dispositions = new Set(["initial-registration", "deferred", "nonnormative"]);
const parityClasses = new Set([
  "portable",
  "implementation-required",
  "informational-nonportable",
  "process-only"
]);

const sectionByLine = new Map();
let currentSection = "1";
for (let index = 0; index < planLines.length; index += 1) {
  const match = planLines[index].match(/^## ([1-9]|1[0-4])\./);
  if (match) currentSection = match[1];
  if (currentSection !== null) sectionByLine.set(index + 1, currentSection);
}

const ids = new Set();
const sourceAnchors = new Set();
const summaries = [];
const allBlocks = [];
const frontierErrors = [];

for (const path of inventoryPaths) {
  if (!existsSync(path)) fail(`Missing inventory file: ${path}`);
  const bytes = readFileSync(path);
  const inventory = JSON.parse(bytes.toString("utf8"));
  const rootKeys = Object.keys(inventory).sort().join(",");
  const expectedRootKeys = ["blocks", "formatVersion", "scope", "sourcePlanSha256", "status"].join(",");
  if (rootKeys !== expectedRootKeys) fail(`Unexpected top-level fields: ${path}`);
  if (inventory.formatVersion !== 1) fail(`Unexpected formatVersion: ${path}`);
  if (inventory.status !== "pre-m0-inventory-draft") fail(`Unexpected status: ${path}`);
  if (inventory.sourcePlanSha256 !== planSha256) fail(`Plan hash mismatch: ${path}`);
  if (!Array.isArray(inventory.scope) || inventory.scope.length === 0) fail(`Missing scope: ${path}`);
  if (new Set(inventory.scope).size !== inventory.scope.length) fail(`Duplicate scope section: ${path}`);
  if (!inventory.scope.every((section) => /^(?:[1-9]|1[0-4])$/.test(section))) {
    fail(`Invalid scope section: ${path}`);
  }
  if (!Array.isArray(inventory.blocks) || inventory.blocks.length === 0) fail(`Missing blocks: ${path}`);
  const scope = new Set(inventory.scope);
  const counts = { initial: 0, deferred: 0, nonnormative: 0, anticipatedInitialRecords: 0 };

  for (const block of inventory.blocks) {
    const keys = Object.keys(block).sort().join(",");
    const expectedKeys = [
      "anticipatedAtomicRecords",
      "disposition",
      "id",
      "lineEnd",
      "lineStart",
      "owner",
      "parityClass",
      "reason",
      "registrationBefore",
      "sourceAnchor",
      "synopsis"
    ].join(",");
    if (keys !== expectedKeys) fail(`Unexpected fields for ${block.id ?? "unknown block"}`);
    if (!/^INV-[0-9]+-[0-9]+-[0-9]{3}$/.test(block.id)) fail(`Invalid ID: ${block.id}`);
    if (ids.has(block.id)) fail(`Duplicate ID: ${block.id}`);
    ids.add(block.id);
    if (!Number.isInteger(block.lineStart) || !Number.isInteger(block.lineEnd)) {
      fail(`Non-integer line range: ${block.id}`);
    }
    if (block.lineStart < 1 || block.lineEnd < block.lineStart || block.lineEnd > planLines.length) {
      fail(`Invalid line range: ${block.id}`);
    }
    const startSection = sectionByLine.get(block.lineStart);
    const endSection = sectionByLine.get(block.lineEnd);
    if (!scope.has(startSection) || !scope.has(endSection)) fail(`Block outside scope: ${block.id}`);
    if (typeof block.sourceAnchor !== "string" || block.sourceAnchor.length === 0) {
      fail(`Missing source anchor: ${block.id}`);
    }
    if (sourceAnchors.has(block.sourceAnchor)) fail(`Duplicate source anchor: ${block.sourceAnchor}`);
    sourceAnchors.add(block.sourceAnchor);
    if (typeof block.synopsis !== "string" || block.synopsis.length === 0) {
      fail(`Missing synopsis: ${block.id}`);
    }
    if (!dispositions.has(block.disposition)) fail(`Invalid disposition: ${block.id}`);
    if (!Array.isArray(block.registrationBefore)) fail(`Invalid frontier: ${block.id}`);
    if (new Set(block.registrationBefore).size !== block.registrationBefore.length) {
      fail(`Duplicate frontier milestone: ${block.id}`);
    }
    if (!block.registrationBefore.every((milestone) => milestones.has(milestone))) {
      fail(`Unknown frontier milestone: ${block.id}`);
    }
    for (const milestone of block.registrationBefore) {
      const redundant = block.registrationBefore.find(
        (candidate) => candidate !== milestone && ancestorsOf(milestone).has(candidate)
      );
      if (redundant) {
        frontierErrors.push(
          `Non-reduced frontier for ${block.id}: ${redundant} is an ancestor of ${milestone}`
        );
      }
    }
    if (block.owner !== "none" && !milestones.has(block.owner)) {
      fail(`Unknown owner milestone: ${block.id}`);
    }
    if (
      block.owner !== "none" &&
      block.registrationBefore.some((milestone) => ancestorsOf(milestone).has(block.owner))
    ) {
      fail(`Owner milestone precedes a registration frontier: ${block.id}`);
    }
    if (!parityClasses.has(block.parityClass)) fail(`Invalid parity class: ${block.id}`);
    if (!Number.isInteger(block.anticipatedAtomicRecords) || block.anticipatedAtomicRecords < 0) {
      fail(`Invalid anticipated count: ${block.id}`);
    }
    if (typeof block.reason !== "string" || block.reason.length === 0) {
      fail(`Missing reason: ${block.id}`);
    }
    const hasEarlyFrontier = block.registrationBefore.some((milestone) => earlyMilestones.has(milestone));
    if (block.disposition === "initial-registration") {
      if (!hasEarlyFrontier) fail(`Initial block lacks early frontier: ${block.id}`);
      if (block.owner === "none") fail(`Initial block lacks owner: ${block.id}`);
      if (block.anticipatedAtomicRecords < 1) fail(`Initial block has zero anticipated records: ${block.id}`);
      counts.initial += 1;
      counts.anticipatedInitialRecords += block.anticipatedAtomicRecords;
    } else if (block.disposition === "deferred") {
      if (hasEarlyFrontier || block.registrationBefore.length === 0) {
        fail(`Deferred block has invalid frontier: ${block.id}`);
      }
      if (block.owner === "none") fail(`Deferred block lacks owner: ${block.id}`);
      if (block.anticipatedAtomicRecords < 1) fail(`Deferred block has zero anticipated records: ${block.id}`);
      counts.deferred += 1;
    } else {
      if (block.registrationBefore.length !== 0) fail(`Nonnormative block has frontier: ${block.id}`);
      if (block.owner !== "none") fail(`Nonnormative block has owner: ${block.id}`);
      if (block.anticipatedAtomicRecords !== 0) fail(`Nonnormative block has records: ${block.id}`);
      counts.nonnormative += 1;
    }
    allBlocks.push(block);
  }

  summaries.push({
    path: path.slice(projectDirectory.length + 1),
    sha256: sha256(bytes),
    scopes: inventory.scope,
    blocks: inventory.blocks.length,
    ...counts
  });
}

if (frontierErrors.length > 0) fail(frontierErrors.join("\n"));

const frontierCounts = {};
for (const block of allBlocks.filter((candidate) => candidate.disposition === "initial-registration")) {
  for (const milestone of block.registrationBefore) {
    frontierCounts[milestone] = (frontierCounts[milestone] ?? 0) + block.anticipatedAtomicRecords;
  }
}

const output = {
  status: "inventory-valid",
  planSha256,
  schemaSha256: sha256(readFileSync(join(directory, "inventory.schema.json"))),
  inventoryFiles: summaries,
  totalBlocks: allBlocks.length,
  anticipatedInitialRecords: summaries.reduce(
    (sum, summary) => sum + summary.anticipatedInitialRecords,
    0
  ),
  initialRecordFrontierMemberships: frontierCounts
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
