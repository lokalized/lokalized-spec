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

  // --- THE WHOLE PLAN'S DECLARED SURFACE, not just section 3.1's table ---------------------------
  //
  // `owners` above is derived from ONE markdown table in section 3.1, and for five milestones that
  // was the only thing any surface gate could see. MEASURED 2026-09-14: the plan declares 156 more
  // symbols by SIGNATURE, across eleven sections — §2.5, 3.2-3.7, 4.1, 6.1, 6.2 and 6.4 — and
  // nothing had ever compared that set to what the port delivers. What it cost: `createStrings({
  // loaded })`, M8's flagship call, did not typecheck for a consumer, and plan 3.5's nine declared
  // error classes had shipped as three.
  //
  // A DECLARATION IS NOT AN EXAMPLE, and the two share a fence. `const X: Type;` is a declaration;
  // `const x = await loadStrings(...)` is a usage snippet in the same `~~~ts` block. Keyed on the
  // colon, which is what separates them — verified against §6.2's example fence, whose six bindings
  // are excluded and named below so the exclusion is visible rather than silent.
  const declared = [];
  const examples = [];
  {
    const lines = plan.split("\n");
    let open = false, info = "", start = 0, section = "";
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/^#{2,3} /.test(line) && !open) section = line.replace(/^#+\s*/, "").split(" ")[0];
      const fence = line.match(/^~~~(\w*)/);
      if (!fence) continue;
      if (!open) { open = true; info = fence[1]; start = index; continue; }
      open = false;
      if (info !== "ts") continue;
      for (let offset = 1; start + offset < index; offset++) {
        const body = lines[start + offset];
        const at = start + offset + 1;
        let match;
        if ((match = body.match(/^\s*(?:export\s+)?(interface|class|enum)\s+([A-Za-z_]\w*)/)))
          declared.push({ name: match[2], kind: match[1], section, line: at });
        else if ((match = body.match(/^\s*(?:export\s+)?type\s+([A-Za-z_]\w*)\s*=/)))
          declared.push({ name: match[1], kind: "type", section, line: at });
        else if ((match = body.match(/^\s*(?:export\s+)?function\s+([A-Za-z_]\w*)\s*[(<]/)))
          declared.push({ name: match[1], kind: "function", section, line: at });
        else if ((match = body.match(/^\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*:/)))
          declared.push({ name: match[1], kind: "const", section, line: at });
        else if ((match = body.match(/^\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*=/)))
          examples.push(match[1]);
      }
    }
  }

  // THE INVERSE TRAP, AND IT IS WHY THIS LIST EXISTS. A name can be declared in a fence exactly like
  // an export and then narrowed to NON-export in PROSE only. `CatchOnlyErrorClass` is declared
  // `interface` at 3.5:1086 and denied at :1109 — "a declaration-private helper, not a package
  // export" — with nothing in the fence to say so. Each entry names the plan line that narrows it,
  // and a name here that the plan STOPS narrowing fails the build rather than staying excluded.
  const NOT_A_PACKAGE_EXPORT = {
    CatchOnlyErrorClass: "is a declaration-private helper, not a package export",
  };
  for (const [name, sentence] of Object.entries(NOT_A_PACKAGE_EXPORT)) {
    if (!plan.includes(`\`${name}\` ${sentence}`))
      throw new Error(`NOT_A_PACKAGE_EXPORT claims the plan says "\`${name}\` ${sentence}" and it does not`);
    if (!declared.some((entry) => entry.name === name))
      throw new Error(`NOT_A_PACKAGE_EXPORT names '${name}', which no fence declares`);
  }

  const seen = new Set();
  const planDeclaredSymbols = declared
    .filter((entry) => !NOT_A_PACKAGE_EXPORT[entry.name])
    .filter((entry) => (seen.has(entry.name) ? false : (seen.add(entry.name), true)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const forms = await languageFormConstants();

  return {
    formatVersion: 1,
    planSection: "3.1",
    /** Every symbol the plan declares by SIGNATURE, in any section. See the derivation above. */
    planDeclaredSymbols,
    /** Bindings in example fences, excluded by the colon rule. Recorded so the exclusion is visible. */
    planExampleBindings: [...new Set(examples)].sort(),
    /** Declared in a fence and denied in prose. Keys are checked against the plan sentence. */
    notPackageExports: Object.keys(NOT_A_PACKAGE_EXPORT).sort(),
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
      planDeclaredSymbols: allowlist.planDeclaredSymbols.length,
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
