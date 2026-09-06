#!/usr/bin/env node
// @ts-check
/**
 * Emits the candidate range space the JDK oracle is probed with.
 *
 * Kept separate and deterministic because the candidate space is part of the artifact's provenance:
 * a closure is only as complete as the inputs it was probed with, so the space is hashed and locked
 * alongside the result.
 *
 * THE SPACE HAS TWO SOURCES, AND THE SECOND IS THE ONE THAT MAKES IT COMPLETE.
 *
 *  1. The pinned CLDR data — every valid language, every alias key and value and their subtags, and
 *     `<prefix>-<language>` for twelve macrolanguage prefixes where extlang equivalences live. This
 *     is a GUESS at the shape of the JDK's equivalence table, and it is kept because it probes two
 *     orders of magnitude more ranges than the table has keys, which is what exercises the prefix
 *     walk and the region/variant map.
 *
 *  2. Every key of the JDK's own `sun.util.locale.LocaleEquivalentMaps` language tables, dumped by
 *     `EquivalenceKeys.java` into `jdk-equivalence-keys.txt`. This is not a guess.
 *
 * Source 1 alone was wrong in four places — `cmn-hans` and `cmn-hant` are prefix-plus-SCRIPT rather
 * than prefix-plus-language, and `lv-lvs`/`lv-ltg` need an `lv` prefix the list does not carry — so
 * those four keys were never probed and never reached the artifact. Neither the generator's
 * losslessness check nor the port's differential could see it: the check verifies that every PROBED
 * range reconstructs, and the differential's probe space was itself derived from the artifact under
 * test. A probe space derived from the thing being tested cannot see what that thing is missing.
 *
 * WHY SOURCE 2 IS NOT SELF-REFERENTIAL. `LocaleEquivalentMaps` is the JDK's INPUT data, reached by
 * reflection. The artifact is the OUTPUT of `Locale.LanguageRange.parse` over this space. Two
 * different objects, two different paths — so a gap in the extracted closure cannot hide inside the
 * probe space that produced it. `build.mjs` then asserts the completeness this buys: every dumped
 * key must appear in the raw closure, which turns "the space is wide enough" from an argument into
 * a checked invariant.
 *
 * The dump FAILS LOUDLY rather than falling back to source 1. A probe space that quietly shrinks
 * when the pinned JDK moves is the failure this file exists to prevent.
 *
 *   node tools/iana-oracle/candidates.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const spec = resolve(here, "../..");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";

const locale = JSON.parse(
  readFileSync(join(spec, "vendor/lokalized-java/src/build/resources/cldr/cldr-locale-data.json"), "utf8"),
);

/* ---------------------------------------------------------------- source 2 */

const keysPath = join(here, "jdk-equivalence-keys.txt");
// `--add-exports` names the internal class; `--add-opens` permits `setAccessible`. Both required.
const dump = spawnSync(
  join(JDK, "bin/java"),
  [
    "--add-exports", "java.base/sun.util.locale=ALL-UNNAMED",
    "--add-opens", "java.base/sun.util.locale=ALL-UNNAMED",
    join(here, "EquivalenceKeys.java"),
    keysPath,
  ],
  { encoding: "utf8" },
);
if (dump.status !== 0)
  throw new Error(
    `could not read the JDK's own equivalence keys at ${JDK}, so the probe space would be incomplete ` +
      `in exactly the way this generator was rewritten to prevent:\n${dump.stderr}`,
  );
const jdkKeys = readFileSync(keysPath, "utf8").split("\n").filter(Boolean);

/* ---------------------------------------------------------------- source 1 */

const candidates = new Set(locale.validity.languages);
for (const group of Object.values(locale.aliases)) {
  for (const { from, to } of /** @type {{from: string, to: string}[]} */ (group)) {
    for (const tag of [from, to]) {
      candidates.add(tag);
      for (const part of tag.split("-")) candidates.add(part);
    }
  }
}
// Extlang equivalences live under a macrolanguage prefix, so probe those combinations explicitly.
const PREFIXES = ["ar", "cmn", "i", "kok", "ms", "no", "sgn", "sr", "sw", "uz", "yue", "zh"];
const languages = [...locale.validity.languages].filter((l) => l.length >= 2 && l.length <= 3);
for (const prefix of PREFIXES) for (const l of languages) candidates.add(`${prefix}-${l}`);

/* ------------------------------------------------------------------- union */

const fromCldr = candidates.size;
for (const key of jdkKeys) candidates.add(key);

const clean = [...candidates].filter((c) => c && /^[A-Za-z0-9-]+$/.test(c)).sort();
writeFileSync(join(here, "candidates.txt"), `${clean.join("\n")}\n`);
console.log(JSON.stringify({
  candidates: clean.length,
  prefixes: PREFIXES.length,
  cldrDerived: fromCldr,
  jdkEquivalenceKeys: jdkKeys.length,
  addedByJdkKeys: candidates.size - fromCldr,
}));
