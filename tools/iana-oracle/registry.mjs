#!/usr/bin/env node
// @ts-check
/**
 * THE PINNED IANA LANGUAGE SUBTAG REGISTRY, AND WHERE THE JDK DISAGREES WITH IT.
 *
 * Plan §5.1 specifies deriving the language-range equivalence closure from a pinned registry
 * snapshot and adding explicit JDK-compatibility override rows wherever the snapshot and the JDK
 * disagree. `tools/iana-oracle/build.mjs` deliberately did not do that: it derives from the JDK
 * directly, because the artifact exists so the JS negotiator reproduces lokalized-java, and
 * deriving from the oracle makes divergence structurally impossible. `IANA-PROVENANCE.md` records
 * that choice and its cost — **`ianaRegistryFileDate` is null; the artifact is pinned to a JDK
 * build rather than to a registry release** — and says the registry route "would require the
 * registry snapshot this build deliberately does not fetch".
 *
 * **THE MAINTAINER ASKED FOR THAT SNAPSHOT, so this file supplies the other half without changing
 * what the port does.** The behaviour stays the JDK's, because parity with lokalized-java is the
 * product. What changes is that the artifact now has REGISTRY PROVENANCE: a real `File-Date`, a
 * pinned byte digest, and a derived override table that says exactly where the two disagree.
 *
 * **THE OVERRIDE TABLE IS VERIFIED BY RECONSTRUCTION, not by inspection.** Applying it to the
 * registry-derived closure must reproduce the JDK closure BYTE-IDENTICALLY. That makes the table
 * exactly the set of differences — it cannot be short (the reconstruction would differ) and it
 * cannot be padded (an override that changes nothing is reported).
 *
 *   node tools/iana-oracle/registry.mjs            derive and CHECK
 *   node tools/iana-oracle/registry.mjs --write    re-record
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = resolve(here, "../..");
const SNAPSHOT = join(here, "language-subtag-registry.txt");
const SHIPPED_ARTIFACT = join(specRoot, "generated/iana-language-range-equivalents.json");
const OUTPUT = join(specRoot, "generated/iana-registry-overrides.json");

const problems = [];
const bytes = readFileSync(SNAPSHOT);
const text = bytes.toString("utf8");

const fileDate = /^File-Date:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(text)?.[1] ?? null;
if (!fileDate) { console.error("the pinned snapshot carries no File-Date header"); process.exit(2); }

/** record-jar: `%%`-separated records, `Name: value` fields, continuations indented. */
const records = text.split(/\n%%\n/).slice(1).map((block) => {
  /** @type {Record<string, string[]>} */ const record = {};
  let key = null;
  for (const line of block.split("\n")) {
    const field = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (field) { key = field[1]; (record[key] ??= []).push(field[2]); }
    else if (key && /^\s+\S/.test(line)) record[key][record[key].length - 1] += ` ${line.trim()}`;
  }
  return record;
});
const one = (/** @type {Record<string,string[]>} */ r, /** @type {string} */ k) => r[k]?.[0];

/**
 * The registry's own equivalences, as union-find classes.
 *
 * TWO SOURCES, both from the registry text and neither invented: a record carrying a
 * `Preferred-Value` is equivalent to that value, and an `extlang` record is equivalent to its
 * `Prefix`-qualified form (RFC 5646 §2.2.2 — `ar-aao` and `aao` name the same thing).
 */
const pairs = [];
/** @type {Array<{ from: string, to: string, type: string }>} */
const regionVariantPairs = [];
for (const record of records) {
  const type = one(record, "Type");
  const subtag = one(record, "Subtag") ?? one(record, "Tag");
  if (!subtag) continue;
  const preferred = one(record, "Preferred-Value");
  if (preferred) {
    // **TYPE DISCRIMINATION, AND THE FIRST VERSION OF THIS FILE DID NOT DO IT.** Running union-find
    // over every `Preferred-Value` regardless of record type flattened six REGION records
    // (DD->DE, FX->FR, BU->MM, ZR->CD, TP->TL, YD->YE) and one VARIANT record (heploc->alalc97)
    // into the same namespace as languages, and emitted them as bare keys — so the derived closure
    // claimed `de` is equivalent to `dd`. That is not a keying nuance, it is wrong: `de` is German,
    // and a bare row would expand the range `de` to `dd` and `de-CH` to `dd-CH`, where the JDK
    // expands neither. The JDK keeps exactly these fourteen in a SEPARATE map whose keys all carry
    // a leading hyphen (`LocaleEquivalentMaps.regionVariantEquivMap`), which is what confines them
    // to non-initial subtag positions. They are kept apart here for the same reason.
    if (type === "region" || type === "variant")
      regionVariantPairs.push({ from: subtag.toLowerCase(), to: preferred.toLowerCase(), type: /** @type {string} */ (type) });
    else pairs.push([subtag.toLowerCase(), preferred.toLowerCase()]);
  }
  if (type === "extlang") {
    const prefix = one(record, "Prefix");
    if (prefix) pairs.push([subtag.toLowerCase(), `${prefix}-${subtag}`.toLowerCase()]);
  }
}

/** @type {Map<string,string>} */ const parent = new Map();
const find = (/** @type {string} */ x) => {
  if (!parent.has(x)) parent.set(x, x);
  while (parent.get(x) !== x) { parent.set(x, /** @type {string} */ (parent.get(/** @type {string} */ (parent.get(x))))); x = /** @type {string} */ (parent.get(x)); }
  return x;
};
for (const [a, b] of pairs) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }

/** @type {Map<string,string[]>} */ const grouped = new Map();
for (const key of parent.keys()) {
  const root = find(key);
  if (!grouped.has(root)) grouped.set(root, []);
  /** @type {string[]} */ (grouped.get(root)).push(key);
}
/** @type {Record<string,string[]>} */ const registryClosure = {};
for (const members of grouped.values()) {
  const sorted = [...new Set(members)].sort();
  for (const member of sorted) registryClosure[member] = [member, ...sorted.filter((m) => m !== member)];
}

/* ------------------------------------------- the overrides, defined as the difference, and checked */
const jdkArtifact = JSON.parse(readFileSync(SHIPPED_ARTIFACT, "utf8"));
const shipped = jdkArtifact.equivalents;

/** @type {Array<{ key: string, kind: string, registry: string[] | null, shipped: string[] | null }>} */
const overrides = [];
for (const key of new Set([...Object.keys(registryClosure), ...Object.keys(shipped)])) {
  const fromRegistry = registryClosure[key] ?? null;
  const fromShipped = shipped[key] ?? null;
  if (JSON.stringify(fromRegistry) === JSON.stringify(fromShipped)) continue;
  overrides.push({
    key,
    kind: fromShipped === null ? "registry-only" : fromRegistry === null ? "jdk-only"
      : [...fromRegistry].sort().join() === [...fromShipped].sort().join() ? "order-only" : "membership",
    registry: fromRegistry, shipped: fromShipped,
  });
}
overrides.sort((a, b) => a.key.localeCompare(b.key));

// **RECONSTRUCTION IS THE PROOF.** Apply every override to the registry closure and the result must
// be the shipped artifact exactly. A missing override leaves a difference; a redundant one is caught by
// the redundancy term below. Neither can be argued with.
const reconstructed = { ...registryClosure };
for (const row of overrides) { if (row.shipped === null) delete reconstructed[row.key]; else reconstructed[row.key] = row.shipped; }
const canon = (/** @type {Record<string,string[]>} */ o) =>
  JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
if (canon(reconstructed) !== canon(shipped))
  problems.push("registry closure + overrides does not reproduce the JDK artifact — the override " +
    "table is not the complete set of differences, which is the one thing it has to be");
for (const row of overrides)
  if (JSON.stringify(row.registry) === JSON.stringify(row.shipped))
    problems.push(`override '${row.key}' changes nothing`);

/**
 * WHY EACH FAMILY OF OVERRIDES EXISTS, measured against the JDK's own source rather than inferred.
 *
 * **THE COMPARISON TARGET IS THE SHIPPED CLOSURE, NOT THE JDK'S, AND THE NAMES DELIBERATELY STILL
 * SAY `jdk-only`.** Since lokalized-java 3.1.0 the pinned artifact is derived by probing the
 * LIBRARY, so this file compares registry-against-shipped; the bindings and the printed label were
 * renamed to say so, after they spent a slice reporting "JDK closure 818" when the JDK's own is
 * 806. The family KINDS keep their names because they describe where a divergence ORIGINATES —
 * `jdk-only` rows are `getEquivalentForRegionAndVariant` artifacts of the JDK's parse that the
 * library's generated table inherits verbatim — and renaming those would claim the library invented
 * them.
 *
 * A table of 130 rows with no account of them is a list, not an explanation, and the first
 * question anyone asks of a divergence table is "which of these is a bug". None of them is. Two
 * independent investigations read `LocaleEquivalentMaps.java` and `LocaleMatcher.java` out of each
 * JDK's own `src.zip`, reproduced the closure with a JS port of `parse`, and placed every row —
 * zero unexplained, and the arithmetic closes.
 *
 * The `count` fields are ASSERTED against the derived table below, so a family that stops matching
 * fails rather than going stale.
 */
const FAMILIES = [
  { kind: "jdk-only", count: 37,
    what: "`<prefix>-de|fr|tl`, plus `sw-cd`, `und-alalc97` and `und-hepburn-heploc`",
    why: "`LocaleMatcher.getEquivalentForRegionAndVariant` substitutes a trailing region or variant " +
      "by raw substring against a 14-entry map whose keys ALL begin with a hyphen, so it fires on " +
      "`ar-de` and never on bare `de`. These rows are not registry content: the closure is built by " +
      "exhaustive probe, so wherever the probe space happened to pair a language with `-de`, `-fr`, " +
      "`-tl` or `-cd`, a standalone key appeared. 34 come from 12 macrolanguage prefixes x 3 tails " +
      "minus `sgn-de`/`sgn-fr`, which are registered IANA redundant tags and so exist on both sides.",
    consumerVisible: "constantly, not exotically: `parse(\"de-DE\")` returns `[de-de, de-dd]`" },
  { kind: "registry-only", count: 0,
    what: "registry equivalences the pinned closure cannot express",
    why: "WAS TWELVE, THEN FOUR, AND IS NOW ZERO — and the four were never inexpressible, which is " +
      "what this entry used to say. The eight `bh`/`bih`/`enm`/`mgp`/`mrd`/`mrh`/`shl`/`yol` " +
      "stopped being divergences the day lokalized-java 3.1.0 learned them. The last four — " +
      "`dyl`/`sgn-dyl` and `zhk`/`sgn-zhk` — were recorded here as something 'no closure keyed on " +
      "parse output can express', on the reasoning that `Locale#forLanguageTag` canonicalizes " +
      "`sgn-dyl` to `dyl`. **MEASURED AND FALSE: `IanaLanguageEquivalents.parse(\"dyl\")` answers " +
      "`[dyl, sgn-dyl]` and `parse(\"sgn-dyl\")` answers `[sgn-dyl, dyl]`.** They were simply never " +
      "PROBED: the candidate space was seeded from the JDK's equivalence keys, and these four are " +
      "the library's alone. `LibraryEquivalenceKeys` seeds from the oracle's own table now and the " +
      "closure carries all four (814 -> 818 entries). The family is kept at zero rather than " +
      "deleted because the count is the record of the repair.",
    consumerVisible: "no rows remain" },
  { kind: "membership", count: 12,
    what: "sign-language classes that gain a deprecated-region twin",
    why: "The same region substitution arriving one level deeper: `parse` runs it not only on the " +
      "input range but on every language equivalent it produces, synthesising `sgn-dd`, `sgn-fx`, " +
      "`sgn-be-fx` and `sgn-ch-dd`. `sgn-DD` and `sgn-FX` appear in ZERO registry records — the " +
      "JDK is composing two deprecations in six of the rows and textually mangling a grandfathered " +
      "tag in the other six.",
    consumerVisible: "only for a range naming a deprecated region beside a sign language" },
  { kind: "order-only", count: 81,
    what: "same membership, different sequence",
    why: "Nothing in the registry determines an order. The JDK's is `parse`'s insertion sequence — " +
      "the input is element 0 and each derived range is spliced at index+1 — which a union-find " +
      "cannot reproduce. Only 123 of the 806 classes have three or more members, so most classes " +
      "cannot differ at all.",
    consumerVisible: "YES, and it is gated: reversing the non-member order takes conformance from " +
      "2,150/0 to 2,128/22 and reds 4 tests. Every one of the 22 differs ONLY in the echoed " +
      "`requestedLanguageRanges` — the SELECTED locale is identical in all of them — so order is a " +
      "compared public output, not a catalog-selection input." },
];

for (const family of FAMILIES) {
  const actual = overrides.filter((row) => row.kind === family.kind).length;
  if (actual !== family.count)
    problems.push(`the '${family.kind}' family is recorded as ${family.count} row(s) and the table ` +
      `holds ${actual} — the explanation has drifted from the data it explains`);
}
const explained = FAMILIES.reduce((sum, f) => sum + f.count, 0);
if (explained !== overrides.length)
  problems.push(`${overrides.length} override(s) and ${explained} explained — a row with no family ` +
    `is a divergence nobody has accounted for`);

const counts = overrides.reduce((/** @type {Record<string,number>} */ acc, row) =>
  ({ ...acc, [row.kind]: (acc[row.kind] ?? 0) + 1 }), {});

const artifact = {
  $comment: "DERIVED by tools/iana-oracle/registry.mjs. The port's behaviour is the JDK's, because " +
    "parity with lokalized-java is the product. This records the REGISTRY provenance plan 5.1 asks " +
    "for and the exact rows where the two disagree, verified by reconstruction.",
  formatVersion: 1,
  registrySnapshot: {
    path: "tools/iana-oracle/language-subtag-registry.txt",
    source: "https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry",
    fileDate,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    records: records.length,
  },
  registryClosureEntries: Object.keys(registryClosure).length,
  /**
   * The region and variant aliases, kept OUT of the language closure and listed here.
   *
   * The JDK applies these by substituting a trailing `-<subtag>`, never by matching a bare one.
   * Recording them separately is what stops the derived closure claiming `de` is equivalent to
   * `dd`; `src/negotiate/index.js` already carries the same fourteen inline and composes the two
   * arms as `LocaleMatcher` does.
   */
  regionVariantAliases: regionVariantPairs.sort((a, b) => a.from.localeCompare(b.from)),
  shippedClosureEntries: Object.keys(shipped).length,
  overrideCounts: counts,
  families: FAMILIES,
  overrides,
};

const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (process.argv.includes("--write")) writeFileSync(OUTPUT, serialized);
else {
  let recorded = "";
  try { recorded = readFileSync(OUTPUT, "utf8"); }
  catch { problems.push(`${OUTPUT} does not exist. Run: node tools/iana-oracle/registry.mjs --write`); }
  if (recorded && recorded !== serialized)
    problems.push("the recorded override table is not what this run produces");
}

console.log(`IANA registry snapshot — File-Date ${fileDate}, ${records.length} records, ${bytes.length} bytes`);
console.log(`  registry closure ${Object.keys(registryClosure).length} entries · shipped closure ${Object.keys(shipped).length}`);
console.log(`  overrides ${overrides.length}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
console.log(`  registry + overrides reproduces the shipped artifact: ${canon(reconstructed) === canon(shipped) ? "yes" : "NO"}`);
if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const line of problems) console.log(`  - ${line}`);
  process.exit(1);
}
