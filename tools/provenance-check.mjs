/**
 * Hold `generated/IANA-PROVENANCE.md`'s checkable claims to the artifact it describes.
 *
 * **IT SHIPS AND NOTHING CHECKED IT.** `tools/data-archive.mjs` puts this document in
 * `dist/lokalized-data-<v>.tar` beside the artifact, so it is what a consumer of the data reads —
 * and its header said "806 entries, 21,338 bytes" while the artifact was 814 entries and 21,572
 * bytes. It went stale the moment M-R S11/S12 moved the artifact without touching the header, which
 * is this project's oldest documented failure mode wearing its most ordinary clothes: prose that
 * states a measurement, next to the measurement, with nothing comparing them.
 *
 * SCOPED, AND SAYING SO. This gate reads the claims that are DERIVABLE — the artifact's entry and
 * byte counts, the oracle's name, the registry File-Date, and the delta's membership. It cannot
 * check the argument the document makes, which is most of its value and most of its length; the
 * repair for a false sentence there is the same as for the README, to move the checkable part into
 * something that executes. What it does mean is that no COUNT in the header can rot again.
 *
 *   node tools/provenance-check.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docPath = join(spec, "generated/IANA-PROVENANCE.md");
const artifactPath = join(spec, "generated/iana-language-range-equivalents.json");

const doc = readFileSync(docPath, "utf8");
const artifactBytes = readFileSync(artifactPath);
const artifact = JSON.parse(artifactBytes.toString("utf8"));

const problems = [];
const entries = Object.keys(artifact.equivalents).length;
const group = (n) => n.toLocaleString("en-US");

/* 1. The header line, which is the document's statement of what the artifact IS. */
const header = /^Artifact: `generated\/iana-language-range-equivalents\.json` \(([\d,]+) entries, ([\d,]+) bytes, canonical JCS\)$/m.exec(doc);
if (header === null) {
  // ANTI-VACUITY. A reworded header must fail rather than silently retire rule 1 -- a gate whose
  // subject can be renamed out from under it is the "gate went dormant" shape S27 found.
  problems.push("the Artifact: header line is missing or no longer matches the shape this gate " +
    "reads. Restore it, or teach this rule the new shape; do not leave the counts unchecked.");
} else {
  if (header[1] !== group(entries))
    problems.push(`the header says ${header[1]} entries; the artifact has ${group(entries)}`);
  if (header[2] !== group(artifactBytes.length))
    problems.push(`the header says ${header[2]} bytes; the artifact is ${group(artifactBytes.length)}`);
}

/* 2. The delta's membership. */
//
// **MARKED, NOT GUESSED.** The first version found the enumeration by scanning prose blocks for
// "keys added" plus a backticked tag, and it accused two correct passages: one paragraph narrates
// the FOUR JDK keys (`cmn-hans`, `lv-lvs`, …) whose absence made `jdk-equivalence-keys.txt`
// necessary, and it sits in the same block as the current list. A document is allowed to discuss
// tags that are not the delta, so the canonical enumeration names itself with a marker — the same
// convention `tools/readme-blocks.mjs` uses — and everything else in the prose is free.
//
// Two rules, because they fail differently: the MARKED list must equal the artifact exactly (a tag
// added or dropped there), and every declared tag must appear SOMEWHERE in the document (a tag the
// artifact gained that the prose never mentions at all).
const TAG = /`([a-z]{2,3}(?:-[a-z0-9]{2,8})*)`/g;
const declared = [...(artifact.jdkAbsentTags ?? [])].sort();
const MARKER = "<!-- iana:delta -->";

if (artifact.source === "lokalized-java") {
  if (declared.length === 0)
    problems.push("the artifact is library-derived and declares no jdkAbsentTags; rebuild it");

  const markerAt = doc.indexOf(MARKER);
  if (markerAt === -1) {
    problems.push(`the artifact declares ${declared.length} JDK-absent tag(s) and the document ` +
      `carries no ${MARKER} enumeration. A consumer cannot tell which keys are the library's alone.`);
  } else {
    // The first NON-EMPTY paragraph after the marker: a marker on its own line is followed by a
    // blank one, and taking [0] blindly reported the enumeration as empty — a gate accusing the
    // document of the exact omission it had just been given the fix for.
    const paragraph = doc.slice(markerAt + MARKER.length)
      .split("\n\n").map((block) => block.trim()).find((block) => block.length > 0) ?? "";
    const listed = [...new Set([...paragraph.matchAll(TAG)].map((m) => m[1]))].sort();
    if (JSON.stringify(listed) !== JSON.stringify(declared))
      problems.push(`the ${MARKER} enumeration lists [${listed.join(", ")}]; ` +
        `the artifact declares [${declared.join(", ")}]`);
  }

  const unmentioned = declared.filter((tag) => !doc.includes(`\`${tag}\``));
  if (unmentioned.length > 0)
    problems.push(`the artifact declares [${unmentioned.join(", ")}] and the document never ` +
      `names ${unmentioned.length === 1 ? "it" : "them"}`);
}

/* 3. The oracle and the registry date, which the artifact records about itself. */
if (!doc.includes(`\`${artifact.source}\``))
  problems.push(`the artifact's source is "${artifact.source}" and the document never names it`);
if (artifact.ianaRegistryFileDate !== null && !doc.includes(artifact.ianaRegistryFileDate))
  problems.push(`the artifact's registry File-Date is ${artifact.ianaRegistryFileDate} and the ` +
    `document never states it`);

if (problems.length > 0) {
  console.error(`IANA-PROVENANCE.md disagrees with the artifact it describes, ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(JSON.stringify({
  status: "current", entries, bytes: artifactBytes.length,
  source: artifact.source, jdkAbsentTags: declared.length,
  deltaEnumerationChecked: artifact.source === "lokalized-java",
}));
