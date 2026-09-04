# Registry-calibration scratch copy: section 2.2

Status: calibration only. These `CAL-*` identifiers are provisional and must never enter the
production requirement registry. Source-section SHA-256:
`de22308d19e357db0dd77e35a7be712960c39e3cd15f3caaa28e86769b212000`.

## 2.2 Fallback chain and tiebreakers

### Pre-resolution candidate sequence

<!-- CAL:CAL-FALLBACK-001 -->
The pre-resolution candidate sequence is a first-wins ordered union.

<!-- CAL:CAL-FALLBACK-002 -->
Tier 1 of the pre-resolution sequence is `fallbackLocalesFor(lookupLocale)`, preserving its output order.

<!-- CAL:CAL-FALLBACK-003 -->
`fallbackLocalesFor` forms an ordered union of raw-tag traversal, CLDR-canonical-tag traversal, then canonical-parent closure.

<!-- CAL:CAL-FALLBACK-004 -->
Every fallback traversal inserts its current tag.

<!-- CAL:CAL-FALLBACK-005 -->
Every fallback traversal inserts applicable explicit CLDR parents.

<!-- CAL:CAL-FALLBACK-006 -->
Fallback traversal truncates exactly one subtag per truncation step.

<!-- CAL:CAL-FALLBACK-007 -->
Fallback truncation terminates when a parent reaches `root`.

<!-- CAL:CAL-FALLBACK-008 -->
Fallback truncation stops before crossing a likely-script boundary.

<!-- CAL:CAL-FALLBACK-009 -->
Each fallback traversal finally applies the `no` ↔ `nb` bridge.

<!-- CAL:CAL-FALLBACK-010 -->
The bridged `no`/`nb` locale is processed by the same fallback-traversal algorithm.

<!-- CAL:CAL-FALLBACK-011 -->
The `no` ↔ `nb` bridge must not recursively invoke the bridge again.

<!-- CAL:CAL-FALLBACK-012 -->
Tier 2 contributes at most one supported likely-language/script match.

<!-- CAL:CAL-FALLBACK-013 -->
Tier 3 contributes script-compatible supported locales in normalized-primary-language tiebreaker order.

<!-- CAL:CAL-FALLBACK-014 -->
Tier 4 contributes the resolved exact fallback-locale file.

### Candidate-to-file resolution

<!-- NONNORMATIVE:NN-005 reviewed -->
The first-applicable-order summary is entailed by `CAL-FALLBACK-016` through `CAL-FALLBACK-020`.

<!-- CAL:CAL-FALLBACK-016 -->
Candidate resolution first selects an exact normalized loaded tag when one exists.

<!-- CAL:CAL-FALLBACK-017 -->
Without an exact normalized loaded tag, candidate resolution selects the sole CLDR-equivalent loaded tag when exactly one exists.

<!-- CAL:CAL-FALLBACK-018 -->
If prior resolution alternatives fail, candidate resolution selects the first equivalent tag in the applicable tiebreaker list.

<!-- CAL:CAL-FALLBACK-019 -->
If prior resolution alternatives fail, candidate resolution selects the resolved fallback tag when it is among the equivalent tags.

<!-- CAL:CAL-FALLBACK-020 -->
If all earlier resolution alternatives fail, candidate resolution selects the lexicographically first equivalent normalized loaded tag.

<!-- CAL:CAL-FALLBACK-021 -->
A candidate for which no loaded file resolves remains catalog-less.

<!-- NONNORMATIVE:NN-001 reviewed -->
The original clause's warning that candidate lookup order differs from fallback-locale validation is a rationale/cross-reference; the two positive algorithms carry the enforceable rules.

### Attempted locales, deduplication, and fallback policy

<!-- CAL:CAL-FALLBACK-022 -->
When a file resolves, `attemptedLocale` is that file's exact normalized tag.

<!-- CAL:CAL-FALLBACK-023 -->
When no file resolves, `attemptedLocale` is the candidate's normalized tag.

<!-- CAL:CAL-FALLBACK-024 -->
Candidate deduplication is first-wins on the post-resolution exact attempted-locale tag.

<!-- NONNORMATIVE:NN-002 reviewed -->
The original statement that different candidates resolving to the same loaded file collapse is a derived consequence of `CAL-FALLBACK-024`.

<!-- NONNORMATIVE:NN-006 reviewed -->
The negative CLDR-equivalence formulation is entailed by the positive post-resolution exact-tag rule in `CAL-FALLBACK-024`.

<!-- CAL:CAL-FALLBACK-026 -->
`attemptedLocales` contains only candidates that resolution actually entered.

<!-- CAL:CAL-FALLBACK-027 -->
`attemptedLocales` includes the candidate that succeeds.

<!-- CAL:CAL-FALLBACK-028 -->
A fallback-policy result of `false` truncates `attemptedLocales` at that point.

<!-- CAL:CAL-FALLBACK-029 -->
The fallback policy is invoked only when another distinct post-resolution candidate exists and is never invoked after the last candidate.

### Normalized primary language and tiebreakers

<!-- CAL:CAL-FALLBACK-030 -->
Normalized primary language is obtained by CLDR-canonicalizing the complete tag before extracting its primary language.

<!-- CAL:CAL-FALLBACK-031 -->
A private-use tag has no normalized primary language.

<!-- CAL:CAL-FALLBACK-032 -->
An undetermined tag has no normalized primary language.

<!-- CAL:CAL-FALLBACK-033 -->
A tag without a normalized primary language creates no tiebreaker requirement.

<!-- CAL:CAL-FALLBACK-034 -->
For a normalized primary language with one loaded locale, an omitted tiebreaker is synthesized as the one-element identity order.

<!-- CAL:CAL-FALLBACK-035 -->
For a normalized primary language with more than one loaded locale, a tiebreaker is mandatory.

<!-- CAL:CAL-FALLBACK-036 -->
Every supplied tiebreaker order contains each exact loaded tag for its language exactly once and no other tag.

<!-- NONNORMATIVE:NN-003 reviewed -->
The original phrase "including a one-locale order" is an illustrative boundary already entailed by `CAL-FALLBACK-036`.

<!-- CAL:CAL-FALLBACK-037 -->
Every tiebreaker key is a well-formed primary language subtag.

<!-- CAL:CAL-FALLBACK-038 -->
Every tiebreaker key is normalized through the locale alias process used by the rest of the contract.

<!-- CAL:CAL-FALLBACK-039 -->
Alias-equivalent duplicate tiebreaker keys are rejected.

<!-- NONNORMATIVE:NN-004 reviewed -->
The original `he`/`iw` pair is an example only; `CAL-FALLBACK-039` carries the general rule.

<!-- CAL:CAL-FALLBACK-040 -->
Manifest tiebreakers are validated against the manifest's full file set before subset planning.

<!-- CAL:CAL-FALLBACK-041 -->
A loader may stable-filter an already-valid manifest tiebreaker order to the successfully loaded exact tags.

<!-- CAL:CAL-FALLBACK-042 -->
A loader-produced `createStrings` tiebreaker remains an exact permutation of the successfully loaded tags for that language.

### Configured fallback resolution

<!-- CAL:CAL-FALLBACK-043 -->
Configured-fallback validation permits a non-byte-identical configured tag when it resolves under the fallback-resolution rules.

<!-- CAL:CAL-FALLBACK-044 -->
A configured fallback tag must resolve to an exact loaded tag.

<!-- CAL:CAL-FALLBACK-045 -->
Configured-fallback resolution first prefers an exact normalized file tag.

<!-- CAL:CAL-FALLBACK-046 -->
Without an exact normalized file tag, configured-fallback resolution selects the sole CLDR-equivalent file when exactly one exists.

<!-- CAL:CAL-FALLBACK-047 -->
If earlier configured-fallback alternatives fail, resolution selects the first equivalent file in the applicable tiebreaker order.

<!-- CAL:CAL-FALLBACK-048 -->
Construction validation rejects a configured fallback unless fallback resolution produces one unambiguous exact loaded tag.

<!-- CAL:CAL-FALLBACK-049 -->
Manifest validation rejects a configured fallback unless fallback resolution produces one unambiguous exact loaded tag.

<!-- CAL:CAL-FALLBACK-050 -->
Runtime configuration exposes the resolved exact loaded fallback tag as its fallback value.

<!-- CAL:CAL-FALLBACK-051 -->
Every locale-match result exposes the resolved exact loaded fallback tag as its fallback value.

<!-- CAL:CAL-FALLBACK-052 -->
Fallback-file loading targets the resolved exact loaded fallback tag.

<!-- CAL:CAL-FALLBACK-053 -->
SSR metadata exposes the resolved exact loaded fallback tag as its fallback value.

<!-- CAL:CAL-FALLBACK-054 -->
Resolving a configured fallback does not rewrite a direct request's separate `lookupLocale`.

### Candidate-chain cache

<!-- CAL:CAL-FALLBACK-055 -->
Candidate-chain output is determined by the supplied lookup locale rather than by one instance-wide constant.

<!-- CAL:CAL-FALLBACK-056 -->
If candidate chains are memoized, each `Strings` instance owns its own cache.

<!-- CAL:CAL-FALLBACK-057 -->
An enabled candidate-chain cache uses deterministic LRU eviction.

<!-- CAL:CAL-FALLBACK-058 -->
An enabled candidate-chain cache is keyed by normalized requested tag.

<!-- CAL:CAL-FALLBACK-059 -->
An enabled candidate-chain cache retains at most 256 entries per `Strings` instance.

<!-- CAL:CAL-FALLBACK-060 -->
Disabling candidate-chain caching is a conforming implementation choice.

<!-- CAL:CAL-FALLBACK-061 -->
A test-only cache probe reports retained-entry count without exposing mutable cache state.

<!-- CAL:CAL-FALLBACK-062 -->
Enabled-cache stress evidence inserts at least 4,096 distinct well-formed junk tags.

<!-- CAL:CAL-FALLBACK-063 -->
Enabled-cache stress evidence asserts the 256-entry ceiling.

<!-- CAL:CAL-FALLBACK-064 -->
Enabled-cache stress evidence asserts deterministic eviction.

<!-- CAL:CAL-FALLBACK-065 -->
Disabled-cache stress evidence asserts zero retained cache entries.

<!-- CAL:CAL-FALLBACK-066 -->
Retained-memory evidence for both cache modes uses the locked forced-GC/heap protocol.

<!-- CAL:CAL-FALLBACK-067 -->
Retained-memory evidence compares workloads of 4,096 and 40,960 distinct well-formed junk tags.

<!-- CAL:CAL-FALLBACK-068 -->
Neither enabled nor disabled cache mode may exhibit a retained-growth regression between the locked 4,096-tag and 40,960-tag workloads.

### Direct locale input

<!-- CAL:CAL-FALLBACK-069 -->
Direct-locale input identifies a lookup request, not a catalog selector.

<!-- CAL:CAL-FALLBACK-070 -->
Every direct-locale input that normalizes to a well-formed tag is accepted regardless of whether the normalized tag is loaded, supported, known to pinned validity data, or declared by a manifest.

<!-- CAL:CAL-FALLBACK-075 -->
Core preserves the normalized serialized direct tag as `lookupLocale`.

<!-- CAL:CAL-FALLBACK-076 -->
A direct `lookupLocale` enters the complete fallback cascade.

<!-- CAL:CAL-FALLBACK-077 -->
The automatic match selection described in §3.4 is diagnostic only and never replaces a direct input's `lookupLocale`.

<!-- CAL:CAL-FALLBACK-078 -->
Malformed direct-locale input is rejected at the direct-input validation boundary.

<!-- CAL:CAL-FALLBACK-079 -->
Malformed direct-locale rejection occurs before candidate resolution begins.

<!-- CAL:CAL-FALLBACK-080 -->
Malformed direct-locale rejection occurs before fallback-policy invocation.

<!-- CAL:CAL-FALLBACK-081 -->
Malformed direct-locale rejection occurs before fallback observation.

<!-- CAL:CAL-FALLBACK-082 -->
Malformed direct-locale rejection occurs before failure handling.

<!-- CAL:CAL-FALLBACK-083 -->
An exact-supported restriction may apply only to an inspection API that explicitly states that restriction.
