// @ts-check
/**
 * The probe space the IANA checks run over. A PURE module: it spawns nothing, writes nothing and
 * needs no JDK, so lokalized-js can rebuild the same space in its own test suite and compare its
 * public parse with `model.mjs` on exactly the probes `npm run check:iana` compared lokalized-java
 * on.
 *
 * FIVE SOURCES, and why each is there:
 *
 *  1. `cldrCandidates()` — the pinned CLDR data: every valid language, every alias key and value and
 *     their subtags, and `<prefix>-<language>` for twelve macrolanguage prefixes where extlang
 *     equivalences live. A GUESS at the shape of the tables, kept because it probes two orders of
 *     magnitude more ranges than any table has keys, which exercises the prefix walk.
 *  2. Every member of every class in the ARTIFACT, and every key of lokalized-java's and the JDK's
 *     own tables (`probeSpace`'s `extraKeys`: the library's and the JDK's keys that are NOT artifact
 *     members, recorded by the JDK check so a JDK-free consumer can rebuild the space exactly). A
 *     probe space derived only from one implementation's table is blind to a key only another has:
 *     that happened twice here, once in each direction (`cmn-hans`, `cmn-hant`, `lv-lvs`, `lv-ltg`
 *     were never probed while the JDK was the oracle; `dyl`, `sgn-dyl`, `zhk`, `sgn-zhk` were never
 *     probed once the library was).
 *  3. `classHeaders(artifact)` — each class's members as ONE header, in class order and reversed,
 *     with falling weights. A single-range probe never shows how two members of one class interact
 *     inside a list (first-wins de-duplication against an expansion already inserted).
 *  4. `orderedPairProbes(artifact)` — `und` and `sgn` followed by every ORDERED pair of distinct
 *     region/variant `from` subtags. **Without these a reordering of the substitutions is invisible**:
 *     measured in the design pass, moving one pair to the end or swapping two adjacent pairs changed
 *     0 of 116,229 probes, because no other probe carries two substitutable subtags at once.
 *  5. `grammarProbes()` — the list grammar and `Double#parseDouble`'s weight grammar: empty members,
 *     all-separator values, hyphen-only ranges, hexadecimal and suffixed weights, bounds.
 *
 * `probeSpace` is deduplicated and sorted bytewise, so its digest names the space.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Macrolanguage prefixes under which extlang equivalences live. */
const PREFIXES = ["ar", "cmn", "i", "kok", "ms", "no", "sgn", "sr", "sw", "uz", "yue", "zh"];

const bytewise = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);
const rangeShaped = (/** @type {string} */ candidate) => candidate.length > 0 && /^[A-Za-z0-9-]+$/.test(candidate);

/** Source 1. @returns {string[]} */
export function cldrCandidates() {
  const locale = JSON.parse(
    readFileSync(join(spec, "vendor/lokalized-java/src/build/resources/cldr/cldr-locale-data.json"), "utf8"),
  );
  const candidates = new Set(/** @type {string[]} */ (locale.validity.languages));
  for (const group of Object.values(locale.aliases))
    for (const { from, to } of /** @type {{ from: string, to: string }[]} */ (group))
      for (const tag of [from, to]) {
        candidates.add(tag);
        for (const part of tag.split("-")) candidates.add(part);
      }
  const languages = [...locale.validity.languages].filter((language) => language.length >= 2 && language.length <= 3);
  for (const prefix of PREFIXES) for (const language of languages) candidates.add(`${prefix}-${language}`);
  return [...candidates].filter(rangeShaped).sort(bytewise);
}

/** Source 3. @param {{ languageEquivalenceClasses: string[][] }} artifact @returns {string[]} */
export function classHeaders(artifact) {
  const header = (/** @type {string[]} */ members) =>
    members.map((member, index) => (index === 0 ? member : `${member};q=${(1 - index / 10).toFixed(1)}`)).join(",");
  return artifact.languageEquivalenceClasses.flatMap((members) => [header(members), header([...members].reverse())]);
}

/** Source 4. @param {{ regionVariantEquivalents: [string, string][] }} artifact @returns {string[]} */
export function orderedPairProbes(artifact) {
  const subtags = [...new Set(artifact.regionVariantEquivalents.map(([from]) => from))];
  /** @type {string[]} */
  const probes = [];
  for (const first of subtags)
    for (const second of subtags)
      if (first !== second) probes.push(`und${first}${second}`, `sgn${first}${second}`);
  return probes;
}

/** Source 5. @returns {string[]} */
export function grammarProbes() {
  return [
    // The list grammar.
    "", ",", ",,,", "en,", "en,,", ",en", "en,,fr", "en,fr,,", " en , fr ", "EN-us, De-de",
    "accept-language: en, fr", "Accept-Language:en", "accept-language:", "en\tfr", "en,\tfr",
    // The range grammar.
    "-", "---", "-en", "en-", "en--us", "*", "*-us", "en-*", "x-private", "i-default", "1en",
    "abcdefghi", "en-abcdefghi", "en-12345678", "en-123456789", "en_us",
    // Double#parseDouble's grammar, after the value has been lowercased.
    "en;q=0.5", "en;q=.5", "en;q=5.", "en;q=5e-1", "en;q=0.5d", "en;q=0.5f", "en;q=+0.5",
    "en;q=0x1p-1", "en;q=0x.8p0", "en;q=0x1.0p-1d", "en;q=0x1", "en;q=1e-4", "en;q=1e-10",
    "en;q=0.0001", "en;q=0", "en;q=-0", "en;q=1", "en;q=1.0", "en;q=00.50", "en;q=0.5\t",
    "en;q=\t0.5", "en;q=", "en;q=.", "en;q=e1", "en;q=nan", "en;q=NaN", "en;q=infinity",
    "en;q=Infinity", "en;q=2", "en;q=1e10", "en;q=-0.5", "en;q=1.0000001", "en;q=0.5;q=0.3",
    "en;q=0.5,fr;q=0.5,de;q=0.9", "fr;q=0.1,iw;q=0.3,he;q=0.9,in",
  ];
}

/**
 * The whole space.
 * @param {{ languageEquivalenceClasses: string[][], regionVariantEquivalents: [string, string][] }} artifact
 * @param {Iterable<string>} [extraKeys] table keys from lokalized-java or the JDK that are not artifact members
 * @returns {string[]}
 */
export function probeSpace(artifact, extraKeys = []) {
  const space = new Set([
    ...cldrCandidates(),
    ...artifact.languageEquivalenceClasses.flat(),
    ...extraKeys,
    ...classHeaders(artifact),
    ...orderedPairProbes(artifact),
    ...grammarProbes(),
  ]);
  return [...space].sort(bytewise);
}
