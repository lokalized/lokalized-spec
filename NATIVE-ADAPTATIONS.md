# Native conformance contracts

Lokalized keeps one localization format and shared behavioral obligations while
allowing explicitly declared native API representations. Every adaptation must
identify each affected case, its exact authored input, original observation,
changed boundary and required evidence. It cannot replace expected results,
count source rejection as runtime agreement, or exempt an expressible portable
capability.

## Swift native local profile, version 1.0.0

[`conformance/swift-native-v1.json`](conformance/swift-native-v1.json) defines
`swift-native-local-v1` against the unchanged 2,381-case Java corpus, SHA-256
`1eb74caf8524c0a3b33dca99addb268c86b64eb8321fac03257474ddaa3c9753`.
The profile, [schema](schema/native-adaptations.schema.json) and
[checker](tools/native_adaptations/contract.py) are owned here. Swift consumes a
pinned offline snapshot. The checker verifies case identities, partitions,
input/reference fingerprints, guards, controls and retained observation channels.
A port must first validate actual current compiler/runtime evidence; possession
of the profile qualifies no implementation.

This versioned extension changes neither corpus partitions nor Java observations.
Java and JS retain their null/classloader contracts and do not inherit Swift's
nonoptional boundaries. Other profiles require their own decisions and evidence.

### Nonoptional source boundaries: twenty required cases

Swift's callback returns and catalog/tiebreaker/name collections use nonoptional
types. Source supplying nil at those boundaries is invalid before lookup. The
native obligation is an external negative compiler consumer refusing that precise
nil/type mismatch, a compiling positive consumer and adjacent runtime controls
preserving representable behavior. It is not a fabricated runtime null diagnostic.

| Authored boundary | Cases | Required evidence |
| --- | ---: | --- |
| Handler, policy or phonetic callback returning null | 11 | Exact return type; consultation/nonconsultation, failure order, cause and rethrow controls |
| Null catalog supplier/value/entry/locale key | 4 | Each collection boundary; raw JSON null stays a runtime refusal |
| Null tiebreaker list/entry/language code | 3 | Each nested boundary; an absent whole optional setting stays valid |
| Null placeholder name | 1 | Nonoptional name; explicit null values and missing bindings stay runtime refusals |
| Actually consulted unmapped phonetic return | 1 | Nonoptional `Phonetic`; explicit throw and valid `.other` controls |

Each record retains exact guard paths, individual compiler/runtime control IDs
and all original observation channels as **unreplayed**. The two callbacks that
the reference configured but never consulted still have an unrepresentable native
configuration; adjacent nonconsultation controls remain required. The unmapped
phonetic case requires actual consultation with no mapping/default and cannot be
classified from expected output alone. Null must not silently become `.other`.

### Native filename attribution: five informational cases

Swift completes bounded discovery and orders candidates by unsigned UTF-8 bytes.
The contract permits only the filename determined from authored candidates and
the actual file cap. Complete native/reference observations are required: locales,
keys, failed flag, failure type and every warning stay equal. The whole failure
message must match its specified template. Arbitrary different text is refused.

| Case boundary | Swift filename | Reference filename |
| --- | --- | --- |
| Competing invalid JSON stems | `notes.json` | `zz.json` |
| 257 files, cap 256 | `amh` | `afu` |
| Two files, cap 1 (two cases) | `fr` | `en` |
| Extensionless/JSON alias collision | `en.json` | `en` |

These are complete observed adaptations, not runtime-exact Java matches. Ordinary
duplicate/case/legacy/grandfathered filename behavior remains covered by exact
comparisons. The five selected IDs cannot broaden to other loader refusals.

### JVM carriers: 159 informational cases

Ninety classpath discovery and sixty-nine classloader resource-map cases remain
outside this native profile. Each record retains input/reference fingerprints,
its native carrier choice, adjacent controls and all six unreplayed load channels.
Explicit Apple Bundles and caller-resolved local URLs replace JVM roots/package
names/JAR overlays without replaying those mechanisms. The partition gate still
requires these operations to be informational. They count as neither native
adaptations nor runtime passes. Portable parsing, limits and translation stay
required. Applications own remote downloads; no HTTP transport is required.

## Evidence and reporting

The shared checker produces disjoint exact ID sets. Current Swift evidence has
this accounting; the policy alone produces no runtime results:

| Partition / evidence | Cases |
| --- | ---: |
| Required portable, exact runtime agreement | 2,135 |
| Required portable, qualified native source boundary | 20 |
| Informational, exact runtime agreement | 62 |
| Informational, qualified native filename adaptation | 5 |
| Informational, platform-specific JVM carrier | 159 |
| Total | 2,381 |

Required portable coverage is 2,155; strict runtime agreement stays 2,197 across
both partitions. Original Swift `--audit` still lists 184 unreplayed/different
inputs and exits incomplete. A separate native coverage receipt accounts for
those inputs under this contract, adding no original runtime passes. It preserves
unreplayed channels and port-record digests. Release parity stays false until
independent platform/toolchain/packaging and remaining scoped contract gates pass.

Shared offline checks require only stdlib Python and this repository. Schema
checks use the existing development AJV dependency:

```sh
npm run check:native-adaptations
npm run check:schemas
```

`npm run check` includes both. Neither refreshes an oracle, modifies expectations
or contacts a server. Policy/baseline changes require explicit versioned source
changes and updated consumer pins. Volatile compiler/host receipts stay in the
implementation's ignored build directory rather than the policy artifact.

The separately scoped [manifest native contract](MANIFEST-CONTRACT.md) owns the
499-case JS supplemental archive and its Swift-native profile. Its accounting
adds no cases or passes to this Java corpus or its partitions.
