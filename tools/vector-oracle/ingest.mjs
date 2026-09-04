#!/usr/bin/env node
// @ts-check
/**
 * Ingests authored fixtures and cases into `fixtures/` and `cases/`, refusing anything the oracle
 * could not execute.
 *
 * Every check here is one the Java library would otherwise raise at construction time, restated in
 * Node so a batch of authored vectors reports ALL of its problems at once with precise messages,
 * instead of dying on the first one after a JVM round trip.
 *
 * The checks are transcribed from DefaultStrings' own construction-time validation — notably that
 * tiebreaker lists must be an EXACT PERMUTATION of the loaded locales for their language code,
 * which is stricter than "provide tiebreakers when ambiguous" and is the error most likely to slip
 * through authoring.
 *
 *   node tools/vector-oracle/ingest.mjs <authored.json> [--dry-run]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [inputPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");

if (!inputPath) {
  console.error("usage: node tools/vector-oracle/ingest.mjs <authored.json> [--dry-run]");
  process.exit(2);
}

const CASE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const FIXTURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPERATIONS = new Set([
  "getResult", "get", "matchFor", "languageForms", "load", "parse", "loadClasspath", "loadClasspathResources",
  "construct", "acceptLanguage", "define",
  "cardinalityForNumber", "cardinalityForOperands", "cardinalityForRange",
  "ordinalityForNumber", "ordinalityForOperands",
  "supportedCardinalitiesForLocale", "supportedOrdinalitiesForLocale",
]);
const PARTITIONS = new Set(["requiredPortableIds", "requiredImplementationIds", "informationalIds"]);

/** Operations whose Java behavior depends on a JVM classpath, which no JS runtime has. */
const NONPORTABLE_OPERATIONS = new Set(["loadClasspath", "loadClasspathResources"]);

/**
 * Primary language subtag AFTER CLDR alias resolution.
 *
 * DefaultStrings keys its ambiguity map by the language of the LOADED locale, not by the filename,
 * and the two differ: `i-klingon` loads as `tlh`, `zh-min-nan` as `nan`, `iw` as `he`.
 *
 * This resolution is a GATING HEURISTIC, not a model of the loader. The corpus shows the loader
 * rewrites grandfathered tags and JDK legacy codes but does NOT apply CLDR aliases — `mo` loads as
 * `mo`, not `ro`; `sh`, `tl`, and `cmn` are likewise unchanged — so consulting the alias table
 * over-resolves. That is why any fixture touched by it is downgraded to advisory below and the Java
 * run, which reports every unbuildable fixture in one pass, is the authority.
 */
const LANGUAGE_ALIASES = (() => {
  const data = JSON.parse(readFileSync(join(spec, "vendor/lokalized-java/src/build/resources/cldr/cldr-locale-data.json"), "utf8"));
  const map = new Map();
  for (const { from, to } of data.aliases.language) map.set(from.toLowerCase(), to);
  return map;
})();

/** @returns {{language: string, aliased: boolean}} */
function resolveLanguage(tag) {
  const lower = tag.toLowerCase();
  const whole = LANGUAGE_ALIASES.get(lower);
  if (whole) return { language: whole.split("-")[0].toLowerCase(), aliased: true };
  const first = lower.split("-")[0];
  const mapped = LANGUAGE_ALIASES.get(first);
  if (mapped) return { language: mapped.split("-")[0].toLowerCase(), aliased: true };
  return { language: first, aliased: false };
}

const primaryLanguage = (tag) => resolveLanguage(tag).language;

/**
 * A private-use tag carries NO language code, so it can never make a language ambiguous.
 *
 * `LocaleUtils.languageForCanonicalTag` returns empty for a tag that is `x` or begins with `x-`
 * (LocaleUtils.java:101-105), and DefaultStrings keys its ambiguity map by language code — so Java
 * would never demand tiebreakers for two private-use catalogs, and would in fact REFUSE a tiebreaker
 * entry for them. Keying this gate on the tag's first subtag made `x-foo-bar` and `x-foo-baz` both
 * look like language `x` and demanded exactly the tiebreakers Java rejects, which forced fixture
 * authors to smuggle an unrelated alias-affected catalog in just to reach the advisory downgrade.
 */
const isPrivateUse = (tag) => {
  const lower = tag.toLowerCase();
  return lower === "x" || lower.startsWith("x-");
};

const problems = [];
const warnings = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

const authored = JSON.parse(readFileSync(inputPath, "utf8"));
const families = authored.families ?? [authored];

// Existing ids, so an ingest cannot silently collide with what is already in the corpus.
const existingFixtures = new Set(readdirSync(join(spec, "fixtures")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")));
const existingCases = new Set();
for (const file of readdirSync(join(spec, "cases")).filter((f) => f.endsWith(".cases.json")))
  for (const c of JSON.parse(readFileSync(join(spec, "cases", file), "utf8")).cases) existingCases.add(c.id);

const fixturesToWrite = new Map();
const casesByFamily = new Map();
const seenCaseIds = new Set();

for (const family of families) {
  const label = family.family ?? "unnamed";

  for (const fixture of family.fixtures ?? []) {
    const where = `${label} fixture ${fixture.id}`;
    if (!FIXTURE_ID.test(fixture.id ?? "")) { fail(where, `id must match ${FIXTURE_ID}`); continue; }
    if (fixturesToWrite.has(fixture.id)) { fail(where, "duplicate fixture id within this ingest"); continue; }
    if (existingFixtures.has(fixture.id)) {
      // Re-declaring an existing fixture is fine only if it is the SAME fixture: shared fixtures like
      // `no-catalog` are legitimately referenced by several families. A differing redeclaration would
      // silently change the meaning of every case already pointing at it, so that is refused.
      const onDisk = JSON.parse(readFileSync(join(spec, "fixtures", `${fixture.id}.json`), "utf8"));
      const identity = (f) => JSON.stringify({
        files: f.files, tiebreakers: f.tiebreakers ?? null, fallbackLocale: f.fallbackLocale,
        instanceLocale: f.instanceLocale ?? f.fallbackLocale, loadingOptions: f.loadingOptions ?? null,
        translationFailureHandler: f.translationFailureHandler ?? null,
        translationFallbackPolicy: f.translationFallbackPolicy ?? null, phoneticResolver: f.phoneticResolver ?? null,
        runtimeLimits: f.runtimeLimits ?? null, bidiIsolation: f.bidiIsolation ?? null,
      });
      const same = identity(onDisk) === identity(fixture);
      if (!same) fail(where, "redeclares an existing fixture with different contents; rename it or reuse the existing one");
      continue;
    }
    const fileCount = Object.keys(fixture.files ?? {}).length
      + Object.keys(fixture.rawFiles ?? {}).length + Object.keys(fixture.rawFilesBase64 ?? {}).length;
    if (fileCount === 0) { fail(where, "no files, rawFiles, or rawFilesBase64"); continue; }
    if (!fixture.fallbackLocale) { fail(where, "no fallbackLocale"); continue; }

    // Only JSON `files` are locale-tagged catalogs. rawFiles/rawFilesBase64 are named by FILENAME and
    // exist to be parsed or to make a load fail, so they take no part in the tiebreaker analysis.
    const loaded = Object.keys(fixture.files ?? {});

    // DefaultStrings requires tiebreakers whenever a language code has more than one loaded locale,
    // and requires any provided list to be an exact permutation of that language's loaded locales.
    const byLanguage = new Map();
    for (const tag of loaded) {
      if (isPrivateUse(tag)) continue;
      const language = primaryLanguage(tag);
      if (!byLanguage.has(language)) byLanguage.set(language, []);
      byLanguage.get(language).push(tag);
    }
    const tiebreakers = fixture.tiebreakers ?? {};

    // Full CLDR canonicalization is more than language aliasing — region aliases can be multi-valued
    // and are resolved through likely-subtags. Where any filename is alias-affected this check cannot
    // predict the loaded tag exactly, so its findings are advisory and the Java run is the authority;
    // it now reports every unbuildable fixture in one pass. For ordinary fixtures the check stays fatal.
    // A loadOnly fixture never constructs a Strings, so DefaultStrings' tiebreaker rule cannot fire
    // for it and enforcing that rule would reject fixtures that are deliberately unloadable.
    // A refusesConstruction fixture exists to be REFUSED by DefaultStrings' constructor, so enforcing
    // the tiebreaker permutation rule against it would reject the very inputs it is here to specify.
    // The exemption is paid for below: such a fixture must be referenced by a `construct` case and by
    // nothing else, so it can never become the "fixture nobody references" that closes a branch while
    // specifying nothing.
    // Every constructionOverrides value names a refusal, so a fixture carrying one that does not also
    // declare refusesConstruction would be asserting a success the oracle cannot produce.
    if (fixture.constructionOverrides && fixture.refusesConstruction !== true)
      fail(where, "sets constructionOverrides but not refusesConstruction; every override names a "
        + "DefaultStrings validation that REFUSES the configuration");

    const aliasAffected = loaded.some((tag) => resolveLanguage(tag).aliased)
      || fixture.loadOnly === true || fixture.refusesConstruction === true;
    const report = aliasAffected
      ? (w, m) => warnings.push(`${w}: ${m} [advisory: fixture uses alias-affected tags; Java decides]`)
      : fail;

    for (const [language, tags] of byLanguage) {
      const provided = tiebreakers[language];
      if (tags.length > 1 && (!provided || provided.length === 0)) {
        report(where, `loads ${tags.length} locales for language '${language}' (${tags.join(", ")}) but supplies no tiebreakers — DefaultStrings will refuse to build`);
        continue;
      }
      if (!provided) continue;
      const wanted = [...tags].sort().join(",");
      const got = [...provided].sort().join(",");
      if (wanted !== got)
        report(where, `tiebreakers for '${language}' must be an exact permutation of its loaded locales [${tags.join(", ")}]; got [${provided.join(", ")}]`);
      for (const tag of provided)
        if (primaryLanguage(tag) !== language) report(where, `tiebreaker '${tag}' listed under language '${language}' but its primary language is '${primaryLanguage(tag)}'`);
    }
    for (const language of Object.keys(tiebreakers))
      if (!byLanguage.has(language)) report(where, `tiebreakers name language '${language}', which has no loaded locales`);

    if (loaded.length > 0 && !loaded.includes(fixture.fallbackLocale))
      warnings.push(`${where}: fallbackLocale '${fixture.fallbackLocale}' is not among the loaded files [${loaded.join(", ")}]`);

    fixturesToWrite.set(fixture.id, {
      id: fixture.id,
      description: fixture.description ?? "",
      fallbackLocale: fixture.fallbackLocale,
      ...(fixture.instanceLocale && fixture.instanceLocale !== fixture.fallbackLocale ? { instanceLocale: fixture.instanceLocale } : {}),
      tiebreakers: fixture.tiebreakers ?? null,
      ...(fixture.loadingOptions ? { loadingOptions: fixture.loadingOptions } : {}),
      ...(fixture.translationFailureHandler ? { translationFailureHandler: fixture.translationFailureHandler } : {}),
      ...(fixture.translationFallbackPolicy ? { translationFallbackPolicy: fixture.translationFallbackPolicy } : {}),
      ...(fixture.runtimeLimits ? { runtimeLimits: fixture.runtimeLimits } : {}),
      ...(fixture.phoneticResolver ? { phoneticResolver: fixture.phoneticResolver } : {}),
      ...(fixture.localeSupplier ? { localeSupplier: fixture.localeSupplier } : {}),
      ...(fixture.localeMatchSupplier ? { localeMatchSupplier: fixture.localeMatchSupplier } : {}),
      ...(fixture.bidiIsolation ? { bidiIsolation: fixture.bidiIsolation } : {}),
      ...(fixture.loadOnly ? { loadOnly: true } : {}),
      ...(fixture.refusesConstruction ? { refusesConstruction: true } : {}),
      ...(fixture.constructionOverrides ? { constructionOverrides: fixture.constructionOverrides } : {}),
      files: fixture.files ?? {},
      ...(fixture.rawFiles ? { rawFiles: fixture.rawFiles } : {}),
      ...(fixture.rawFilesBase64 ? { rawFilesBase64: fixture.rawFilesBase64 } : {}),
    });
  }

  const cases = [];
  for (const testCase of family.cases ?? []) {
    const where = `${label} case ${testCase.id}`;
    if (!CASE_ID.test(testCase.id ?? "")) { fail(where, `id must match ${CASE_ID}`); continue; }
    if (existingCases.has(testCase.id) || seenCaseIds.has(testCase.id)) { fail(where, "duplicate case id"); continue; }
    if ("expected" in testCase) { fail(where, "carries a hand-written 'expected'; the oracle produces those"); continue; }
    if (!OPERATIONS.has(testCase.operation)) { fail(where, `unknown operation '${testCase.operation}'`); continue; }
    if (!PARTITIONS.has(testCase.partition)) { fail(where, `unknown partition '${testCase.partition}'`); continue; }
    // Plan 8.2 puts explicitly nonportable cases in `informationalIds`, which "may be unsupported and
    // never enter either numerator", and requires every `requiredPortableId` to pass with an EMPTY
    // unsupported set before a strict parity-backed release. A classpath case can never satisfy that
    // -- no JS runtime has a classpath -- so partitioning one as required makes the release condition
    // unsatisfiable for reasons that have nothing to do with the port. 145 cases were partitioned that
    // way; lokalized-js/tools/conformance.mjs reported it every run and nothing consumed the report.
    // Refused at ingest so it cannot come back one case at a time.
    if (NONPORTABLE_OPERATIONS.has(testCase.operation) && testCase.partition !== "informationalIds") {
      fail(where, `operation '${testCase.operation}' has no JS counterpart, so it must be partitioned `
        + `'informationalIds', not '${testCase.partition}' (plan 8.2)`);
      continue;
    }
    if (!fixturesToWrite.has(testCase.fixture) && !existingFixtures.has(testCase.fixture)) {
      fail(where, `names fixture '${testCase.fixture}', which neither exists nor is being ingested`);
      continue;
    }
    // Presence, not truthiness: "" is a legitimate key to test, and the degenerate-key clauses use it.
    if ((testCase.operation === "getResult" || testCase.operation === "get") && typeof testCase.input?.key !== "string") { fail(where, `${testCase.operation} needs an input.key`); continue; }
    if (testCase.operation === "parse" && (!testCase.input?.file || !testCase.input?.locale)) { fail(where, "parse needs input.file and input.locale"); continue; }
    if (testCase.operation === "loadClasspathResources" && !testCase.input?.resources) { fail(where, "loadClasspathResources needs input.resources"); continue; }
    // PRESENCE, not truthiness. `null` (the header is absent from the request) and `""` (the header is
    // present and empty) are both meaningful inputs to bestMatchForAcceptLanguage and both falsy, and
    // they take DIFFERENT paths through it -- null short-circuits at LocaleMatcher:118, "" reaches the
    // trim check at :120. Omitting the key would silently become "null" and quietly merge the two.
    if (testCase.operation === "acceptLanguage") {
      const input = testCase.input ?? {};
      if (!("header" in input) || (input.header !== null && typeof input.header !== "string")) {
        fail(where, "acceptLanguage needs an input.header that is a string or an explicit null; an absent "
          + "header is spelled `\"header\": null`, never by omitting the key");
        continue;
      }
    }

    // THE PER-CALL OVERRIDE ORDER. TranslationOptions.Builder.locale and .languageRanges each NULL the
    // other when handed a non-null value (TranslationOptions.java:309-313, :330-333), so a call that
    // sets both is decided by APPLICATION ORDER and its private constructor's both-present guard
    // (:70-71) is dead by construction. Two corpus rows recorded the range-driven answer as though it
    // were THE answer for a both-present call; it was the answer for the order VectorOracle.optionsFrom
    // happened to hard-code, and reversing those two lines reverses the outcome. The order is now stated
    // by the case in a JSON ARRAY -- ordered by construction, unlike the object key order of `input`,
    // which is the accident being removed.
    //
    // PRESENT means "will actually be applied". `"languageRanges": null` is a present key that sets
    // nothing (VectorOracle.languageRangesFrom returns null for it), so the two owed-null-options rows
    // carrying a locale beside an explicit null range have no order to state and are refused one.
    {
      const input = testCase.input ?? {};
      const declared = Object.prototype.hasOwnProperty.call(input, "perCallOverrideOrder");
      const localePresent = typeof input.locale === "string";
      const rangesPresent = input.languageRanges !== undefined && input.languageRanges !== null;
      const buildsOptions = testCase.operation === "getResult" || testCase.operation === "get";
      const orderDecides = buildsOptions && localePresent && rangesPresent;

      // matchFor has no TranslationOptions. There `locale` and `languageRanges` select an OVERLOAD, and
      // VectorOracle's ternary silently prefers ranges -- the same implied precedence, with no order to
      // state because nothing clears anything. Refused rather than ordered.
      if (testCase.operation === "matchFor" && localePresent && rangesPresent) {
        fail(where, "matchFor input carries both a locale and languageRanges; those name two different "
          + "OVERLOADS, not two overrides, so the case must ask exactly one");
        continue;
      }
      if (orderDecides) {
        const order = input.perCallOverrideOrder;
        const wanted = ["languageRanges", "locale"];
        if (!Array.isArray(order) || order.length !== 2 || [...order].sort().join(",") !== wanted.join(",")) {
          fail(where, "presents both a locale and a non-null languageRanges, whose TranslationOptions.Builder "
            + "setters clear each other, so the outcome is decided by APPLICATION ORDER; state it as "
            + '`"perCallOverrideOrder": ["locale", "languageRanges"]` (ranges win) or the reverse (locale wins)');
          continue;
        }
        // The SAME invariant the classpath rule above enforces, and it was the whole justification for
        // moving these rows to `informationalIds` -- stated in a slice report and enforced by nothing,
        // which is exactly how the 145 mis-partitioned classpath cases survived. Plan 8.2 requires
        // every `requiredPortableId` to pass with an EMPTY unsupported set. Both application orders of
        // a both-present call are in the corpus and they answer DIFFERENTLY, so no single JS call --
        // whose options are an object literal with no application order at all -- can satisfy both;
        // and the port's standing obligation for that shape is to REFUSE it (TranslationOptions#<init>
        // :70, dispositioned `required`, permanently). A row that cannot be satisfied and must not be
        // satisfied can never be required. lokalized-js keeps the matching half of this rule: a
        // passing order-carrying row is never banked in its conformance ratchet.
        if (testCase.partition !== "informationalIds") {
          fail(where, "carries perCallOverrideOrder, so it records one APPLICATION ORDER of a shape whose "
            + "orders disagree and which the port is obliged to refuse; it must be partitioned "
            + `'informationalIds', not '${testCase.partition}' (plan 8.2)`);
          continue;
        }
      } else if (declared) {
        // Inert rather than wrong is still wrong: a field that decides nothing reads as though it does.
        fail(where, "declares perCallOverrideOrder, which decides nothing here; it is meaningful only on a "
          + "getResult/get case whose input presents BOTH a locale and a non-null languageRanges");
        continue;
      }
    }

    // `define` hands a HAND-BUILT LocalizedString to DefaultStrings$LocalizedStringSet.contains, which
    // does `localizedStringsByKey.get(probe.getKey())` and then `probe.equals(candidate)`. If the probe's
    // key is not a key of the named locale's catalog, the lookup answers null and equals returns at
    // LocalizedString:140 WITHOUT reaching a single field comparison -- so the row records contains=false
    // for a reason that has nothing to do with equality, reads exactly like discrimination, and closes
    // nothing. That is the zh-123 shape wearing a different hat, and it is refused here.
    //
    // The exception is a probe that cannot be BUILT at all: <init>:110 and ExpressionTranslation:871 are
    // the two construction refusals this operation also specifies, and for those `contains` is never
    // reached, so demanding a matching catalog key would reject the very inputs they need. Whether the
    // model constructs is decided structurally below, restating Java's two rules in Node the same way the
    // tiebreaker permutation rule is restated above.
    if (testCase.operation === "define") {
      const input = testCase.input ?? {};
      const model = input.localizedString;
      if (typeof input.locale !== "string" || model === null || typeof model !== "object" || Array.isArray(model)
          || typeof model.key !== "string") {
        fail(where, "define needs an input.locale and an input.localizedString object carrying a string 'key'");
        continue;
      }
      const fixture = fixturesToWrite.get(testCase.fixture)
        ?? JSON.parse(readFileSync(join(spec, "fixtures", `${testCase.fixture}.json`), "utf8"));
      const catalog = (fixture.files ?? {})[input.locale];
      if (!catalog) {
        fail(where, `names locale '${input.locale}', which fixture '${testCase.fixture}' does not load`);
        continue;
      }
      // Java's LocalizedString constructor: a node needs a translation or at least one alternative.
      // Java's ExpressionTranslation(String, List): the list must not be empty.
      const constructible = (node) => {
        const alternatives = Array.isArray(node.alternatives) ? node.alternatives : [];
        const bodies = alternatives.flatMap((a) => Object.values(a ?? {}));
        if ((node.translation === undefined || node.translation === null) && bodies.length === 0) return false;
        for (const body of bodies)
          if (body !== null && typeof body === "object" && !constructible(body)) return false;
        for (const definition of Object.values(node.placeholders ?? {}))
          if (definition && typeof definition === "object" && Array.isArray(definition.alternatives)
              && definition.alternatives.length === 0) return false;
        return true;
      };
      if (constructible(model) && !Object.prototype.hasOwnProperty.call(catalog, model.key)) {
        fail(where, `probes key '${model.key}', which locale '${input.locale}' of fixture `
          + `'${testCase.fixture}' does not define; contains() would answer false at the null-candidate `
          + `guard without reaching a single field comparison, so the case would close nothing`);
        continue;
      }
    }

    seenCaseIds.add(testCase.id);
    cases.push({
      id: testCase.id,
      requirementIds: [],
      fixture: testCase.fixture,
      operation: testCase.operation,
      input: testCase.input ?? {},
      partition: testCase.partition,
      ...(testCase.notes ? { notes: testCase.notes } : {}),
    });
  }
  if (cases.length > 0) casesByFamily.set(label, { family: label, cases, skipped: family.skipped ?? [] });
}

// The refusesConstruction exemption, paid for. A fixture that skips the tiebreaker rule must be the
// SUBJECT of a construct case; otherwise it is an unreferenced fixture whose refusal nobody observes,
// which is the shape that closes a coverage branch while specifying nothing. Any other operation
// against it is also refused: main() pre-builds fixtures and aborts the whole run when a case that
// needs a Strings names one that could not be built, so the mistake would look like an oracle crash.
{
  const referencedBy = new Map();
  for (const { cases } of casesByFamily.values())
    for (const c of cases) {
      if (!referencedBy.has(c.fixture)) referencedBy.set(c.fixture, new Set());
      referencedBy.get(c.fixture).add(c.operation);
    }
  for (const [id, fixture] of fixturesToWrite) {
    if (!fixture.refusesConstruction) continue;
    const operations = referencedBy.get(id);
    if (!operations || !operations.has("construct"))
      fail(`fixture ${id}`, "declares refusesConstruction but no 'construct' case in this batch names it; "
        + "the exemption from the tiebreaker rule is only earned by a case that observes the refusal");
    else if (operations.size > 1)
      fail(`fixture ${id}`, `declares refusesConstruction but is also used by [${[...operations].filter((o) => o !== "construct").join(", ")}]; `
        + "a fixture whose construction is refused cannot serve any other operation");
  }
}

for (const warning of warnings) console.warn(`warn  ${warning}`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s); nothing written:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

if (dryRun) {
  console.log(JSON.stringify({ status: "dry-run-ok", fixtures: fixturesToWrite.size, cases: seenCaseIds.size, families: casesByFamily.size, warnings: warnings.length }));
  process.exit(0);
}

for (const [id, fixture] of fixturesToWrite)
  writeFileSync(join(spec, "fixtures", `${id}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

for (const [label, { cases, skipped }] of casesByFamily) {
  const file = join(spec, "cases", `${label}.cases.json`);
  writeFileSync(file, `${JSON.stringify({
    formatVersion: 1,
    family: label,
    description: `Plan v7 section 8.3 fixture family '${label}'. Inputs only; the oracle emits expected.`,
    ...(skipped.length > 0 ? { skipped } : {}),
    cases,
  }, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ status: "written", fixtures: fixturesToWrite.size, cases: seenCaseIds.size, families: casesByFamily.size, warnings: warnings.length }));
