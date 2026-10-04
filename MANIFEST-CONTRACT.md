# Shared manifest compatibility and native contracts

The frozen manifest validation, catalog identity and planning observations are
owned by `lokalized-spec`. They describe pure metadata operations; adopting them
does not require HTTP loading. Applications own remote acquisition in Swift.
The ordinary localization catalog format is unchanged.

## Frozen source profile

[`generated/manifest-contract`](generated/manifest-contract) contains the
original 499 observations, lock, schema, source-matched declaration inventory and
JS notices. [`tools/manifest_contracts`](tools/manifest_contracts) owns their
explicit input recipe, oracle adapter and independent bounded identity encoder.
Swift consumes a byte-pinned offline snapshot. The archive and lock are copied
without rewriting any case, expectation, predecessor evidence or source pin:

| Artifact | SHA-256 |
| --- | --- |
| `manifest-contract-vectors.json` (1,176,486 bytes) | `6356098bbde353a66886e9552c45efe7ec6353697cf26be2141d3e9f4811d50a` |
| `manifest-contract-lock.json` | `faaa51bdacd19f1fbd407848ac545221aad4da5d6d02a1095f1d927a2a96bf03` |

The oracle records JS commit `617670da887b0c684e2589882447b6b93297f2f7` on
Node `v26.5.0`, not an npm tarball or every supported Node version. The historical
lock's `Reference/api-inventory.json` label identifies its original provenance;
the exact 192,292-byte inventory now lives beside the shared archive. Generated
JS declarations were untracked, so their digest provenance is retained rather
than described as Git objects. The Node adapter does not run a network loader.
Neither these 499 cases nor native mappings are inserted into the original
2,381-case Java corpus or its partitions.

Offline checks require stdlib Python. Existing development AJV checks both
schemas. Frozen archive bytes retain their original serialization; identity
bytes and the new native policy separately obey their canonical encodings.

```sh
npm run check:manifest-contract
npm run check:schemas
python3 tools/check-manifest-contract.py --inputs
```

Only an explicit reviewed oracle refresh runs JS:

```sh
python3 tools/check-manifest-contract.py --refresh --source-root ../lokalized-js --node /path/to/pinned/node
```

A refresh prints new digests for review; it does not bless them or update port
pins. The shared declaration snapshot must match the reviewed source. Normal
checks need no sibling repository, compiler, Node, Git, network or port runtime.

## Swift native manifest profile 1.0.0

[`conformance/swift-manifest-v1.json`](conformance/swift-manifest-v1.json), its
[schema](schema/manifest-native-adaptations.schema.json), and
[input-derived policy](tools/manifest_contracts/native_policy.py) qualify native
boundaries explicitly. Source selection uses authored inputs before consulting
expected outcomes. Every mapped ID retains the input/reference fingerprints,
original observation channels, exact external compiler consumer and adjacent
runtime control requirements.

| Evidence | Cases |
| --- | ---: |
| Identical native/reference runtime observation | 165 |
| Runtime match under narrow native error projections | 303 |
| Native compiler refusal for type/argument/scalar boundary | 30 |
| Native accepted default for omitted identity format version | 1 |
| Total | 499 |

Twenty-six source refusals cover malformed or missing required identity fields,
nonidentity roots, mistyped digest/tiebreaker values, undeclared argument/budget
names and null planning lookups. Four source refusals cover lone UTF-16 surrogate
keys/values. Swift `String` decoding repairs those units to U+FFFD; neither
`String` nor `ExactString` provides a preserving public constructor. That repair
is observed explicitly and never substituted into the original JS call. Raw
manifest JSON still refuses unpaired surrogate escapes, while real U+FFFD and
supplementary text stay valid adjacent identity inputs.

One important default differs: `CatalogIdentityInputV1` permits omission of its
`formatVersion` argument and uses `1`; JS's dynamic identity object requires the
member. This is an **accepted native default**, qualified by a compiling consumer
and exact identity equality with explicit version `1`. It must never be described
as source rejection or identical JS runtime behavior.

The 303 error projections are defined by the shared
[raw-report checker](tools/manifest_contracts/native_report.py). They retain the
whole original/native receipts and derive only explicit error taxonomy/envelope
changes. Messages, locations, phase, known causes and identity bytes remain
checked. Unknown fields or unregistered causes fail closed. Swift's extra native
parse-cause fields remain in its pinned receipt even where JS has no equivalent.

A port must validate current library source hashes, real compiler diagnostics,
a compiling positive consumer, all sixteen adjacent runtime controls and the
source-bound host manifest run before using the policy to report coverage. Its
separate receipt has status `covered-under-native-contracts-not-certified` and
`releaseParity: false`. The unchanged historical report still has 468 runtime
passes, 31 pending carriers and `nativeMappingsRatified: false`; no compiler
refusal or default adaptation becomes a runtime pass. Minimum compiler, iOS,
Intel, minimum-OS and hosted-CI execution require their own evidence.

## Versioned amendments and evolution direction

The current wire spelling is `tiebreakerLocalesByLanguageCode`. Predecessor source
used `tiebreakers` under the same manifest version and produced different identity
bytes. Keep the current name; any needed legacy compatibility must have an explicit
migration and version contract. No old-name alias is added by this profile.

On October 2, 2026 the maintainer agreed to coordinated, versioned corrections
for known shared behavior defects. [Diagnostic text profile 1.1.0](DIAGNOSTIC-TEXT.md)
now qualifies bounded, valid Unicode messages across Java, JS and Swift.
[Manifest normalization profile 1.1.0](MANIFEST-NORMALIZATION.md) now qualifies
stable private-use locale spelling across JS and Swift and gives an explicit
fingerprint migration. The original archive, lock, 165/303 runtime partition and
native ledger remain historical evidence. The active manifest receipt retains
those complete references, declares exactly four amended expectations and records
162 exact / 306 projected comparisons. Native carrier policy and its thirty
refusals/one accepted default remain unchanged; behavior and carrier profiles
compose without adding a runtime pass or a certified release claim.

The shared URL oracle's recorded Node/Ada normalization/joiner/bidi compatibility
profile remains unchanged. A strict URL/IDNA policy requires its own versioned
proposal and evidence; it is not implied by fixing manifest locale normalization.
