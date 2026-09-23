#!/usr/bin/env node
// @ts-check
/**
 * Validates the vendored generated artifacts against their JSON Schemas, and re-checks the
 * canonical-serialization rules the schemas cannot express, and — for the IANA artifact — the class
 * structure a schema cannot express either, against the registry snapshot it names.
 *
 * JSON Schema constrains the parsed value. RFC 8785 JCS constrains the BYTES — key order, absence of
 * whitespace, no trailing newline. Both matter here, because non-JVM consumers hash these bytes, so
 * the byte-level checks are done separately rather than assumed.
 *
 *   node scripts/validate-artifacts.mjs
 */
import Ajv2020 from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const specDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDirectory = join(specDirectory, "vendor/lokalized-java/src/build/resources/cldr");

const CASES = [
  { artifact: "cldr-locale-data.json", schema: "cldr-locale-data.schema.json", dir: vendorDirectory },
  { artifact: "cldr-conformance-vectors.json", schema: "cldr-conformance-vectors.schema.json", dir: vendorDirectory },
  // Not a vendored CLDR artifact: this one is produced here by the Java behavioral oracle.
  { artifact: "behavioral-vectors.json", schema: "behavioral-vectors.schema.json", dir: join(specDirectory, "generated") },
  // Nor this: generated here, with no JDK, from the pinned IANA registry (tools/iana-oracle/generate.mjs).
  { artifact: "iana-language-equivalences.json", schema: "iana-language-equivalences.schema.json", dir: join(specDirectory, "generated") },
];

/** RFC 8785 requires sorted members, no insignificant whitespace, and no trailing newline. */
function canonicalizationProblems(rawBytes, parsed) {
  const problems = [];
  const reserialized = Buffer.from(JSON.stringify(sortDeep(parsed)), "utf8");
  if (!rawBytes.equals(reserialized))
    problems.push("bytes are not RFC 8785 JCS (member order, whitespace, or escaping differs)");
  if (rawBytes.length > 0 && rawBytes[rawBytes.length - 1] === 0x0a)
    problems.push("artifact ends with a trailing newline");
  if (rawBytes.length >= 3 && rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf)
    problems.push("artifact starts with a UTF-8 BOM");
  return problems;
}

/** Recursively sort object members by UTF-16 code unit; arrays keep their order. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortDeep(value[k])]),
    );
  }
  return value;
}

/**
 * THE IANA ARTIFACT'S CLASS STRUCTURE, CHECKED BY A SECOND READER OF THE REGISTRY.
 *
 * `generated/iana-language-equivalences.json` documents two ORDER properties no other gate could see
 * independently of the generator that emits them: member 0 of each class is its one member the
 * registry does not deprecate, and the classes are sorted bytewise by member 0. Per-key tables and the
 * parse cannot observe either for a two-member class — each member's equivalents are just "the other
 * one" whichever comes first — so, measured: a generator that put the root LAST in the 332
 * two-member classes, or that reversed the class sort, passed `check:iana-registry` (which compares
 * the generator with ITSELF), `check:iana` and this file once the records were re-written.
 *
 * So this reads the snapshot the artifact names with its OWN parser — it shares no code with
 * `tools/iana-oracle/generate.mjs`, deliberately, so one defect cannot sit in both — and requires:
 *
 *   - the snapshot's bytes to be the ones the artifact names (sha256), or nothing below is about it;
 *   - the classes to be pairwise disjoint, and sorted strictly bytewise by member 0;
 *   - member 0 of every class to be DEPRECATED BY NO record, and every other member to be deprecated
 *     by at least one;
 *   - every tag the registry deprecates in the language namespace to be in some class (a class the
 *     generator dropped would otherwise leave every rule above satisfied).
 *
 * "Deprecated" means: named by a `language`, `extlang`, `grandfathered` or `redundant` record that
 * carries a `Preferred-Value` OTHER THAN ITSELF. A record names its `Subtag` or `Tag`; an extlang
 * record also names its `Prefix`-joined form, and its Preferred-Value is the mapping for THAT form
 * (RFC 5646 section 3.1.8) — the bare extlang subtag's Preferred-Value is its own spelling, so the
 * extlang record does not deprecate it (`aao` is a root, `ar-aao` is not).
 *
 * @param {any} artifact the parsed artifact
 * @returns {Promise<string[]>}
 */
async function ianaStructureProblems(artifact) {
  const problems = [];
  const registryPath = join(specDirectory, artifact.registry.path);
  const registryBytes = await readFile(registryPath);
  const registryDigest = createHash("sha256").update(registryBytes).digest("hex");
  if (registryDigest !== artifact.registry.sha256)
    return [`${artifact.registry.path} hashes to ${registryDigest}, not the ${artifact.registry.sha256} the artifact names`];

  // The record-jar, line by line: `%%` closes a record; `Name: value` opens a field; a line that starts
  // with whitespace continues the previous field. Only the five fields below matter here, and none of
  // them ever repeats within a record.
  const LANGUAGE_NAMESPACE = new Set(["language", "extlang", "grandfathered", "redundant"]);
  const deprecated = new Set();
  let record = {};
  let last = null;
  const close = () => {
    const type = record.Type?.toLowerCase();
    if (LANGUAGE_NAMESPACE.has(type) && record["Preferred-Value"] !== undefined) {
      const preferred = record["Preferred-Value"].trim().toLowerCase();
      const named = (record.Subtag ?? record.Tag ?? "").trim().toLowerCase();
      if (named !== "" && named !== preferred) deprecated.add(named);
      if (type === "extlang" && record.Prefix !== undefined) {
        const joined = `${record.Prefix.trim().toLowerCase()}-${named}`;
        if (joined !== preferred) deprecated.add(joined);
      }
    }
    record = {};
    last = null;
  };
  let inHeader = true;
  for (const line of registryBytes.toString("utf8").split("\n")) {
    if (line === "%%") { if (!inHeader) close(); inHeader = false; record = {}; last = null; continue; }
    if (inHeader) continue;
    if (/^[ \t]/.test(line)) { if (last !== null) record[last] += ` ${line.trim()}`; continue; }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon);
    if (["Type", "Subtag", "Tag", "Preferred-Value", "Prefix"].includes(name) && !(name in record)) {
      record[name] = line.slice(colon + 1).trim();
      last = name;
    } else last = null;
  }
  if (!inHeader) close();
  if (deprecated.size < 100)
    problems.push(`the registry reader found only ${deprecated.size} deprecated language-namespace tags; it is not reading the snapshot`);

  const classes = artifact.languageEquivalenceClasses;
  const owner = new Map();
  classes.forEach((members, index) => {
    for (const member of members) {
      if (owner.has(member)) problems.push(`${member} is in class ${owner.get(member)} (${classes[owner.get(member)][0]}) AND class ${index} (${members[0]}); classes must be disjoint`);
      else owner.set(member, index);
    }
    if (index > 0 && !(Buffer.compare(Buffer.from(classes[index - 1][0], "utf8"), Buffer.from(members[0], "utf8")) < 0))
      problems.push(`class ${index} (${members[0]}) does not sort strictly after class ${index - 1} (${classes[index - 1][0]}) by member 0, bytewise`);
    if (deprecated.has(members[0]))
      problems.push(`class ${index}'s member 0, ${members[0]}, is deprecated by a registry record; member 0 must be the class's one undeprecated member`);
    for (const member of members.slice(1))
      if (!deprecated.has(member))
        problems.push(`class ${index} (${members[0]}): ${member} is not member 0 and no registry record deprecates it`);
  });
  for (const tag of [...deprecated].sort())
    if (!owner.has(tag)) problems.push(`the registry deprecates ${tag} and it is in no class`);
  return problems;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
let failed = 0;

for (const { artifact, schema, dir } of CASES) {
  const schemaJson = JSON.parse(await readFile(join(specDirectory, "schema", schema), "utf8"));
  const rawBytes = await readFile(join(dir, artifact));
  const parsed = JSON.parse(rawBytes.toString("utf8"));

  const validate = ajv.compile(schemaJson);
  const valid = validate(parsed);
  const canonical = canonicalizationProblems(rawBytes, parsed);
  // Only on a schema-valid artifact: the structural reader assumes the shape the schema guarantees.
  const structure = valid && artifact === "iana-language-equivalences.json" ? await ianaStructureProblems(parsed) : [];

  if (valid && canonical.length === 0 && structure.length === 0) {
    console.log(`ok    ${artifact}  (${rawBytes.length.toLocaleString()} bytes, schema + JCS${artifact === "iana-language-equivalences.json" ? " + class structure against the registry" : ""})`);
    continue;
  }

  failed++;
  console.error(`FAIL  ${artifact}`);
  for (const error of validate.errors ?? [])
    console.error(`        schema: ${error.instancePath || "/"} ${error.message}`);
  for (const problem of canonical) console.error(`        canonical: ${problem}`);
  for (const problem of structure.slice(0, 20)) console.error(`        structure: ${problem}`);
  if (structure.length > 20) console.error(`        structure: … and ${structure.length - 20} more`);
}

process.exit(failed === 0 ? 0 : 1);
