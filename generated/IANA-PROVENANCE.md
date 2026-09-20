# IANA language-range equivalents — provenance

Artifact: `generated/iana-language-range-equivalents.json` (818 entries, 21,742 bytes, canonical JCS)
Lock: `generated/iana-data-lock.json`
Build: `node tools/iana-oracle/build.mjs --write | --check`

## How this differs from plan v7 §5.1, and why

§5.1 specifies generating the closure **from a pinned IANA Language Subtag Registry snapshot**, then
adding explicit JDK-compatibility override rows wherever the snapshot and the JDK disagree, with an
oracle lane proving equality.

This artifact is instead derived **directly from the JDK oracle** by exhaustive probe of
`java.util.Locale.LanguageRange.parse`.

**Why:** the artifact exists so the JS negotiator reproduces lokalized-java 3.0.0, whose negotiation
calls exactly that API. Deriving from the oracle makes divergence *structurally impossible* — there is
nothing to reconcile, and `jdkCompatibilityOverrides` is empty because no override can be needed. The
v7 route reaches the same place by a longer path that can leave residual differences.

**What it costs:** `ianaRegistryFileDate` is `null` in THIS artifact. It is pinned to a JDK build,
not to a registry release. If the project later wants IANA-release provenance — or wants to adopt
newer IANA behavior than the JDK carries — that is a separately versioned contract, exactly as §5.1
says, and it would require a registry snapshot this build does not fetch.

## THE ORACLE MOVED — lokalized-java 3.1.0

**Everything above describes the artifact as it was derived until now, and the paragraph beneath it
is the reason this section exists.** `iana-language-range-equivalents.json` was derived from
`java.util.Locale.LanguageRange.parse`, which was the right oracle while lokalized-java called it.
As of 3.1.0 the library carries its own registry-sourced table, so the oracle moved and the
artifact is now derived by probing THE LIBRARY: `tools/iana-oracle/library/com/lokalized/
ExtractLibrary.java`, run by `node tools/iana-oracle/build.mjs --write --library`.

The property the paragraphs above argue for is preserved rather than abandoned. Deriving from the
oracle still makes divergence structurally impossible; it is a different oracle. The JDK mode is
kept, because it produced every artifact before this and the comparison between the two IS the
evidence for the change.

**What moved, measured:** 806 entries to **818**, **zero removed and zero changed**. `source` is now
`lokalized-java` and `ianaRegistryFileDate` is `2026-09-17`, a real date, where it was `null` for
the life of this artifact.

Twelve keys were added, and they arrived in two goes for two different reasons. **Eight** — `bh`,
`bih`, `enm`, `mgp`, `mrd`, `mrh`, `shl`, `yol` — are the registry equivalences the library learned.
**Four more** — `dyl`, `sgn-dyl`, `zhk`, `sgn-zhk` — were in the library's table all along and had
simply never been PROBED: `candidates.mjs` seeded the probe space from the JDK's own equivalence
keys, which was right while the JDK was the oracle and is a space derived from the wrong
implementation once the library answers. `LibraryEquivalenceKeys` dumps the oracle's own 781 keys
before the space is built, and `build.mjs` now requires an entry for every key of EITHER table.
That is the same defect, one implementation over, as the four JDK keys (`cmn-hans`, `cmn-hant`,
`lv-lvs`, `lv-ltg`) that made `jdk-equivalence-keys.txt` necessary in the first place.

### AND THE ARTIFACT STILL PROBES THE JDK, because 3.1.0 has TWO tables

`IanaLanguageEquivalents.parse` is not a replacement for `java.util.Locale.LanguageRange.parse`; it
is a second table used in two specific places. lokalized-java 3.1.0 calls it from
`LocaleMatcher#bestMatchForAcceptLanguage` and `DefaultStrings#addParsedLanguageRangeIdentities`,
both INSIDE the library, and a caller who builds a `List<LanguageRange>` still uses the JDK's parse.
`VectorOracle.languageRangesFrom` says the same thing from the corpus side: a `matchFor` case's
string input is parsed "before the library is entered".

So a consumer of this artifact needs to know which keys are the library's alone. Shipping two
closures would double ~23 KB in every browser graph that reaches one, so the artifact carries ONE
table plus `jdkAbsentTags`, **derived from a second real extraction against the JDK on every run**
and never hand-maintained. Today that is twelve keys:

<!-- iana:delta -->

`bh`, `bih`, `dyl`, `enm`, `mgp`, `mrd`, `mrh`, `sgn-dyl`, `sgn-zhk`, `shl`, `yol`, `zhk`.

**The encoding's precondition is asserted, not assumed.** `build.mjs` refuses to emit unless the
library's closure is a strict SUPERSET of the JDK's with every shared class identical **in order**
— order-exact because the port recovers the JDK's insertion sequence out of the stored class, so a
class that was merely REORDERED would hand the public parse the wrong sequence under the right
name. It also refuses an EMPTY delta, because two identical tables would mean nothing distinguishes
the two channels and a consumer's split would be untestable. A key the JDK has and the library does
not, or a shared class whose members moved, fails the run naming the key: the
single-table-plus-delta form cannot express either.

## THE SNAPSHOT NOW EXISTS — M-R S11, 2026-09-19

**The maintainer asked for it**, having noticed that `ianaRegistryDate` reads `jdk-oracle:21.0.11`
and that "oracle" is easy to read as the vendor rather than as the testing term it is. The paragraph
above still describes `iana-language-range-equivalents.json` correctly; what follows is the other
half §5.1 asks for, added WITHOUT changing what the port does.

`tools/iana-oracle/language-subtag-registry.txt` is the real registry, fetched from
`https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry`:
**`File-Date: 2026-09-17`, 9,296 records, 731,819 bytes**, sha256
`755fad43283be7b41ebe3c89ad054b6eaf928f404f9c0edb74799e0eab74beb1`.

`tools/iana-oracle/registry.mjs` derives the registry's own closure from it — 781 entries, by
union-find over every LANGUAGE-side `Preferred-Value` and every `extlang`'s `prefix-subtag`
equivalence — and computes the difference against the JDK's 806.
**`generated/iana-registry-overrides.json` is that difference: 142 rows, 81 order-only, 37
JDK-only, 12 registry-only, 12 membership**, each row placed in a FAMILY whose cause is recorded
and whose count is asserted against the table.

**THE FIRST DERIVATION WAS WRONG AND THE NUMBER WAS 156.** It ran union-find over every record
carrying a `Preferred-Value` without discriminating record TYPE, which flattened six REGION records
(DD→DE, FX→FR, BU→MM, ZR→CD, TP→TL, YD→YE) and one VARIANT record (heploc→alalc97) into the same
namespace as languages and emitted them as bare keys. That is not a keying nuance — it claimed `de`
is equivalent to `dd`, so the range `de` (German) would expand to `dd` and `de-CH` to `dd-CH`, where
the JDK expands neither. The JDK keeps exactly those fourteen in a separate map whose keys all carry
a leading hyphen, confining them to non-initial subtag positions; they are now kept apart here too
and listed as `regionVariantAliases`. Removing them took the table from 156 rows to 142, which is
exactly the split two independent investigations predicted.

**THE TABLE IS VERIFIED BY RECONSTRUCTION RATHER THAN BY INSPECTION**, which is what makes it
trustworthy: applying all 156 overrides to the registry closure reproduces the JDK artifact
byte-identically. A missing row would leave a difference and a redundant row is reported, so the
table cannot be short and cannot be padded. `npm run check:iana-registry` re-derives it every run.

**THE PORT'S BEHAVIOUR IS UNCHANGED AND THAT IS DELIBERATE.** Parity with lokalized-java 3.0.0 is
the product, and lokalized-java calls `java.util.Locale.LanguageRange.parse`. Adopting the
registry's closure would make this package disagree with a Java deployment on 69 tags. What the
snapshot buys is provenance: a real `File-Date`, a pinned byte digest, and an enumerated,
reconstruction-checked account of every place the JDK and IANA differ.

**WHAT THE 142 ARE, in one line each, measured against the JDK's own `src.zip` rather than
inferred.** 37 JDK-only rows are `LocaleMatcher.getEquivalentForRegionAndVariant` substituting a
trailing region or variant by raw substring — it fires on `ar-de` and never on bare `de` — showing
up as standalone keys only because the closure is built by exhaustive probe. 12 registry-only rows
are version skew: `LocaleEquivalentMaps.java` is stamped `LSR Revision: 2025-05-15` in JDK 21 and
`2026-05-05` in JDK 27, against this snapshot's 2026-09-17. 12 membership rows are the same region
substitution one level deeper, synthesising `sgn-dd`, `sgn-fx`, `sgn-be-fx` and `sgn-ch-dd`, none of
which appears in any registry record. 81 are order-only, because nothing in the registry determines
an order and the JDK's is `parse`'s insertion sequence.

**ORDER IS LOAD-BEARING, WHICH IS THE REASON A REGISTRY-DERIVED CLOSURE CANNOT SIMPLY BE ADOPTED.**
Ablated: reversing the non-first members of every class takes conformance from 2,150/0 to 2,128/22
and reds four tests. Every one of the 22 differs ONLY in the echoed `requestedLanguageRanges` and
the selected locale is identical in all of them — so order is a compared public output rather than a
catalog-selection input, and a replacement closure would have to reproduce it.

**AND 37 OF THE 806 SHIPPED ROWS ARE INERT — 4.6% of the artifact.** Deleting the JDK-only rows from
`lokalized-js/src/data/iana-range-equivalents.js` (806 → 769) leaves the port matching the real JDK
on 115,178 of 115,178 parseable ranges, because `src/negotiate/index.js` already carries the same
14-entry region/variant map inline and composes the two arms as `LocaleMatcher` does. The
anti-vacuity control holds: removing the load-bearing `he` row reds 1. Recorded rather than acted
on — deleting rows from a pinned parity artifact is a separate, reviewed change.

**Measured while doing it, and worth knowing before anyone re-pins the oracle:** Corretto 27
(27.0.0.35.1) yields 812 entries against Corretto 21's 806 — strictly six more (`dyl`, `enm`,
`sgn-dyl`, `sgn-zhk`, `yol`, `zhk`), zero changed, zero removed — and zero of the corpus's 2,363
cases touch any of them. Two of those six also appear in the registry-only column here, which is
the registry being ahead of JDK 21 rather than a disagreement.

## The probe space — stated first, because every claim below is scoped to it

`tools/iana-oracle/candidates.mjs` emits **115,487 ranges** into `candidates.txt` from two sources,
and which source a range comes from matters:

| source | ranges | what it is |
|---|---|---|
| pinned CLDR data | 115,469 emitted (115,480 in the set before the `/^[A-Za-z0-9-]+$/` well-formedness filter drops 11 CLDR region-list strings such as `"CZ SK"`) | every valid language, every alias key and value and their subtags, and `<prefix>-<language>` for twelve macrolanguage prefixes |
| the JDK's own equivalence-map keys | 769, of which **18** were not already present | every key of `sun.util.locale.LocaleEquivalentMaps.singleEquivMap` and `.multiEquivsMap`, dumped by `EquivalenceKeys.java` into `jdk-equivalence-keys.txt` |

The second source is the one that makes the space complete, and it is **not self-referential**: the
keys are read by reflection out of the JDK's *input* data, while the artifact is the *output* of
`LanguageRange.parse` over the space. Two different objects reached by two different paths. Seeding
the probes from the extracted closure instead — which is what `lokalized-js`'s differential used to do
— cannot expose a key the closure is missing, because the missing key is exactly the probe that is
never asked.

**This was a real defect, not a hypothetical one.** The CLDR-only space is a *guess* at the shape of
the JDK's table, and it was wrong in four places: `cmn-hans` and `cmn-hant` are prefix-plus-SCRIPT
where the generator only crossed prefixes with LANGUAGES, and `lv-lvs` / `lv-ltg` need an `lv` prefix
the list did not carry. Those four keys were never probed, never reached the artifact, and made
`lokalized-js` answer `cmn-hans` with a member too many (`zh-guoyu-hans`, from falling through to
`cmn`) and `lv-ltg` with a member too few (nothing at all, so a Latgalian request never reaches an
`ltg` catalog). Adding the 769 keys to the space adds **exactly those four entries** (802 → 806);
nothing else was added, changed or removed, and the raw closure went 18,371 → 18,375 keys.

`regionVariantEquivMap` is deliberately **not** a source. Its keys are subtags (`-dd`, `-fx`), it is
applied by substitution inside a range rather than by prefix lookup, and the port carries it inline;
probing `-dd` as a range would record a rejection, not a class.

## Method

1. `candidates.mjs` emits the 115,487-range space described above. It **fails** rather than falling
   back to CLDR alone if the pinned JDK cannot be reached — a probe space that quietly shrinks is the
   failure mode this generator was rewritten to prevent. The space is hashed into the lock, as is
   `jdk-equivalence-keys.txt`, because a closure is only as complete as what it was probed with.
2. `Extract.java` probes each range and records every expansion beyond the input.
   **18,375 raw closure keys**; 309 ranges are rejected by the JDK as malformed.
3. **Completeness is asserted, not argued.** `build.mjs` requires every one of the 769 dumped JDK keys
   to have produced a raw closure entry, and throws naming the offenders otherwise. Negative-tested:
   with the union in `candidates.mjs` disabled, the build fails with
   `4 of the JDK's own equivalence keys produced no closure entry … cmn-hans, cmn-hant, lv-ltg,
   lv-lvs`; with it restored, it exits 0.
4. The raw closure is reduced to **806 genuine entries** by discarding any entry a shorter entry
   yields through prefix substitution. Without this the artifact would encode the probe space rather
   than the table: **17,576** of the raw keys are `cmn-*` and `yue-*` expansions derived from two
   rules. (The previous revision said 17,569, which was already wrong before this change — the
   figure here is counted out of `closure.raw.json`, not carried forward.)
5. The reduction is verified **lossless over the probe space**: all 18,375 probed ranges reconstruct
   exactly from the 806 entries. The build throws rather than writing if any range fails.

**What losslessness does and does not say.** It says every range in the space above reconstructs. It
says nothing about a range outside it — which is precisely how the four missing keys survived a green
build for the whole of M7. Step 3 is the claim that covers that gap, and it is a different claim:
losslessness is *"what we probed round-trips"*, completeness is *"we probed everything the JDK keys
on"*. Both are needed; neither implies the other.

## JDK-version stability — re-measured over the new probe space

The oracle pins JDK 21 and refuses any other major version, because the table is JDK-dependent in
principle. In practice, across every JDK available here, it is not — and this table is re-measured
over the 115,487-range space rather than carried over from the old one, since the old measurement was
true only of the space that was missing four keys.

Two hashes, both defined so they can be reproduced: **keys** is `sha256(jdk-equivalence-keys.txt)`
after running `EquivalenceKeys.java` on that JDK, and **raw closure** is `sha256(closure.raw.json)`
after running `Extract.java` on that JDK over the pinned `candidates.txt`. The artifact itself is a
pure function of the raw closure, so equal raw closures give equal `equivalents` tables; the artifact
*file* still differs per JDK because it records `jdkVersion` / `jdkVendor` by design.

| JDK (Corretto) | keys (769 each) | raw closure (18,375 keys each) |
|---|---|---|
| 17.0.20.1 | `44e44241b25adb84` | `b0d45dc6d2e7925d` |
| 21.0.11 | `44e44241b25adb84` | `b0d45dc6d2e7925d` |
| 25.0.4.1 | `44e44241b25adb84` | `b0d45dc6d2e7925d` |
| 26.0.1 | `44e44241b25adb84` | `b0d45dc6d2e7925d` |

Full digests: keys `44e44241b25adb847267ec6e1e31cff6f3270060b45ab15c63e7961263259760`, raw closure
`b0d45dc6d2e7925d0fb008dafe256f07d310495707a4dcfec67cc4acc095c5d4`. The `equivalents` table's own JCS
digest is `6e00f1a1d80cdaaedc7c705c6b39c4ec3dbc82c39ece5ce479bec3842517c387`.

**Byte-identical across JDK 17–26**, in both the probe space's second source and the extracted
closure. The `ar-ary → ary` alias that `DefaultStrings.java:2090-2098` warns older JDKs lack is
present in all four. (The previous revision of this file published a single unlabeled column of
hashes that matches neither the artifact nor the raw closure; the definitions above exist so that
cannot recur.)

**Limits of that finding.** It says nothing about **JDK 9–16**, and `lokalized-java` compiles at
`release 9`. A consumer running the Java library on a JDK older than 17 may still get a different
table, which is precisely the divergence the javadoc describes. The pin stays at 21 — conservative,
and cheap.

## What this artifact is not

`equivalents` is an **IANA language-range equivalence table**, not a CLDR alias table. The two are
distinct concepts and disagree in visible ways:

| tag | CLDR alias | IANA range equivalents |
|---|---|---|
| `sh` | → `sr-Latn` | **none** |
| `tl` | → `fil` | **none** |
| `he` | → `he` | `he`, `iw` |
| `cmn` | → `zh` | `cmn`, `zh-guoyu`, `zh-cmn` |

A consumer that substitutes one for the other will negotiate incorrectly. `lokalized/negotiate`
consumes this artifact; CLDR canonicalization uses `cldr-locale-data.json` aliases.

Nor is it the JDK's two maps as such: it records, for each key, the whole list `parse(key)` returned,
which already has the region/variant equivalents mixed in (`sgn-be-fr` → `[sgn-be-fr, sgn-sfb, sfb,
sgn-be-fx]`, whose last member is a REGION equivalent). That is why 37 of the 806 entries are keys the
JDK does not hold at all — they are region/variant classes the probe space reached. `lokalized-js`
inverts `parse`'s insertion order to recover the language equivalents, and checks that recovery on all
806 keys.

## Consumers

`M9` and the JS negotiator, replacing any reliance on a host registry. The root graph does not carry
it — see plan §3.1, which keeps the whole-list solver out of `lokalized`. `lokalized-js`'s
`npm run diff:language-range` is the end-to-end check that the port and the real
`Locale.LanguageRange.parse` agree; it is the tool that surfaced the four missing keys.
