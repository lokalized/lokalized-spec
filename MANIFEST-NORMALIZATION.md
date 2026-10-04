# Manifest normalization profile 1.1.0

The versioned `manifest-normalization-v1.1` profile corrects the serialized locale
boundary shared by JavaScript and Swift manifest validation, identity projection
and planning. Java has no manifest API. Catalog syntax, manifest `formatVersion:
1`, `tiebreakerLocalesByLanguageCode`, core Java-compatible locale behavior and
the separate URL/IDNA profile retain their contracts.

## Rule and public behavior

Perform strict JDK tag parsing/projection, then remove the leading `und-` only
when the projected spelling starts with `und-x-`. Thus `UND-x-foo`,
`Und-X-FOO`, `und-x-foo` and `x-foo` all serialize as `x-foo` in the manifest
domain. Repeating normalization, validation or planning preserves that spelling.
Tags containing script, region, variant or ordinary extensions retain them:
`UND-Latn-x-foo` becomes `und-Latn-x-foo`. Existing legacy alias and lifted
`lvariant` projections also retain their meanings.

Apply this rule to manifest fallback/file/tiebreaker locale values and planning
lookup inputs. Existing pinned-data-known guards still apply to manifest locale
claims: a syntactically valid unknown tag may be a lookup input without becoming
a valid file key or fallback claim. Colliding file keys are refused before entry
validation. CLDR aliases still participate in election without collapsing every
locale ingress to a CLDR alias.

Core locale construction has a separate historical contract: its first projection
of `UND-x-foo` remains `und-x-foo`. In JS, loader coverage uses the stable manifest
spelling; loaded-core and SSR coverage comparisons apply the pure spelling
projection to the core context. SSR still obtains the context from the rendering
instance, retains that core context tag in the stamp and imports no parser, data
or planning kernel. Other locale contexts continue to be refused for a lookup-only
load. Swift supplies pure manifest helpers and local catalog delivery; it has no
network loader or JS SSR stamp API.

Standalone identity property names are arbitrary exact strings. Neither
`computeCatalogIdentity` nor `catalogIdentityBytes` normalizes those names.
`catalogIdentityInputFor` resolves/normalizes the fallback, but preserves authored
file digest keys and tiebreaker arrays when called on an unvalidated claim. Calling
it on a validated manifest projects the already normalized keys and values.

## Migration

Publishers should normalize every manifest locale claim with this rule, reject
collisions, resolve the fallback and complete tiebreaker orders, then compute the
identity from those normalized values. Republish the manifest and regenerate any
JS SSR stamps or application cache keys that carry its fingerprint. A previously
issued fingerprint affected by this correction is refused; it is never silently
accepted as a second identity. Unaffected manifests retain their fingerprints.

The historical uppercase-private-use example declared
`c18f71c4eb07cb1132b653e55d632a0a420a7f16f656f4b9b8b2192627157cf6`.
Its normalized manifest now computes
`f7ea09a85605ee292ac091ee99e059dc065fea27a5745227095bf022592ac90d`.
Its raw identity helper projection retains the authored `UND-x-foo` digest key
and therefore has a different fingerprint from the validated normalized manifest;
a raw claim projection is not a publishing normalizer.

This is an explicit behavioral profile amendment within wire format 1. It adds
no legacy `tiebreakers` alias or runtime compatibility switch. Compatibility with
a particular published predecessor artifact would need its own documented
version/migration contract.

## Shared artifacts and retained history

[`generated/manifest-normalization/v1.1.json`](generated/manifest-normalization/v1.1.json)
contains 35 independent cases: twenty literal normalization/core-separation
controls, twelve complete public validation/parsing/identity/configuration/planning
round trips, two collision refusals and one unknown pinned-locale refusal.
The stdlib-only [recipe](tools/manifest_normalization/contract.py) constructs
expected identity bytes/digests independently of either runtime locale library.
The [schema](schema/manifest-normalization.schema.json) and canonical-byte gate
check the complete artifact. Its SHA-256 is
`9fb02c5a607e6288ef46e49a9161a4bc0d0d23aed98931f7c0482a21a8714162`.

The original 499-case [archive](MANIFEST-CONTRACT.md) and lock retain their exact
bytes. Four named amendments retain their original inputs, operations, full
historical expectations and expectation hashes alongside corrected expectations:

- `m7a.parse.fallback.upper-und-private-use`
- `m7a.plan.upper-und-private-use.chain`
- `m7a.projection.upper-und-private-use`
- `m7a.validate.fallback.upper-und-private-use`

Three now refuse the stale fingerprint; the raw projection case returns the
corrected fallback while retaining the raw digest key. All other historical
expectations remain binding. The active Swift report separately records 464
unchanged historical runtime agreements and four amended comparisons: 468 runtime
comparisons in total, partitioned as 162 identical native observations and 306
named error-representation projections. The original 165/303 partition remains
historical evidence. The 31 native carrier adaptations continue under the existing
`swift-native-manifest-v1` profile; no amendment promotes them to runtime passes.

The [active native lock](generated/manifest-normalization/swift-native-lock-v1.1.json)
derives the complete new ledger from the frozen historical native receipt and
exactly these four expected corrections. Its native-ledger SHA-256 is
`9c32c1317bf94e8409f36979ce058829d2b73ce78acccd8cd6c96b5055e09de4`.
The original ledger pin remains
`54aa67d6962a9bf1b3f123ebbd6205004c3ce0d272f36270608656fd3957f548`.
Actual Swift observations must match the independently pinned amended ledger.
Both complete historical and amended reference observations remain in the report.

## Checks and qualification limits

```sh
npm run check:manifest-normalization
npm run check:schemas
python3 tools/test-manifest-normalization.py
```

Normal artifact checks need no sibling repository, network, port compiler or
runtime execution. Saved-report checks in [the shared checker](tools/manifest_normalization/report.py)
validate every actual observation and identity byte through the frozen input/error
projection rules. Eighteen active-archive and thirteen new-profile corruption
controls refuse altered profile pins, amendment inventories, history claims,
references, observations and unknown fields. The old report scope still uses the
unchanged historical checker; it cannot certify an amended receipt.

JS and Swift execute all 35 cases and four archive amendments. Swift additionally
binds native carrier coverage to current compiler diagnostics, sixteen adjacent
controls, current source/verifier hashes and fresh SDK/host execution. The native
coverage receipt remains `covered-under-native-contracts-not-certified` with
`releaseParity: false`. Current host/SDK evidence does not establish minimum
Swift 6.2, minimum iOS/macOS, iOS/Intel runtime or hosted CI execution.
