import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(directory, "..");
const planPath = join(projectDirectory, "IMPLEMENTATION-PLAN-v7.md");
const outputPath = join(directory, "bootstrap-worklist.json");
const inventoryPaths = ["sections-1-4.json", "sections-5-7.json", "sections-8-14.json"].map(
  (name) => join(directory, "inventory", name)
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const planBytes = readFileSync(planPath);
const planLines = planBytes.toString("utf8").split("\n");
const sourceBytesFor = (block) =>
  planLines.slice(block.lineStart - 1, block.lineEnd).join("\n");

const inventoryFiles = inventoryPaths.map((path) => {
  const bytes = readFileSync(path);
  return { path, bytes, value: JSON.parse(bytes.toString("utf8")) };
});
const blocks = inventoryFiles
  .flatMap(({ value }) => value.blocks)
  .filter(
    (block) =>
      block.disposition === "initial-registration" && block.registrationBefore.includes("M0")
  )
  .sort((left, right) => left.lineStart - right.lineStart || left.id.localeCompare(right.id))
  .map((block) => {
    const sourceText = sourceBytesFor(block);
    return {
      inventoryId: block.id,
      sourceLineStart: block.lineStart,
      sourceLineEnd: block.lineEnd,
      sourceAnchor: block.sourceAnchor,
      sourceBlockSha256: sha256(sourceText),
      sourceText,
      ownerMilestone: block.owner,
      parityClass: block.parityClass,
      registrationBefore: block.registrationBefore,
      anticipatedAtomicRecords: block.anticipatedAtomicRecords,
      atomizationStatus: "not-started"
    };
  });

const worklist = {
  formatVersion: 1,
  status: "atomization-worklist-unreviewed",
  sourcePlanSha256: sha256(planBytes),
  selectedProfileId: "strict-parity-0.x-draft",
  sourceInventories: inventoryFiles.map(({ path, bytes }) => ({
    path: path.slice(projectDirectory.length + 1),
    sha256: sha256(bytes)
  })),
  blockCount: blocks.length,
  anticipatedAtomicRecords: blocks.reduce(
    (sum, block) => sum + block.anticipatedAtomicRecords,
    0
  ),
  blocks
};
if (worklist.anticipatedAtomicRecords > 9999) {
  throw new Error(
    `M0 bootstrap projection ${worklist.anticipatedAtomicRecords} exceeds the four-digit provisional worklist ID space`
  );
}
const encoded = `${JSON.stringify(worklist, null, 2)}\n`;

if (process.argv.includes("--write")) {
  writeFileSync(outputPath, encoded);
  process.stdout.write(
    `${JSON.stringify({
      status: "written",
      path: outputPath.slice(projectDirectory.length + 1),
      sha256: sha256(encoded),
      blockCount: worklist.blockCount,
      anticipatedAtomicRecords: worklist.anticipatedAtomicRecords
    })}\n`
  );
} else if (process.argv.includes("--check")) {
  const existing = readFileSync(outputPath, "utf8");
  if (existing !== encoded) {
    process.stderr.write("bootstrap-worklist.json is stale\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `${JSON.stringify({
        status: "current",
        sha256: sha256(existing),
        blockCount: worklist.blockCount,
        anticipatedAtomicRecords: worklist.anticipatedAtomicRecords
      })}\n`
    );
  }
} else {
  process.stdout.write(encoded);
}
