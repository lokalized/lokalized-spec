import { planPath as resolvePlanPath } from "../scripts/planning-path.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(directory, "..");
const planLines = readFileSync(resolvePlanPath(), "utf8").split(
  "\n"
);
if (planLines.at(-1) === "") planLines.pop();
const inventoryFiles = ["sections-1-4.json", "sections-5-7.json", "sections-8-14.json"];
const blocks = inventoryFiles.flatMap(
  (name) => JSON.parse(readFileSync(join(directory, "inventory", name), "utf8")).blocks
);

const coverage = new Map();
for (const block of blocks) {
  for (let line = block.lineStart; line <= block.lineEnd; line += 1) {
    const entries = coverage.get(line) ?? [];
    entries.push({
      id: block.id,
      disposition: block.disposition,
      anticipatedAtomicRecords: block.anticipatedAtomicRecords
    });
    coverage.set(line, entries);
  }
}

// This deliberately over-selects. It is a review aid, not a semantic completeness proof.
const normativeSignal =
  /\b(?:must|shall|required?|requires?|rejects?|cannot|never|only|exactly|before|after|permits?|forbids?|blocks?|gates?|includes?|contains?|records?|checks?|validates?)\b/i;
const headingOrFence = /^(?:\s*$|#{1,6}\s|[-+:~`]{3,})/;
const tableDelimiter = /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/;
const uncoveredSignals = [];
const nonnormativeOnlySignals = [];
const overlaps = [];

for (let index = 0; index < planLines.length; index += 1) {
  const lineNumber = index + 1;
  const text = planLines[index];
  const entries = coverage.get(lineNumber) ?? [];
  if (entries.length > 1) overlaps.push({ line: lineNumber, text, blocks: entries });
  if (!normativeSignal.test(text) || headingOrFence.test(text) || tableDelimiter.test(text)) continue;
  if (entries.length === 0) uncoveredSignals.push({ line: lineNumber, text });
  else if (entries.every((entry) => entry.disposition === "nonnormative")) {
    nonnormativeOnlySignals.push({ line: lineNumber, text, blocks: entries });
  }
}

const exactRangeDuplicates = Object.values(
  blocks.reduce((groups, block) => {
    const key = `${block.lineStart}:${block.lineEnd}`;
    (groups[key] ??= []).push(block);
    return groups;
  }, {})
)
  .filter((group) => group.length > 1)
  .map((group) => ({
    range: [group[0].lineStart, group[0].lineEnd],
    blocks: group.map(({ id, disposition, anticipatedAtomicRecords }) => ({
      id,
      disposition,
      anticipatedAtomicRecords
    }))
  }));

process.stdout.write(
  `${JSON.stringify(
    {
      status: "heuristic-review-only",
      note: "A clean result is not a completeness proof; every hit requires human review.",
      planLines: planLines.length,
      inventoryBlocks: blocks.length,
      uncoveredSignals,
      nonnormativeOnlySignals,
      exactRangeDuplicates,
      overlapLineCount: overlaps.length,
      overlaps
    },
    null,
    2
  )}\n`
);
