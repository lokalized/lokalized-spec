# Exact Unicode identifiers

`generated/exact-identifier/v1.json` is a fifteen-case supplemental profile shared
by Java, JavaScript and Swift. The frozen Java 3.1.0 behavioral corpus and its
ID partitions remain unchanged. The artifact SHA-256 is
`3b20ec306ec5da919909e28a6db04085ad4cf9133d76adb6cf87f3631ee72e6f`.

Catalog keys and placeholder names use their decoded Unicode spelling exactly;
they are not NFC- or NFD-normalized. The fixture keeps catalog documents as
**source strings** so a host JSON dictionary cannot silently collapse two
canonically equivalent member names before the Lokalized parser reads them.
Each port parses the source with its public catalog API and performs the same
lookup through its public translation runtime. Swift compares returned text by
UTF-16 code units, since native `String` equality treats canonical equivalents
as equal.

| Case | Required observation |
|---|---|
| `exact-key.paired-composed` | A composed key selects its own translation |
| `exact-key.paired-decomposed` | A decomposed key selects its different translation |
| `exact-key.composed-only-misses-decomposed` | The decomposed lookup misses a composed-only catalog |
| `exact-key.decomposed-only-misses-composed` | The reverse lookup misses too |
| `exact-placeholder.paired` | Two canonically equivalent placeholder names receive different values |
| `exact-key.escaped-literal-duplicate` | An escaped and literal spelling of the same decoded key is refused as an exact duplicate |
| `identifier.unicode-continuations` | Mn/Mc/Me marks and Nl/No/Nd numbers can continue a generated placeholder name |
| `identifier.supplementary-letter` | U+10400 is accepted as one initial letter and renders its generated fragment |
| `identifier.ascii-punctuation` | Underscore can start a name; hyphen can continue it |
| `identifier.leading-mark` | U+0301 cannot start a name |
| `identifier.leading-letter-number` | U+216B is a number, so it cannot start a name |
| `identifier.leading-digit` | An ASCII digit cannot start a name |
| `identifier.leading-hyphen` | Hyphen cannot start a name |
| `identifier.emoji-continuation` | U+1F600 cannot continue a name |
| `identifier.format-continuation` | U+200D cannot continue a name |

The existing identifier grammar is `[L_][LNM_-]*` over Unicode scalars. The
continuation case uses U+0301 (Mn), U+093E (Mc), U+20DD (Me), U+216B (Nl), U+00B2
(No) and ASCII `2` (Nd) after a letter. These established code points agree in
the Java, JS and Swift implementations. This profile samples the category and
scalar boundaries; it does not certify an entire host Unicode-category database
or change Swift's pinned Unicode 15.0 identifier tables.

The shared profile pins lookup status, exact result key/translation and ordered
locale attempts. Each parser refusal also pins the exact diagnostic text,
including the offending name and caller-supplied source label. Error types
remain native to each language. This
profile does not change locale-tag normalization or URL IDNA behavior.

The spec checker validates the decoded source-member sequence, exact case
inventory, result relationships and three byte-identical port snapshots. Each
port pins the snapshot digest and needs no sibling checkout at runtime. Run:

```sh
# lokalized-spec
npm run check:exact-identifier
python3 tools/check_exact_identifier.py --sibling-check

# lokalized-java
mvn -q -Dtest=ExactIdentifierProfileTests test

# lokalized-js
node --test test/exact-identifier-profile.test.js

# lokalized-swift
swift test --filter ExactIdentifierProfileTests
```

The profile and snapshots are development/test artifacts. They add no runtime
dependencies or network loading behavior to any port.
