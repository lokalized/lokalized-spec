import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const planPath = join(directory, "..", "IMPLEMENTATION-PLAN-v7.md");
const registryPath = join(directory, "requirements.scratch.json");
const schemaPath = join(directory, "requirements.scratch.schema.json");
const annotatedPath = join(directory, "section-2.2.annotated.md");

const bytes = (path) => readFileSync(path);
const text = (path) => readFileSync(path, "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => {
  throw new Error(message);
};

const plan = text(planPath);
const start = plan.indexOf("### 2.2 Fallback chain and tiebreakers");
const end = plan.indexOf("### 2.3 Evaluation locale and catalog merging", start);
if (start < 0 || end < 0) fail("Cannot isolate plan section 2.2");
const section = plan.slice(start, end);

const registry = JSON.parse(text(registryPath));
if (registry.formatVersion !== 1) fail("Unexpected formatVersion");
if (registry.status !== "calibration-only") fail("Scratch status is not calibration-only");
if (registry.sourceSectionSha256 !== sha256(section)) fail("Section 2.2 hash mismatch");
if (!Array.isArray(registry.requirements) || registry.requirements.length === 0) fail("No records");

const milestonePattern = /^(?:M0|M1|M2|M3a|M3b|M4|M5a|M5b|M6|M7|M8|M9|M-D|M-R|M-E|M-X)$/;
const idPattern = /^CAL-[A-Z][A-Z0-9-]*-[0-9]{3}$/;
const anchorPattern = /^2\.2:L[0-9]+(?:-L[0-9]+)?$/;
const evidenceKinds = new Set([
  "benchmark",
  "compatibility-run",
  "generated-partition",
  "static-check",
  "vector"
]);
const parityClasses = new Set([
  "portable",
  "implementation-required",
  "informational-nonportable"
]);
const ids = new Set();

for (const record of registry.requirements) {
  const keys = Object.keys(record).sort().join(",");
  const expected = [
    "evidenceKinds",
    "id",
    "owner",
    "parityClass",
    "registrationBefore",
    "sourceAnchor",
    "statement"
  ].join(",");
  if (keys !== expected) fail(`Unexpected fields for ${record.id ?? "unknown record"}`);
  if (!idPattern.test(record.id)) fail(`Invalid ID: ${record.id}`);
  if (ids.has(record.id)) fail(`Duplicate ID: ${record.id}`);
  ids.add(record.id);
  if (typeof record.statement !== "string" || record.statement.length === 0) {
    fail(`Empty statement: ${record.id}`);
  }
  if (!Array.isArray(record.registrationBefore) || record.registrationBefore.length === 0) {
    fail(`Missing registration frontier: ${record.id}`);
  }
  if (new Set(record.registrationBefore).size !== record.registrationBefore.length) {
    fail(`Duplicate registration frontier member: ${record.id}`);
  }
  if (!record.registrationBefore.every((value) => milestonePattern.test(value))) {
    fail(`Invalid registration frontier: ${record.id}`);
  }
  if (!milestonePattern.test(record.owner)) fail(`Invalid owner: ${record.id}`);
  if (!parityClasses.has(record.parityClass)) fail(`Invalid parity class: ${record.id}`);
  if (!Array.isArray(record.evidenceKinds) || record.evidenceKinds.length === 0) {
    fail(`Missing evidence kinds: ${record.id}`);
  }
  if (!record.evidenceKinds.every((value) => evidenceKinds.has(value))) {
    fail(`Invalid evidence kind: ${record.id}`);
  }
  if (!anchorPattern.test(record.sourceAnchor)) fail(`Invalid source anchor: ${record.id}`);
}

const annotated = text(annotatedPath);
const annotatedStatements = new Map(
  [...annotated.matchAll(/<!-- CAL:(CAL-[A-Z0-9-]+) -->\n([^\n]+)/g)].map((match) => [
    match[1],
    match[2]
  ])
);
for (const id of ids) {
  const marker = `<!-- CAL:${id} -->`;
  if (annotated.split(marker).length !== 2) fail(`Expected one annotated marker for ${id}`);
  const record = registry.requirements.find((candidate) => candidate.id === id);
  if (annotatedStatements.get(id) !== record.statement) {
    fail(`Annotated statement mismatch for ${id}`);
  }
}
const markerIds = [...annotated.matchAll(/<!-- CAL:(CAL-[A-Z0-9-]+) -->/g)].map((match) => match[1]);
if (markerIds.length !== ids.size) fail("Annotated CAL marker count differs from registry");
if (markerIds.some((id) => !ids.has(id))) fail("Annotated file contains an unknown CAL marker");

const nonnormativeMarkers = [...annotated.matchAll(/<!-- NONNORMATIVE:(NN-[0-9]{3}) reviewed -->/g)];
if (nonnormativeMarkers.length !== 6) fail("Expected exactly six NONNORMATIVE markers");

const outputs = {
  records: registry.requirements.length,
  nonnormativeMarkers: nonnormativeMarkers.length,
  planSha256: sha256(bytes(planPath)),
  sectionSha256: sha256(section),
  schemaSha256: sha256(bytes(schemaPath)),
  registrySha256: sha256(bytes(registryPath)),
  annotatedSectionSha256: sha256(bytes(annotatedPath)),
  validatorSha256: sha256(bytes(fileURLToPath(import.meta.url)))
};

process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
