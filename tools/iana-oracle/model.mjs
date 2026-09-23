// @ts-check
/**
 * The executable statement of how a consumer APPLIES `generated/iana-language-equivalences.json`
 * when it parses a language-range list such as an `Accept-Language` value.
 *
 * It restates lokalized-java 3.1.0's `LocaleMatcher#parseLanguageRanges` on the default
 * `LanguageRangeEquivalents.IANA_REGISTRY` setting, which is `java.util.Locale.LanguageRange#parse`
 * with ONE substitution: the language equivalence table comes from the artifact instead of from the
 * running JDK. It is the third statement of that algorithm, beside Java's and the JavaScript port's,
 * and it is the one the other two are checked against:
 *
 *   - `tools/iana-oracle/build.mjs` (`npm run check:iana`, needs the pinned JDK) runs the library's
 *     public parse over the whole probe space and requires this model's answer on every probe, and
 *     separately compares the JDK's own `LanguageRange.parse` against this model, which is what
 *     checks the model's shared steps against an implementation that did not come from this project;
 *   - a port can hold its own parse to this module with no JDK: `candidates.mjs` rebuilds, JDK-free,
 *     the exact probe space the JDK check used (its digest is in generated/iana-jdk-check.json).
 *
 * The steps, in order (the same list the generated IANA-PROVENANCE.md states for a reader):
 *   1. remove every U+0020 SPACE and lowercase the whole value;
 *   2. drop a leading `accept-language:`;
 *   3. split on `,` the way `java.lang.String#split` does: a value with no `,` is ONE member, so an
 *      empty value is one empty member (refused by the range grammar with `range=`, not an empty
 *      list); otherwise trailing empty members are dropped (commas only is an empty list), and leading
 *      and interior ones are kept (and then refused by the range grammar);
 *   4. a member may carry `;q=<weight>`; the weight is read with `Double#parseDouble`'s grammar and
 *      must lie in [0.0, 1.0];
 *   5. a range already seen is skipped (first occurrence wins);
 *   6. the range must satisfy `LanguageRange`'s grammar: a first subtag of 1-8 ASCII letters or `*`,
 *      later subtags of 1-8 ASCII letters/digits or `*`, no trailing hyphen;
 *   7. the range is inserted before the first member of strictly LOWER weight (a stable sort);
 *   8. its expansions are computed and each one not yet seen is inserted at (that index + 1), so an
 *      expansion list appears in REVERSE of the order it was computed in. The expansions are:
 *        a. the region/variant substitution of the range, if any;
 *        b. for the LONGEST hyphen-bounded prefix of the range that is a member of a language class,
 *           each OTHER member of that class, in class order, with the rest of the range carried
 *           across unchanged; and immediately after each, that member's own region/variant
 *           substitution, if any.
 *      A region/variant substitution takes the FIRST pair in `regionVariantEquivalents` whose `from`
 *      occurs in the range (first occurrence only) ending at the range's end or at a hyphen, and not
 *      starting after the hyphen that opens the first one-character subtag other than the first
 *      subtag (a singleton extension), and replaces it with `to`.
 *
 * EXACTNESS, stated rather than implied. Exact for ASCII input, which is every probe the checks
 * generate. `toLowerCase` here is JavaScript's, where Java uses `toLowerCase(Locale.ROOT)`; the two
 * agree on ASCII. Weights follow `Double#parseDouble`'s grammar (surrounding whitespace, sign, the
 * case-sensitive `NaN` and `Infinity`, decimal and hexadecimal forms, an `f`/`F`/`d`/`D` suffix), but a
 * hexadecimal weight whose value is subnormal is scaled after rounding its mantissa, which can differ
 * from Java in the last bit. Refusals carry the Java exception class and message the library raises.
 */

/** Java's `Integer.MIN_VALUE`, which `LocaleMatcher#getExtentionKeyIndex` uses as "no extension". */
const NO_EXTENSION = -2147483648;

/** A refusal, carrying what Java would have thrown. */
export class ModelRefusal extends RangeError {
  /** @param {string} javaClass @param {string} message */
  constructor(javaClass, message) {
    super(message);
    this.name = "ModelRefusal";
    /** The fully qualified class of the exception lokalized-java throws for this input. */
    this.javaClass = javaClass;
  }
}

const illegalArgument = (/** @type {string} */ message) =>
  new ModelRefusal("java.lang.IllegalArgumentException", message);

/**
 * `java.lang.Double#toString`, for the weight a refusal message quotes.
 * @param {number} value
 */
export function javaDoubleText(value) {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  // JavaScript's and Java 19+'s Double#toString both choose the SHORTEST digits that round-trip;
  // only the layout differs.
  const [mantissa, exponentText] = magnitude.toExponential().split("e");
  const digits = /** @type {string} */ (mantissa).replace(".", "");
  const exponent = Number(exponentText);
  if (magnitude >= 1e-3 && magnitude < 1e7) {
    if (exponent >= 0) {
      const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, "0");
      const fraction = digits.slice(exponent + 1) || "0";
      return `${sign}${whole}.${fraction}`;
    }
    return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  }
  return `${sign}${digits[0]}.${digits.slice(1) || "0"}E${exponent}`;
}

/**
 * `java.lang.Double#parseDouble`: the value, or `null` where Java throws `NumberFormatException`.
 * @param {string} text
 */
export function javaParseDouble(text) {
  // String#trim: every code unit at or below U+0020 at either end.
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start++;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end--;
  const trimmed = text.slice(start, end);
  const match = /^([+-]?)(?:(NaN)|(Infinity)|(0[xX])((?:[0-9a-fA-F]+\.?|[0-9a-fA-F]*\.[0-9a-fA-F]+))[pP]([+-]?[0-9]+)[fFdD]?|((?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)[fFdD]?)$/.exec(trimmed);
  if (!match) return null;
  const negative = match[1] === "-";
  let value;
  if (match[2]) value = Number.NaN;
  else if (match[3]) value = Infinity;
  else if (match[4]) {
    const [whole, fraction = ""] = /** @type {string} */ (match[5]).split(".");
    const mantissa = BigInt(`0x${(whole || "") + fraction || "0"}`);
    const binaryExponent = Number(match[6]) - 4 * fraction.length;
    value = mantissa === 0n ? 0 : Number(mantissa) * 2 ** binaryExponent;
  } else value = Number(match[7]);
  return negative ? -value : value;
}

/**
 * `java.lang.String#split` with a one-character literal separator: trailing empty strings removed,
 * and an input made only of separators yields no members at all.
 * @param {string} text @param {string} separator
 */
export function javaSplit(text, separator) {
  const parts = text.split(separator);
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  // "" splits to [""] in Java: the no-match case returns the input itself.
  if (text.length === 0) return [""];
  return parts;
}

/** `LanguageRange#isSubtagIllFormed`. @param {string} subtag @param {boolean} first */
function subtagIllFormed(subtag, first) {
  if (subtag.length === 0 || subtag.length > 8) return true;
  if (subtag === "*") return false;
  for (let i = 0; i < subtag.length; i++) {
    const c = subtag.charCodeAt(i);
    const letter = c >= 0x61 && c <= 0x7a;
    const digit = c >= 0x30 && c <= 0x39;
    if (first ? !letter : !(letter || digit)) return true;
  }
  return false;
}

/** `new LanguageRange(range, weight)`'s grammar check, over an already-lowercased range. @param {string} range */
function requireWellFormedRange(range) {
  const subtags = javaSplit(range, "-");
  if (subtags.length === 0)
    throw new ModelRefusal("java.lang.ArrayIndexOutOfBoundsException", "Index 0 out of bounds for length 0");
  let illFormed = subtagIllFormed(/** @type {string} */ (subtags[0]), true) || range.endsWith("-");
  for (let i = 1; !illFormed && i < subtags.length; i++) illFormed = subtagIllFormed(/** @type {string} */ (subtags[i]), false);
  if (illFormed) throw illegalArgument(`range=${range}`);
}

/**
 * @param {{ languageEquivalenceClasses: string[][], regionVariantEquivalents: [string, string][] }} artifact
 * @returns {{ parse: (header: string) => { range: string, weight: number }[], expansionsFor: (range: string) => string[], others: ReadonlyMap<string, string[]> }}
 */
export function modelFor(artifact) {
  /** Each member to the OTHER members of its class, class order preserved. */
  /** @type {Map<string, string[]>} */
  const others = new Map();
  for (const members of artifact.languageEquivalenceClasses)
    for (const key of members) others.set(key, members.filter((member) => member !== key));
  const pairs = artifact.regionVariantEquivalents.map(([from, to]) => [from, to]);

  /** `LocaleMatcher#getExtentionKeyIndex`: the hyphen before the first singleton subtag. @param {string} range */
  const extensionKeyIndex = (range) => {
    let index = NO_EXTENSION;
    for (let position = 1; position < range.length; position++)
      if (range[position] === "-") {
        if (position - index === 2) return index;
        index = position;
      }
    return NO_EXTENSION;
  };

  /** Step 8a. @param {string} range @returns {string | null} */
  const regionVariant = (range) => {
    const keyIndex = extensionKeyIndex(range);
    for (const [from, to] of pairs) {
      const index = range.indexOf(/** @type {string} */ (from));
      if (index === -1) continue;
      if (keyIndex !== NO_EXTENSION && index > keyIndex) continue;
      const end = index + /** @type {string} */ (from).length;
      if (range.length === end || range[end] === "-") return range.slice(0, index) + to + range.slice(end);
    }
    return null;
  };

  /** Step 8b's language arm: the longest known prefix, the remainder carried across. @param {string} range */
  const language = (range) => {
    let prefix = range;
    while (prefix.length > 0) {
      const found = others.get(prefix);
      if (found) return found.map((other) => other + range.slice(prefix.length));
      const index = prefix.lastIndexOf("-");
      if (index === -1) break;
      prefix = prefix.slice(0, index);
    }
    return [];
  };

  /** Step 8, in computation order. @param {string} range */
  const expansionsFor = (range) => {
    /** @type {string[]} */
    const expansions = [];
    const own = regionVariant(range);
    if (own !== null) expansions.push(own);
    for (const equivalent of language(range)) {
      expansions.push(equivalent);
      const nested = regionVariant(equivalent);
      if (nested !== null) expansions.push(nested);
    }
    return expansions;
  };

  /** @param {string} header */
  function parse(header) {
    let normalized = header.replaceAll(" ", "").toLowerCase();
    if (normalized.startsWith("accept-language:")) normalized = normalized.slice("accept-language:".length);

    /** @type {{ range: string, weight: number }[]} */
    const list = [];
    const seen = new Set();

    for (const member of javaSplit(normalized, ",")) {
      let range = member;
      let weight = 1.0;
      const weightIndex = member.indexOf(";q=");
      if (weightIndex !== -1) {
        range = member.slice(0, weightIndex);
        const text = member.slice(weightIndex + 3);
        const parsed = javaParseDouble(text);
        if (parsed === null) throw illegalArgument(`weight="${text}" for language range "${range}"`);
        weight = parsed;
        if (weight < 0 || weight > 1)
          throw illegalArgument(`weight=${javaDoubleText(weight)} for language range "${range}". It must be between 0.0 and 1.0.`);
      }

      if (seen.has(range)) continue;
      requireWellFormedRange(range);

      let index = list.length;
      for (let position = 0; position < list.length; position++)
        if (/** @type {{ weight: number }} */ (list[position]).weight < weight) { index = position; break; }

      list.splice(index, 0, { range, weight });
      seen.add(range);

      for (const equivalent of expansionsFor(range))
        if (!seen.has(equivalent)) {
          seen.add(equivalent);
          list.splice(index + 1, 0, { range: equivalent, weight });
        }
    }
    return list;
  }

  return { parse, expansionsFor, others };
}
