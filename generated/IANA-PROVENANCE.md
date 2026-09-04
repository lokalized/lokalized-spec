# IANA language-range equivalents — provenance

Artifact: `generated/iana-language-range-equivalents.json` (802 entries, 21,210 bytes, canonical JCS)
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

## Method

1. `tools/iana-oracle/candidates.mjs` emits a deterministic candidate space from the pinned CLDR data:
   every valid language, every alias key and value and their subtags, and macrolanguage-prefixed
   compounds for 12 prefixes where extlang equivalences live. **115,469 ranges.** The space is hashed
   into the lock, because a closure is only as complete as what it was probed with.
2. `tools/iana-oracle/Extract.java` probes each range and records every expansion beyond the input.
   **18,371 raw closure keys**; 309 ranges are rejected by the JDK as malformed.
3. The raw closure is reduced to **802 genuine entries** by discarding any entry a shorter entry
   yields through prefix substitution. Without this the artifact would encode the probe space rather
   than the table: 17,569 of the raw keys are `cmn-*` and `yue-*` expansions derived from two rules.
4. The reduction is verified **lossless**: all 18,371 probed expansions reconstruct exactly from the
   802 entries. The build throws rather than writing if any range fails.

## JDK-version stability — measured

The oracle pins JDK 21 and refuses any other major version, because the table is JDK-dependent in
principle. In practice, across every JDK available here, it is not:

| JDK | closure SHA-256 (first 16) |
|---|---|
| 17.0.20.1 | `64d81a0c170ab13c` |
| 21.0.11 | `64d81a0c170ab13c` |
| 25.0.4.1 | `64d81a0c170ab13c` |
| 26.0.1 | `64d81a0c170ab13c` |

**Byte-identical across JDK 17–26** over the full 115,469-range candidate space. The `ar-ary → ary`
alias that `DefaultStrings.java:2090-2098` warns older JDKs lack is present in all four.

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

## Consumers

`M9` and the JS negotiator, replacing any reliance on a host registry. The root graph does not carry
it — see plan §3.1, which keeps the whole-list solver out of `lokalized`.
