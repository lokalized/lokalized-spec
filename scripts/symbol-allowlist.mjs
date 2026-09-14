#!/usr/bin/env node
// @ts-check
/**
 * Generates the machine-readable symbol allowlist required by plan v7 section 3.1
 * ("The export map and generated declarations are checked against a machine-readable
 * symbol allowlist"), and verifies a checked-in copy against its sources.
 *
 * Everything here is DERIVED, never transcribed: subpaths and owners come from the plan's own
 * tables, and the 61 language-form constants come from the Java enums cross-checked against the
 * published JSON schema. A hand-copied allowlist would drift from the plan silently, which is the
 * failure this file exists to prevent.
 *
 *   node scripts/symbol-allowlist.mjs --write
 *   node scripts/symbol-allowlist.mjs --check
 */
import { planPath as resolvePlanPath } from "./planning-path.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const specDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const javaDirectory = process.env.LOKALIZED_JAVA_DIR
  ? resolve(process.env.LOKALIZED_JAVA_DIR)
  : resolve(specDirectory, "../lokalized-java");
const PLAN = resolvePlanPath();
const OUTPUT = join(specDirectory, "symbol-allowlist.json");

/**
 * Axis name -> constant prefix, as used in strings files. This mapping is NOT mechanical:
 * GrammaticalCase uses CASE_, not GRAMMATICAL_CASE_. Every entry is verified below against the
 * published JSON schema, so a wrong prefix fails rather than silently producing wrong names.
 */
const FORM_AXES = {
  Animacy: "ANIMACY",
  Cardinality: "CARDINALITY",
  Classifier: "CLASSIFIER",
  Clusivity: "CLUSIVITY",
  Definiteness: "DEFINITENESS",
  Formality: "FORMALITY",
  Gender: "GENDER",
  GrammaticalCase: "CASE",
  Ordinality: "ORDINALITY",
  Phonetic: "PHONETIC",
};

async function languageFormConstants() {
  /** @type {Record<string, string[]>} */
  const byAxis = {};
  for (const [axis, prefix] of Object.entries(FORM_AXES)) {
    const source = await readFile(join(javaDirectory, `src/main/java/com/lokalized/${axis}.java`), "utf8");
    const body = source.slice(source.indexOf(`public enum ${axis}`));
    const names = [...body.matchAll(/^[\t ]{1,2}([A-Z][A-Z_]*)[,;]/gm)].map((m) => m[1]);
    byAxis[axis] = names.map((n) => `${prefix}_${n}`);
  }

  // Cross-check against the published schema. Two independent sources must agree exactly.
  const schema = await readFile(
    join(javaDirectory, "src/main/resources/schema/lokalized-strings.schema.json"),
    "utf8",
  );
  const prefixes = Object.values(FORM_AXES).join("|");
  const fromSchema = new Set([...schema.matchAll(new RegExp(`"((?:${prefixes})_[A-Z_]+)"`, "g"))].map((m) => m[1]));
  const derived = new Set(Object.values(byAxis).flat());

  const onlyDerived = [...derived].filter((n) => !fromSchema.has(n));
  const onlySchema = [...fromSchema].filter((n) => !derived.has(n));
  if (onlyDerived.length || onlySchema.length)
    throw new Error(
      `language-form constants disagree with the schema; only-derived=${onlyDerived} only-schema=${onlySchema}`,
    );

  return { byAxis, all: [...derived].sort() };
}

/** Rows of a GitHub-flavoured markdown table, as arrays of trimmed cells. */
function tableRows(markdown) {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|[\s:|-]+\|$/.test(line))
    .map((line) => line.slice(1, line.lastIndexOf("|")).split("|").map((c) => c.trim()));
}

async function build() {
  const plan = await readFile(PLAN, "utf8");
  const section = plan.slice(plan.indexOf("### 3.1"), plan.indexOf("### 3.2"));
  const rows = tableRows(section);

  // Table 1: npm subpath | contents | Browser | Edge | Node
  const subpaths = rows
    .filter((r) => r.length === 5 && /^`lokalized(\/|`)/.test(r[0]))
    .map((r) => ({
      subpath: r[0].replace(/`/g, ""),
      contents: r[1],
      browser: r[2].toLowerCase().startsWith("yes"),
      edge: r[3].toLowerCase().startsWith("yes"),
      node: r[4].toLowerCase().startsWith("yes"),
    }));

  // Table 2: canonical owner | public symbols | re-exported by root?
  //
  // THE DISOWNING CLAUSE IS SPLIT OFF FIRST, AND THAT IS THE WHOLE CORRECTION HERE. Plan 3.1's
  // `load` row ends "it consumes but does not re-own or re-export core's `CatalogIdentity` and
  // `StringsLoadCoverage`" — a NEGATIVE claim naming two symbols. The previous parser scanned the
  // whole cell for backticked names, so it hoisted both into `namedSymbols` and recorded `load` as
  // OWNING exactly the two symbols the plan says it does not own. That is not a cosmetic loss: the
  // port's delivery gate reads `namedSymbols` and DEMANDS every entry, so the inverted negation was
  // enforced — ablated 2026-09-14, removing the two type re-exports from `lokalized/load` turns
  // `test/declared-surface.test.js` red naming `load:CatalogIdentity` and `load:StringsLoadCoverage`.
  // A parser that reads a prohibition as a promise is worse than one that ignores the clause.
  const DISOWNING = /(?:it )?consumes but does not re-own or re-export [a-z]+'s\s*/i;
  const owners = rows
    .filter((r) => r.length === 3 && /^`[a-z/]+`$/.test(r[0]))
    .map((r) => {
      const segments = r[1].split(";").map((segment) => segment.trim());
      const owning = segments.filter((segment) => !DISOWNING.test(segment));
      const disowning = segments.filter((segment) => DISOWNING.test(segment));
      // REFUSE an unrecognised shape rather than approximate it. A second disowning clause, or one
      // naming no symbol, means the plan says something this parser has not been taught to read, and
      // a generator that guesses is how the inverted negation shipped in the first place.
      if (disowning.length > 1)
        throw new Error(`${r[0]}: two disowning clauses; this parser reads one`);
      const disowned = disowning.length
        ? [...disowning[0].matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1])
        : [];
      if (disowning.length && !disowned.length)
        throw new Error(`${r[0]}: a disowning clause naming no symbol: ${disowning[0]}`);

      const named = owning.flatMap((segment) =>
        [...segment.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]));
      // Prose groups that are not yet individually enumerable, recorded VERBATIM — which the
      // previous version's comment claimed and its code did not do: it ran `.replace(/`[^`]*`/g, "")`
      // over the cell first, deleting every backticked name from the prose. The one category whose
      // content IS a name came out as "re-exports core's  type and IANA metadata", with a hole where
      // `LanguageRange` had been, while a test's own comment quoted the intact sentence.
      const categories = owning
        .flatMap((segment) => segment.split(","))
        .map((segment) => segment.trim().replace(/^and\s+/i, ""))
        .filter((segment) => segment.length > 3 && !/^`[^`]*`$/.test(segment));
      return {
        owner: r[0].replace(/`/g, ""),
        namedSymbols: [...new Set(named)].sort(),
        /** Named by the plan as explicitly NOT owned or re-exported. A prohibition, not a promise. */
        disownedSymbols: [...new Set(disowned)].sort(),
        unenumeratedCategories: categories,
        reExportedByRoot: r[2].toLowerCase().startsWith("yes"),
      };
    });

  const forms = await languageFormConstants();

  return {
    formatVersion: 1,
    planSection: "3.1",
    generatedFrom: {
      plan: "IMPLEMENTATION-PLAN-v7.md",
      javaEnums: Object.keys(FORM_AXES),
      schemaCrossCheck: "src/main/resources/schema/lokalized-strings.schema.json",
    },
    subpaths,
    owners,
    rootReExportsOwners: owners.filter((o) => o.reExportedByRoot).map((o) => o.owner),
    languageFormConstants: forms.all,
    languageFormConstantsByAxis: forms.byAxis,
    // Section 3.1: these "do not appear in the export map until implemented".
    deferredSubpaths: ["lokalized/react", "lokalized/locale-intl", "lokalized/cardinality-intl"],
  };
}

const allowlist = await build();
const serialized = `${JSON.stringify(allowlist, null, 2)}\n`;

if (process.argv.includes("--write")) {
  await writeFile(OUTPUT, serialized);
  console.log(
    JSON.stringify({
      status: "written",
      subpaths: allowlist.subpaths.length,
      owners: allowlist.owners.length,
      namedSymbols: allowlist.owners.reduce((n, o) => n + o.namedSymbols.length, 0),
      disownedSymbols: allowlist.owners.reduce((n, o) => n + o.disownedSymbols.length, 0),
      unenumeratedCategories: allowlist.owners.reduce((n, o) => n + o.unenumeratedCategories.length, 0),
      languageFormConstants: allowlist.languageFormConstants.length,
    }),
  );
} else if (process.argv.includes("--check")) {
  let existing;
  try {
    existing = await readFile(OUTPUT, "utf8");
  } catch {
    console.error("symbol-allowlist.json is missing; run --write");
    process.exit(1);
  }
  if (existing !== serialized) {
    console.error("symbol-allowlist.json is out of date with the plan or the Java enums; run --write");
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "current", subpaths: allowlist.subpaths.length }));
} else {
  console.error("usage: node scripts/symbol-allowlist.mjs --write | --check");
  process.exit(2);
}
