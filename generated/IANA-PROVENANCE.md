# IANA language-range equivalents — provenance

Artifact: `generated/iana-language-range-equivalents.json` (806 entries, 21,338 bytes, canonical JCS)
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

**What it costs:** `ianaRegistryFileDate` is `null`. The artifact is pinned to a JDK build, not to a
registry release. If the project later wants IANA-release provenance — or wants to adopt newer IANA
behavior than the JDK carries — that is a separately versioned contract, exactly as §5.1 says, and it
would require the registry snapshot this build deliberately does not fetch.

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
