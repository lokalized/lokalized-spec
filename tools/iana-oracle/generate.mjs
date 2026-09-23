#!/usr/bin/env node
// @ts-check
/**
 * Generates the IANA language-range equivalence data with NO JDK: the pinned IANA Language Subtag
 * Registry snapshot is the source (amendment A30, planning/M-R-STATUS.md), and the JDK and
 * lokalized-java are CHECKS on what this emits (`tools/iana-oracle/build.mjs`, `npm run check:iana`).
 * lokalized-js consumes the artifact verbatim. lokalized-java does NOT read it: it derives its own
 * table from its own copy of the same snapshot, and the JDK check holds the two equal key for key and
 * pair for pair.
 *
 * Two inputs:
 *   - `tools/iana-oracle/language-subtag-registry.txt`, the snapshot;
 *   - `tools/iana-oracle/jdk-compatibility.json`, the ONLY authored input. It carries the ORDER in
 *     which the region/variant substitutions are tried — the registry states each substitution one
 *     way and in no order — and nothing else. The SET of substitutions is derived here from the
 *     registry and compared against it, so the file cannot add, drop or duplicate one.
 *
 * Three outputs, all regenerated and compared byte-for-byte by `--check`:
 *   - `generated/iana-language-equivalences.json`, the shared artifact (RFC 8785 JCS);
 *   - `generated/iana-data-lock.json`, the v2 IANA lock, whose `ianaDataFingerprint` is plan
 *     :1680-1682's projection and nothing wider;
 *   - `generated/IANA-PROVENANCE.md`, written from the template at the bottom of this file. Every
 *     number in it is interpolated; the RULES are prose, kept beside the code that implements each
 *     one. THAT IS THE RESIDUAL RISK: a rule changed in code without its sentence changing would be
 *     a false sentence nothing here detects. Change a rule and its RULE_* text in the same edit, and
 *     bump GENERATOR_VERSION when the emitted data moves.
 *
 * `--check` has one more arm, which needs no JDK and runs in lokalized-js CI: the RECORD ARM. The
 * JDK check writes `generated/iana-jdk-check.json`; this arm requires that record to name the
 * CURRENT artifact's digest and the CURRENT digests of the check's own tools, with every mismatch
 * count zero. So an artifact edited (or a check tool edited) without re-running the JDK check fails
 * here, in CI, where the JDK is not. A missing record fails; absence is never agreement.
 *
 * It also RE-DERIVES what a JDK-free run can re-derive, rather than trusting the record's numbers: it
 * rebuilds the probe space from `candidates.mjs` with the record's own `extraKeys` and requires the
 * recorded count and digest, and runs `model.mjs` over it and requires the recorded refusal count
 * (the JDK run found zero mismatches, so the library refused exactly what the model refuses). And it
 * binds the record to ONE Java build: the pinned JDK 21, the library's region/variant order equal to
 * the artifact's, a non-zero count of probes where the JDK's own parse differs (without which the JDK
 * setting's arm proved nothing), and the SAME `librarySourcesSha256` the behavioral corpus was
 * recorded against — so the IANA check and the corpus cannot silently name two different libraries.
 *
 * It never writes when any problem exists.
 *
 *   node tools/iana-oracle/generate.mjs --write | --check
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeSpace } from "./candidates.mjs";
import { ModelRefusal, modelFor } from "./model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const spec = resolve(here, "../..");

/** Bumped when a derivation rule changes what this emits. Recorded in the artifact and the lock. */
const GENERATOR_VERSION = 1;
const SCHEMA_ID = "lokalized-iana-language-equivalences/1";

const PATHS = {
  registry: "tools/iana-oracle/language-subtag-registry.txt",
  compatibility: "tools/iana-oracle/jdk-compatibility.json",
  generator: "tools/iana-oracle/generate.mjs",
  schema: "schema/iana-language-equivalences.schema.json",
  artifact: "generated/iana-language-equivalences.json",
  lock: "generated/iana-data-lock.json",
  provenance: "generated/IANA-PROVENANCE.md",
  jdkRecord: "generated/iana-jdk-check.json",
  corpus: "generated/behavioral-vectors.json",
};
const REGISTRY_SOURCE = "https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry";

/**
 * The JDK check's own tools. The record arm requires the record to carry EXACTLY these paths with
 * their current digests; build.mjs keeps the same list and writes it, and a disagreement between the
 * two lists fails here rather than passing on the intersection.
 */
const CHECK_TOOLS = [
  "tools/iana-oracle/build.mjs",
  "tools/iana-oracle/candidates.mjs",
  "tools/iana-oracle/library/com/lokalized/IanaCheckProbe.java",
  "tools/iana-oracle/model.mjs",
];

/**
 * Anti-vacuity floors. Registry records are never deleted (RFC 5646 section 3.4), so both counts
 * only grow; a snapshot or a parse that yields fewer is broken, not newer.
 */
const MINIMUM_RECORDS = 9296;
const MINIMUM_KEYS = 781;

const sha256 = (/** @type {Buffer | string} */ bytes) => createHash("sha256").update(bytes).digest("hex");
/** RFC 8785 JCS for the values this file emits: strings, integers, arrays, plain objects. */
const jcs = (/** @type {any} */ value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(",")}}`;
};
const bytewise = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);
const read = (/** @type {string} */ path) => readFileSync(join(spec, path));

const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;
if (!mode) {
  console.error("usage: node tools/iana-oracle/generate.mjs --write | --check");
  process.exit(2);
}

/** @type {string[]} */
const problems = [];

/* ------------------------------------------------------------------------------ the registry */

const registryBytes = read(PATHS.registry);
const registryText = registryBytes.toString("utf8");
const fileDate = /^File-Date:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(registryText)?.[1];
if (!fileDate) {
  console.error(`${PATHS.registry} carries no File-Date header; the snapshot cannot be named`);
  process.exit(2);
}
if (registryText.includes("\r"))
  problems.push(`${PATHS.registry} contains carriage returns; the record-jar split below assumes LF line ends`);

/**
 * RFC 5646 section 3.1.1's record-jar: records separated by `%%` lines, `Field-Name: body` fields,
 * a continuation line (leading whitespace) folded into the field above. The first occurrence of a
 * field wins, which is lokalized-java's `putIfAbsent`; only Description and Comments ever repeat.
 * The block before the first `%%` is the File-Date header and is not a record.
 */
const records = registryText.split(/\n%%\n/).slice(1).map((block, index) => {
  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {string | null} */
  let current = null;
  for (const line of block.split("\n")) {
    const field = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (field) {
      const name = /** @type {string} */ (field[1]);
      current = name in fields ? null : name;
      if (current) fields[current] = /** @type {string} */ (field[2]);
    } else if (current && /^\s+\S/.test(line)) fields[current] += ` ${line.trim()}`;
  }
  return { index, fields };
});
if (records.length < MINIMUM_RECORDS)
  problems.push(`${PATHS.registry} parsed to ${records.length} records, below the floor of ${MINIMUM_RECORDS}; registry records are never deleted, so the parse or the snapshot is broken`);

const KNOWN_TYPES = new Set(["language", "extlang", "script", "region", "variant", "grandfathered", "redundant"]);

/* ------------------------------------------------------------------ RULE L: class membership */

const RULE_L =
  "**Rule L — membership.** Only records of Type `language`, `extlang`, `grandfathered` and " +
  "`redundant` are in the language namespace; `region` and `variant` records feed rule R and " +
  "`script` records carry no Preferred-Value (the generator refuses one that does, because no rule " +
  "places it). Within the namespace, two lowercased tags are equivalent when one record's " +
  "`Subtag` (or `Tag`) names the other as its `Preferred-Value`, and when they are an extlang " +
  "subtag and its `Prefix`-joined form (`aao` and `ar-aao`). A record whose Preferred-Value is its " +
  "own spelling contributes no edge. Classes are the transitive closure of those edges; a tag in " +
  "no edge is in no class.";

/** @type {Array<[string, string]>} */
const edges = [];
/** Members that some record gives a Preferred-Value of their own (rule O's discriminator). */
const hasPreferredValue = new Set();
/** Each tag to the index of the first language-namespace record that names it (rule O). */
/** @type {Map<string, number>} */
const firstNamedAt = new Map();
/** Region/variant records carrying a Preferred-Value (rule R). */
/** @type {Array<{ from: string, to: string }>} */
const regionVariantRecords = [];

for (const { index, fields } of records) {
  const type = fields.Type;
  const tag = (fields.Subtag ?? fields.Tag)?.toLowerCase();
  if (!type || !KNOWN_TYPES.has(type)) { problems.push(`registry record ${index + 1} has Type ${JSON.stringify(type)}, which no rule here covers`); continue; }
  if (!tag) { problems.push(`registry record ${index + 1} (Type ${type}) names no Subtag or Tag`); continue; }
  const preferred = fields["Preferred-Value"]?.toLowerCase();

  if (type === "region" || type === "variant") {
    if (preferred) regionVariantRecords.push({ from: tag, to: preferred });
    continue;
  }
  if (type === "script") {
    if (preferred) problems.push(`script record ${fields.Subtag} carries Preferred-Value ${fields["Preferred-Value"]}; neither rule L nor rule R places a script, so a person must decide before this snapshot is pinned`);
    continue;
  }

  if (!firstNamedAt.has(tag)) firstNamedAt.set(tag, index);
  if (preferred && preferred !== tag) { edges.push([tag, preferred]); hasPreferredValue.add(tag); }

  if (type === "extlang") {
    if (!fields.Prefix) { problems.push(`extlang record ${tag} has no Prefix`); continue; }
    const joined = `${fields.Prefix.toLowerCase()}-${tag}`;
    if (!firstNamedAt.has(joined)) firstNamedAt.set(joined, index);
    edges.push([tag, joined]);
    // The joined form is deprecated in favour of the Preferred-Value too (RFC 5646 section 3.1.8),
    // unless that Preferred-Value IS the joined form, which would be a self-edge.
    if (preferred && preferred !== joined) hasPreferredValue.add(joined);
  }
}

/** @type {Map<string, string>} */
const parent = new Map();
const find = (/** @type {string} */ node) => {
  if (!parent.has(node)) parent.set(node, node);
  let root = node;
  while (parent.get(root) !== root) root = /** @type {string} */ (parent.get(root));
  while (parent.get(node) !== root) { const next = /** @type {string} */ (parent.get(node)); parent.set(node, root); node = next; }
  return root;
};
for (const [a, b] of edges) {
  const left = find(a), right = find(b);
  if (left !== right) parent.set(left, right);
}
/** @type {Map<string, string[]>} */
const grouped = new Map();
for (const member of [...parent.keys()].sort(bytewise)) {
  const root = find(member);
  grouped.set(root, [...(grouped.get(root) ?? []), member]);
}

/* ---------------------------------------------------------------------- RULE O: class order */

const RULE_O =
  "**Rule O — order.** Every class has exactly one member that no record gives a `Preferred-Value` " +
  "of its own — the tag the others are deprecated in favour of — and it comes first. The rest follow " +
  "in the order the registry first NAMES them, where a record names its own `Subtag` or `Tag` and an " +
  "extlang record also names its `Prefix`-joined form. The generator refuses a class with no such " +
  "member or more than one, and a class in which two members are first named by the same record, " +
  "rather than guess. Classes are then sorted bytewise by their first member. For any member, its " +
  "equivalents are its class with it removed, order preserved; lokalized-java's per-key table is " +
  "exactly that, and `npm run check:iana` compares the two key by key.";

/** @type {string[][]} */
const classes = [];
for (const members of grouped.values()) {
  if (members.length < 2) continue;
  const roots = members.filter((member) => !hasPreferredValue.has(member));
  if (roots.length !== 1) {
    problems.push(`class {${members.join(", ")}} has ${roots.length} members with no Preferred-Value (${roots.join(", ") || "none"}); rule O needs exactly one`);
    continue;
  }
  const rest = members.filter((member) => member !== roots[0]);
  const positions = new Map();
  for (const member of rest) {
    const at = firstNamedAt.get(member);
    if (at === undefined) problems.push(`class member ${member} is named by no language-namespace record, so rule O cannot place it`);
    else if (positions.has(at)) problems.push(`class members ${positions.get(at)} and ${member} are first named by the same record (${at + 1}); rule O cannot order them`);
    else positions.set(at, member);
  }
  rest.sort((a, b) => /** @type {number} */ (firstNamedAt.get(a)) - /** @type {number} */ (firstNamedAt.get(b)));
  classes.push([/** @type {string} */ (roots[0]), ...rest]);
}
classes.sort((a, b) => bytewise(/** @type {string} */ (a[0]), /** @type {string} */ (b[0])));
const keyCount = classes.reduce((total, members) => total + members.length, 0);
if (classes.length === 0) problems.push("the registry produced no language equivalence class");
if (keyCount < MINIMUM_KEYS)
  problems.push(`the classes hold ${keyCount} tags, below the floor of ${MINIMUM_KEYS}; registry records are never deleted, so a rule has broken`);

/* ------------------------------------------------------- RULE R: region/variant substitutions */

const RULE_R =
  "**Rule R — region and variant substitutions.** Each `region` or `variant` record carrying a " +
  "`Preferred-Value` yields a substitution in BOTH directions, lowercased with a leading hyphen " +
  "(`-bu` to `-mm` and `-mm` to `-bu`); the leading hyphen is what confines them to subtags after the " +
  "first. The registry states each one way and in no order, and the order is observable, because it " +
  "decides which substitution applies when a range could take two. So the generator derives the SET " +
  "and requires the authored compatibility file to list exactly that set, each pair once; only the " +
  "ORDER is authored. The substitution itself is the JDK's semantics, kept deliberately: it expands " +
  "`de-DE` to `de-DD`, a region deprecated in 1990, which the registry does not say.";

const compatibilityBytes = read(PATHS.compatibility);
/** @type {any} */
let compatibility = null;
try { compatibility = JSON.parse(compatibilityBytes.toString("utf8")); } catch (error) {
  problems.push(`${PATHS.compatibility} is not JSON: ${/** @type {Error} */ (error).message}`);
}
/** @type {[string, string][]} */
let authoredPairs = [];
/** @type {string} */
let compatibilitySource = "";
if (compatibility) {
  const exactKeys = (/** @type {any} */ object, /** @type {string[]} */ keys, /** @type {string} */ where) => {
    const actual = object && typeof object === "object" && !Array.isArray(object) ? Object.keys(object).sort() : null;
    if (jcs(actual) !== jcs([...keys].sort()))
      problems.push(`${PATHS.compatibility}${where} must have exactly the keys ${keys.join(", ")}; it has ${actual ? actual.join(", ") : "no object"}. Every byte of this file is fingerprinted, so it carries nothing else`);
  };
  exactKeys(compatibility, ["formatVersion", "regionVariantEquivalents"], "");
  exactKeys(compatibility.regionVariantEquivalents, ["rule", "source", "pairs"], ".regionVariantEquivalents");
  if (compatibility.formatVersion !== 1) problems.push(`${PATHS.compatibility} formatVersion is ${compatibility.formatVersion}; this generator reads 1`);
  const block = compatibility.regionVariantEquivalents ?? {};
  if (typeof block.source !== "string" || block.source.length === 0) problems.push(`${PATHS.compatibility} names no source for its order`);
  else compatibilitySource = block.source;
  if (typeof block.rule !== "string" || block.rule.length === 0) problems.push(`${PATHS.compatibility} states no rule`);
  if (!Array.isArray(block.pairs)) problems.push(`${PATHS.compatibility} has no pairs array`);
  else authoredPairs = block.pairs;
}

{
  const shape = /^-[a-z0-9]{2,8}$/;
  const derived = new Set();
  for (const { from, to } of regionVariantRecords) { derived.add(`-${from}>-${to}`); derived.add(`-${to}>-${from}`); }
  const authored = new Set();
  for (const pair of authoredPairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((subtag) => typeof subtag === "string" && shape.test(subtag))) {
      problems.push(`${PATHS.compatibility} pair ${JSON.stringify(pair)} is not two lowercase hyphen-prefixed subtags`);
      continue;
    }
    const key = `${pair[0]}>${pair[1]}`;
    if (authored.has(key)) problems.push(`${PATHS.compatibility} lists ${key} twice`);
    authored.add(key);
    if (!derived.has(key)) problems.push(`${PATHS.compatibility} pair ${key} is not a registry region/variant substitution in either direction`);
  }
  for (const key of [...derived].sort(bytewise))
    if (!authored.has(key)) problems.push(`registry region/variant substitution ${key} has no position in ${PATHS.compatibility}`);
  if (authoredPairs.length === 0) problems.push("no region/variant substitution was authored; the registry has always carried some");
}

/* -------------------------------------------------------------------------------- the artifact */

const artifact = {
  formatVersion: 1,
  schema: SCHEMA_ID,
  generator: { path: PATHS.generator, version: GENERATOR_VERSION },
  registry: {
    path: PATHS.registry,
    source: REGISTRY_SOURCE,
    fileDate,
    sha256: sha256(registryBytes),
    bytes: registryBytes.length,
    records: records.length,
  },
  jdkCompatibility: { path: PATHS.compatibility, sha256: sha256(compatibilityBytes) },
  languageEquivalenceClasses: classes,
  regionVariantEquivalents: authoredPairs.map((pair) => [pair[0], pair[1]]),
};
const artifactBytes = Buffer.from(jcs(artifact), "utf8");

/* ------------------------------------------------------------------------------------ the lock */

/**
 * Plan :1672-1678's inputs record, and :1680-1682's fingerprint.
 *
 * `inputs` lists every file that can change the artifact, sorted bytewise by (role, path), and
 * `inputsSha256` is the digest of `{recipeVersion: 1, inputs}` as JCS. The fingerprint is the digest
 * of the lock's `{formatVersion, ianaRegistryDate, sourceSha256, closureSchemaVersion, artifacts,
 * compatibilityOverridesSha256}` with each artifact projected to `{path, sha256}` — so it EXCLUDES
 * the fingerprint itself, `generator`, `inputs` and `inputsSha256`. An edit to this file therefore
 * moves the lock's bytes (its digest is an input) without moving the fingerprint; a change to the
 * snapshot, the compatibility bytes or the artifact moves both.
 */
const inputs = [
  { role: "compatibility-overlay", path: PATHS.compatibility, sha256: sha256(compatibilityBytes) },
  { role: "generator", path: PATHS.generator, sha256: sha256(read(PATHS.generator)) },
  { role: "schema", path: PATHS.schema, sha256: sha256(read(PATHS.schema)) },
  { role: "source", path: PATHS.registry, sha256: sha256(registryBytes) },
].sort((a, b) => bytewise(a.role, b.role) || bytewise(a.path, b.path));
const artifacts = [{
  path: PATHS.artifact,
  sha256: sha256(artifactBytes),
  inputsSha256: sha256(Buffer.from(jcs({ recipeVersion: 1, inputs }), "utf8")),
}].sort((a, b) => bytewise(a.path, b.path));

// Plan :1681: absent overrides are the schema's fixed null. There are none only when the file
// authors no pair AND the registry yields no substitution, which the floor above refuses today.
const compatibilityOverridesSha256 = authoredPairs.length === 0 && regionVariantRecords.length === 0
  ? null
  : sha256(compatibilityBytes);

const lockCore = {
  formatVersion: 2,
  ianaRegistryDate: fileDate,
  sourceSha256: sha256(registryBytes),
  closureSchemaVersion: SCHEMA_ID,
  compatibilityOverridesSha256,
};
const ianaDataFingerprint = sha256(Buffer.from(jcs({
  ...lockCore,
  artifacts: artifacts.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
}), "utf8"));
const lock = {
  ...lockCore,
  note: "IANA lock v2. ianaDataFingerprint is the SHA-256 of the JCS bytes of {formatVersion, ianaRegistryDate, sourceSha256, closureSchemaVersion, artifacts (each projected to {path, sha256}), compatibilityOverridesSha256} (plan v7 5.1 :1680-1682); note, generator, inputs and inputsSha256 are outside it. Written by tools/iana-oracle/generate.mjs --write; do not edit.",
  generator: { path: PATHS.generator, version: GENERATOR_VERSION },
  inputs,
  artifacts,
  ianaDataFingerprint,
};
const lockBytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, "utf8");

/* ------------------------------------------------------------------------- the provenance doc */

const CONSUMER_ALGORITHM = [
  "Every port parses a language-range list (an `Accept-Language` value, or a caller's own range",
  "string) the same way. lokalized-java 3.1.0 does it in `LocaleMatcher#parseLanguageRanges` on the",
  "default `LanguageRangeEquivalents.IANA_REGISTRY` setting; `tools/iana-oracle/model.mjs` is the",
  "executable statement the checks compare against. It is `java.util.Locale.LanguageRange#parse`",
  "with the language table taken from this artifact instead of the running JDK:",
  "",
  "1. Remove every space (U+0020) and lowercase the whole value.",
  "2. Drop a leading `accept-language:`.",
  "3. Split on `,` exactly as `java.lang.String#split(\",\")` does. A value with no `,` is ONE",
  "   member, so an EMPTY value (including one that was only spaces, or only `accept-language:`) is one",
  "   empty member, which step 6 refuses with `range=`; it is not an empty list. Otherwise trailing",
  "   empty members are dropped, so a value of commas only IS an empty list, and every other empty",
  "   member (leading or interior) is kept and then refused by step 6.",
  "4. A member may end in `;q=<weight>`. The weight is read with `java.lang.Double#parseDouble`'s",
  "   grammar and must lie in [0.0, 1.0]; otherwise the whole value is refused. The default is 1.0.",
  "5. A range already in the list is skipped: the first occurrence wins.",
  "6. The range must satisfy `LanguageRange`'s grammar: a first subtag of 1-8 ASCII letters or `*`,",
  "   later subtags of 1-8 ASCII letters or digits or `*`, and no trailing hyphen.",
  "7. Insert the range before the first member whose weight is strictly LOWER (a stable sort).",
  "8. Compute the range's expansions, and insert each one not yet in the list at the range's index",
  "   plus one — so, as a list, they end up in REVERSE of the order computed. In computation order:",
  "   1. the range's own region/variant substitution, if any;",
  "   2. for the LONGEST hyphen-bounded prefix of the range that is a member of a",
  "      `languageEquivalenceClasses` class (try the whole range, then drop the last subtag, and so",
  "      on), each OTHER member of that class in class order, with the rest of the range appended",
  "      unchanged; each immediately followed by that member's own region/variant substitution, if",
  "      any. At most one prefix is used.",
  "",
  "A **region/variant substitution** walks `regionVariantEquivalents` in array order and applies the",
  "FIRST pair whose `from` occurs in the range — its first occurrence only — ending at the end of",
  "the range or at a hyphen, and not starting after the hyphen that opens the first one-character",
  "subtag other than the first subtag (a singleton extension such as `-x-` or `-u-`). The occurrence",
  "is replaced by `to`. At most one substitution applies per range.",
  "",
  "**Refusals.** A value is parsed whole or refused whole: the first member that fails refuses the",
  "value, and no partial list is returned. `<range>` and `<text>` below are as they stand after",
  "step 1, lowercased and without spaces. lokalized-java 3.1.0 on JDK 21 throws, and `model.mjs`",
  "reports, exactly one of:",
  "",
  "- `java.lang.IllegalArgumentException`, message `range=<range>`: the range fails step 6's",
  "  grammar. An empty range gives `range=`.",
  "- `java.lang.IllegalArgumentException`, message `weight=\"<text>\" for language range \"<range>\"`:",
  "  the text after `;q=` is not a number in `Double#parseDouble`'s grammar.",
  "- `java.lang.IllegalArgumentException`, message",
  "  `weight=<w> for language range \"<range>\". It must be between 0.0 and 1.0.`: the weight is",
  "  outside [0.0, 1.0]; `<w>` is its `java.lang.Double#toString` form, such as `2.0`, `1.0E21` or `-0.5`.",
  "- `java.lang.ArrayIndexOutOfBoundsException`, message `Index 0 out of bounds for length 0`: the",
  "  range is made only of hyphens (`-`, `---`), so splitting it on `-` yields no subtag at all. This",
  "  one is the JDK's own `LanguageRange` constructor failing, and it DEPENDS ON THE JDK VERSION: JDK 17",
  "  and 21 throw it, JDK 25 through 27 throw `IllegalArgumentException` `range=<range>` instead (measured",
  "  on Corretto 17, 21, 25, 26 and 27). The checks pin JDK 21, and so does this statement.",
  "",
  "A weight is read (step 4) before the range is de-duplicated (step 5), so a malformed weight on a",
  "range already in the list is still refused.",
].join("\n");

/**
 * Worked examples, COMPUTED by the model over the artifact just built rather than written out by
 * hand: a hand-written example is a claim, and this file's template is already the one place prose
 * can rot. The model is itself held to lokalized-java by the JDK check.
 */
const EXAMPLE_HEADERS = ["yol", "mgp-bu", "sgn-de-tl", "en-x-fr", "iw;q=0.5,fr", "", ",", "-"];
const examples = (() => {
  const model = modelFor(artifact);
  return EXAMPLE_HEADERS.map((header) => {
    const value = header === "" ? "(empty value)" : `\`${header}\``;
    /** @type {string} */
    let parsedText;
    try {
      const parsed = model.parse(header).map(({ range, weight }) => (weight === 1 ? range : `${range};q=${weight}`));
      parsedText = parsed.length === 0 ? "(empty list)" : `\`${parsed.join(", ")}\``;
    } catch (error) {
      // Only a refusal the model states is an example; anything else is a defect in the model.
      if (!(error instanceof ModelRefusal)) throw error;
      return `| ${value} | (refused) | refused: \`${error.javaClass}\`, \`${error.message}\` |`;
    }
    return `| ${value} | ${header.includes(",") ? "(per member)" : model.expansionsFor(header).map((e) => `\`${e}\``).join(", ") || "none"} | ${parsedText} |`;
  }).join("\n");
})();

const histogram = (() => {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const members of classes) counts.set(members.length, (counts.get(members.length) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
})();

const provenance = `# IANA language-range equivalences — provenance

GENERATED by \`node tools/iana-oracle/generate.mjs --write\` from the two inputs below. Do not edit;
\`npm run check:iana-registry\` regenerates this file and fails on any byte of difference.

| | |
|---|---|
| Artifact | \`${PATHS.artifact}\` (RFC 8785 JCS, ${artifactBytes.length.toLocaleString("en-US")} bytes, sha256 \`${sha256(artifactBytes)}\`) |
| Lock | \`${PATHS.lock}\` (format 2, \`ianaDataFingerprint\` \`${ianaDataFingerprint}\`) |
| Registry snapshot | \`${PATHS.registry}\` — File-Date \`${fileDate}\`, ${registryBytes.length.toLocaleString("en-US")} bytes, ${records.length.toLocaleString("en-US")} records, sha256 \`${sha256(registryBytes)}\` |
| Registry source | ${REGISTRY_SOURCE} |
| JDK-compatibility input | \`${PATHS.compatibility}\`, sha256 \`${sha256(compatibilityBytes)}\` |
| Generator | \`${PATHS.generator}\`, version ${GENERATOR_VERSION} |

## What this is

The IANA Language Subtag Registry says which language tags are equivalent: \`iw\` and \`he\`, \`in\`
and \`id\`, an extlang such as \`ar-aao\` and its primary-language form \`aao\`. Every Lokalized
implementation expands a requested language range by those equivalences before matching, so a
request for either spelling finds a catalog stored under the other. This artifact is that data,
generated from a pinned snapshot with no JDK. lokalized-js consumes it verbatim. lokalized-java does
not read it: it derives its own table from its own copy of the same snapshot, and
\`npm run check:iana\` holds the two equal key for key and pair for pair. A later port may do either.

The registry is the source (amendment A30). The JDK and lokalized-java are CHECKS on the result, not
inputs to it. This replaced \`generated/iana-language-range-equivalents.json\`, an 818-entry
expanded closure recorded by probing an implementation, which could not state the order of the
region/variant substitutions and could not be regenerated without a JDK.

## How the data is derived

${RULE_L}

${RULE_O}

${RULE_R}

## What it holds

${classes.length.toLocaleString("en-US")} language equivalence classes over ${keyCount.toLocaleString("en-US")} tags, and ${authoredPairs.length} region/variant substitutions.

| class size | classes |
|---:|---:|
${histogram.map(([size, count]) => `| ${size} | ${count} |`).join("\n")}

The region/variant substitutions, in the order a consumer tries them:

| # | from | to |
|---:|---|---|
${authoredPairs.map((pair, index) => `| ${index + 1} | \`${pair[0]}\` | \`${pair[1]}\` |`).join("\n")}

Order source: ${compatibilitySource}.

## How a consumer applies it

${CONSUMER_ALGORITHM}

Worked examples, computed from this artifact by \`tools/iana-oracle/model.mjs\`:

| value | expansions, in computation order | parsed list |
|---|---|---|
${examples}

## The lock and the fingerprint

\`ianaDataFingerprint\` is the SHA-256 of the RFC 8785 JCS bytes of the lock's
\`{formatVersion, ianaRegistryDate, sourceSha256, closureSchemaVersion, artifacts,
compatibilityOverridesSha256}\`, with each artifact entry projected to \`{path, sha256}\` (plan v7
section 5.1). It moves when the snapshot, the JDK-compatibility bytes or the artifact move, and not
when only the generator's own source does. \`compatibilityOverridesSha256\` is the SHA-256 of the
JDK-compatibility file's exact bytes, so an edit to its prose moves the fingerprint too.

## How it is checked

- \`npm run check:iana-registry\` — no JDK, runs in lokalized-js CI. Regenerates the artifact, the
  lock and this file and compares bytes; refuses a class with zero or several roots, a region/variant
  set that differs from the registry's, and a snapshot below the record and tag floors; and requires
  \`${PATHS.jdkRecord}\` to name this artifact's digest and the check tools' current digests with
  zero mismatches. It re-derives what needs no JDK — the probe space's size and digest, and the
  model's refusal count over it — and requires the record to name JDK 21, the library's
  region/variant order as equal, a non-zero count of probes where the JDK's own parse differs, and
  the same \`librarySourcesSha256\` as \`${PATHS.corpus}\`. It then forces \`build.mjs\` to stop as
  "cannot run" at each of its three steps inside its work directory, with a fake JDK and a private
  temp folder, and fails if any stop leaves the directory behind
  (\`tools/iana-oracle/cannot-run-cleanup.mjs\`). And it requires \`THIRD-PARTY-NOTICES.md\`'s IANA
  section to state the source, this snapshot's File-Date and SHA-256 and the counts above, and to
  make no statement about the registry's legal status.
- \`npm run check:schemas\` — no JDK. Besides the JSON Schema and the JCS bytes, a second reader of
  the snapshot, sharing no code with this generator, requires the classes to be pairwise disjoint and
  sorted bytewise by member 0, member 0 to be the one member no record deprecates (gives a
  \`Preferred-Value\` other than itself), every other member to be deprecated, and every tag the
  registry deprecates in the language namespace to be in some class.
- \`npm run check:iana\` — the pinned JDK 21 and lokalized-java's built classes. Compares the
  library's own table, region/variant order and registry constants with this artifact; runs the
  library's public \`LocaleMatcher#parseLanguageRanges\` over the whole probe space against
  \`tools/iana-oracle/model.mjs\`; compares the JDK's own region/variant order with the authored one;
  and checks the library's \`LanguageRangeEquivalents.JDK\` setting against
  \`java.util.Locale.LanguageRange#parse\`. \`npm run iana:jdk-check\` runs the same check and writes
  \`${PATHS.jdkRecord}\` only when every gate passes; \`npm run check:iana\` requires that record
  byte for byte.
`;
const provenanceBytes = Buffer.from(provenance, "utf8");

/* -------------------------------------------------------------------------------- write/check */

const outputs = [
  [PATHS.artifact, artifactBytes],
  [PATHS.lock, lockBytes],
  [PATHS.provenance, provenanceBytes],
];

const summary = {
  fileDate,
  records: records.length,
  classes: classes.length,
  keys: keyCount,
  regionVariantPairs: authoredPairs.length,
  artifactBytes: artifactBytes.length,
  ianaDataFingerprint,
};

if (problems.length > 0) {
  console.error(JSON.stringify({ status: "refused", detail: "nothing was written", problems, ...summary }, null, 2));
  process.exit(1);
}

if (mode === "write") {
  for (const [path, bytes] of outputs) writeFileSync(join(spec, /** @type {string} */ (path)), /** @type {Buffer} */ (bytes));
  console.log(JSON.stringify({ status: "written", ...summary }));
  process.exit(0);
}

for (const [path, bytes] of outputs) {
  const full = join(spec, /** @type {string} */ (path));
  if (!existsSync(full)) problems.push(`${path} is missing; run npm run iana:generate`);
  else if (!readFileSync(full).equals(/** @type {Buffer} */ (bytes))) problems.push(`${path} differs from a regeneration; run npm run iana:generate and review the diff`);
}

/**
 * THE LICENSING SURFACE'S IANA SECTION. `THIRD-PARTY-NOTICES.md` ships in the data archive and states
 * which snapshot the artifact came from and what it holds; every one of those is a number this file
 * computes, so each is required here rather than trusted. By the maintainer's decision (A30 follow-up,
 * 2026-09-23) the section states ONLY the source, the pinned snapshot and what is derived from it, and
 * does not characterise the registry's legal status — an uncited licensing claim in the licensing
 * surface is the shape this project keeps finding — so a characterisation is refused too.
 */
{
  const notices = read("THIRD-PARTY-NOTICES.md").toString("utf8");
  const heading = "## IANA Language Subtag Registry";
  const start = notices.indexOf(heading);
  const end = start === -1 ? -1 : notices.indexOf("\n## ", start + heading.length);
  const section = start === -1 ? "" : notices.slice(start, end === -1 ? undefined : end).replace(/\s+/g, " ");
  if (section === "") problems.push(`THIRD-PARTY-NOTICES.md has no '${heading}' section`);
  else {
    /** @type {[string, string][]} */
    const required = [
      ["the registry's source URL", REGISTRY_SOURCE],
      ["the snapshot's File-Date", `File-Date \`${fileDate}\``],
      ["the snapshot's SHA-256", sha256(registryBytes)],
      ["the class count", `${classes.length} language equivalence classes`],
      ["the tag count", `${keyCount.toLocaleString("en-US")} tags`],
      ["the substitution count", `${authoredPairs.length} region and variant substitutions`],
    ];
    for (const [what, needle] of required)
      if (!section.includes(needle)) problems.push(`THIRD-PARTY-NOTICES.md's IANA section does not state ${what} (${needle})`);
    const characterisation = /licen[cs]ed work|factual data|public domain|no licen[cs]e|not copyright|copyrightable/i.exec(section);
    if (characterisation)
      problems.push(`THIRD-PARTY-NOTICES.md's IANA section characterises the registry's legal status ("${characterisation[0]}"); it states only the source, the pinned snapshot and what is derived from it`);
  }
}

/**
 * THE RECORD ARM. `build.mjs` is the only thing that can run the JDK and the library, and it cannot
 * run in CI; this is what makes its result binding there. Every field read below must exist — a
 * record missing a count is not a record of zero.
 */
{
  const recordPath = join(spec, PATHS.jdkRecord);
  if (!existsSync(recordPath)) problems.push(`${PATHS.jdkRecord} is missing; run npm run iana:jdk-check on the pinned JDK`);
  else {
    /** @type {any} */
    let record = null;
    try { record = JSON.parse(readFileSync(recordPath, "utf8")); } catch (error) {
      problems.push(`${PATHS.jdkRecord} is not JSON: ${/** @type {Error} */ (error).message}`);
    }
    if (record) {
      if (record.formatVersion !== 1) problems.push(`${PATHS.jdkRecord} formatVersion ${record.formatVersion}; this arm reads 1`);
      if (record.artifact?.path !== PATHS.artifact || record.artifact?.sha256 !== sha256(artifactBytes))
        problems.push(`${PATHS.jdkRecord} checked artifact ${record.artifact?.path} ${record.artifact?.sha256}, not the current ${PATHS.artifact} ${sha256(artifactBytes)}; re-run npm run iana:jdk-check`);
      const recordedTools = Array.isArray(record.tools) ? record.tools : [];
      const recordedPaths = recordedTools.map((/** @type {any} */ tool) => tool?.path).sort(bytewise);
      if (jcs(recordedPaths) !== jcs([...CHECK_TOOLS].sort(bytewise)))
        problems.push(`${PATHS.jdkRecord} records the tools ${recordedPaths.join(", ")}, not ${CHECK_TOOLS.join(", ")}`);
      for (const tool of recordedTools) {
        if (!CHECK_TOOLS.includes(tool?.path)) continue;
        const current = existsSync(join(spec, tool.path)) ? sha256(read(tool.path)) : null;
        if (tool.sha256 !== current)
          problems.push(`${tool.path} has changed since the JDK check ran (recorded ${tool.sha256}, now ${current}); re-run npm run iana:jdk-check`);
      }
      const zeros = {
        "results.table.differences": record.results?.table?.differences,
        "results.libraryDefault.mismatches": record.results?.libraryDefault?.mismatches,
        "results.libraryJdkMode.mismatchesAgainstJdkParse": record.results?.libraryJdkMode?.mismatchesAgainstJdkParse,
      };
      for (const [field, value] of Object.entries(zeros))
        if (value !== 0) problems.push(`${PATHS.jdkRecord} ${field} is ${JSON.stringify(value)}, not 0`);
      const trues = {
        "results.registryConstants.equal": record.results?.registryConstants?.equal,
        "results.jdkRegionVariantOrder.equal": record.results?.jdkRegionVariantOrder?.equal,
      };
      for (const [field, value] of Object.entries(trues))
        if (value !== true) problems.push(`${PATHS.jdkRecord} ${field} is ${JSON.stringify(value)}, not true`);
      const vendored = record.results?.vendoredCopies;
      if (!Array.isArray(vendored) || vendored.length === 0 || vendored.some((/** @type {any} */ copy) => copy?.equal !== true))
        problems.push(`${PATHS.jdkRecord} results.vendoredCopies does not record every lokalized-java copy of the inputs as equal`);
      if (!(record.results?.libraryDefault?.probes > 0) || !(record.results?.libraryDefault?.refused > 0))
        problems.push(`${PATHS.jdkRecord} records no probes or no refusals; a check that exercised nothing is not a check`);

      // THE RECORD'S OWN JAVA BUILD, bound without a JDK. Each of these is a field build.mjs GATES on
      // or writes from the run, and before this arm read them a hand edit to any one passed CI:
      // measured, a record claiming JDK 17, an unequal library pair order, zero JDK differences and an
      // all-zero library digest left this check at exit 0.
      if (record.results?.libraryRegionVariantOrder?.equal !== true)
        problems.push(`${PATHS.jdkRecord} results.libraryRegionVariantOrder.equal is ${JSON.stringify(record.results?.libraryRegionVariantOrder?.equal)}, not true`);
      if (!(record.results?.jdkParseDiffers?.probes > 0))
        problems.push(`${PATHS.jdkRecord} results.jdkParseDiffers.probes is ${JSON.stringify(record.results?.jdkParseDiffers?.probes)}; with no probe where the JDK's own parse differs from the registry's, the JDK-setting arm proved nothing`);
      const jdkMajor = /^(\d+)(?:[.+-]|$)/.exec(String(record.oracle?.jdkVersion ?? ""))?.[1];
      if (jdkMajor !== "21")
        problems.push(`${PATHS.jdkRecord} oracle.jdkVersion is ${JSON.stringify(record.oracle?.jdkVersion)}; the check is pinned to JDK 21, whose table and region/variant order the compatibility file names`);
      /** @type {any} */
      let corpusOracle = null;
      try { corpusOracle = JSON.parse(read(PATHS.corpus).toString("utf8")).oracle; } catch (error) {
        problems.push(`${PATHS.corpus} cannot be read for its oracle block: ${/** @type {Error} */ (error).message}`);
      }
      if (corpusOracle) {
        const corpusLibrary = corpusOracle.librarySourcesSha256;
        if (typeof corpusLibrary !== "string" || !/^[0-9a-f]{64}$/.test(corpusLibrary))
          problems.push(`${PATHS.corpus} oracle.librarySourcesSha256 is ${JSON.stringify(corpusLibrary)}; there is no library build to bind the IANA record to`);
        else if (record.oracle?.librarySourcesSha256 !== corpusLibrary)
          problems.push(`${PATHS.jdkRecord} was recorded against lokalized-java sources ${record.oracle?.librarySourcesSha256} and ${PATHS.corpus} against ${corpusLibrary}; the IANA check and the corpus must name ONE Java build. Re-run whichever is older (npm run iana:jdk-check, or tools/vector-oracle/build.mjs --write)`);
      }

      // THE PROBE SPACE AND THE REFUSAL COUNT, RE-DERIVED. candidates.mjs is pure and needs no JDK,
      // and the record carries the extra keys it was given, so the space the JDK check ran over can be
      // rebuilt here exactly. The run recorded ZERO mismatches between the library and model.mjs, so
      // the library refused exactly the probes the model refuses; a recorded refusal count the model
      // does not reproduce is a record nobody ran.
      const extraKeys = record.probeSpace?.extraKeys;
      if (!Array.isArray(extraKeys) || extraKeys.some((/** @type {unknown} */ key) => typeof key !== "string"))
        problems.push(`${PATHS.jdkRecord} probeSpace.extraKeys is not a list of strings; the probe space cannot be rebuilt`);
      else {
        const rebuilt = probeSpace(artifact, extraKeys);
        const rebuiltSha256 = sha256(Buffer.from(JSON.stringify(rebuilt), "utf8"));
        if (record.probeSpace?.probes !== rebuilt.length || record.probeSpace?.sha256 !== rebuiltSha256)
          problems.push(`${PATHS.jdkRecord} probeSpace records ${JSON.stringify(record.probeSpace?.probes)} probes, sha256 ${record.probeSpace?.sha256}; candidates.mjs rebuilds ${rebuilt.length}, sha256 ${rebuiltSha256}`);
        if (record.results?.libraryDefault?.probes !== rebuilt.length)
          problems.push(`${PATHS.jdkRecord} results.libraryDefault.probes is ${JSON.stringify(record.results?.libraryDefault?.probes)}, not the ${rebuilt.length} probes the space rebuilds to`);
        const model = modelFor(artifact);
        let modelRefused = 0;
        for (const probe of rebuilt) {
          try { model.parse(probe); } catch (error) {
            if (!(error instanceof ModelRefusal)) throw error;
            modelRefused++;
          }
        }
        if (record.results?.libraryDefault?.refused !== modelRefused)
          problems.push(`${PATHS.jdkRecord} results.libraryDefault.refused is ${JSON.stringify(record.results?.libraryDefault?.refused)}; model.mjs refuses ${modelRefused} of the ${rebuilt.length} rebuilt probes, and the record claims zero mismatches`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(JSON.stringify({ status: "stale", problems, ...summary }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: "current", ...summary }));
