#!/usr/bin/env node
// @ts-check
/**
 * Validates the vendored generated artifacts against their JSON Schemas, and re-checks the
 * canonical-serialization rules the schemas cannot express.
 *
 * JSON Schema constrains the parsed value. RFC 8785 JCS constrains the BYTES — key order, absence of
 * whitespace, no trailing newline. Both matter here, because non-JVM consumers hash these bytes, so
 * the byte-level checks are done separately rather than assumed.
 *
 *   node scripts/validate-artifacts.mjs
 */
import Ajv2020 from "ajv/dist/2020.js";
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

const ajv = new Ajv2020({ allErrors: true, strict: true });
let failed = 0;

for (const { artifact, schema, dir } of CASES) {
  const schemaJson = JSON.parse(await readFile(join(specDirectory, "schema", schema), "utf8"));
  const rawBytes = await readFile(join(dir, artifact));
  const parsed = JSON.parse(rawBytes.toString("utf8"));

  const validate = ajv.compile(schemaJson);
  const valid = validate(parsed);
  const canonical = canonicalizationProblems(rawBytes, parsed);

  if (valid && canonical.length === 0) {
    console.log(`ok    ${artifact}  (${rawBytes.length.toLocaleString()} bytes, schema + JCS)`);
    continue;
  }

  failed++;
  console.error(`FAIL  ${artifact}`);
  for (const error of validate.errors ?? [])
    console.error(`        schema: ${error.instancePath || "/"} ${error.message}`);
  for (const problem of canonical) console.error(`        canonical: ${problem}`);
}

process.exit(failed === 0 ? 0 : 1);
