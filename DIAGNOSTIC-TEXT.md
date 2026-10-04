# Diagnostic text profile 1.1.0

`generated/diagnostic-text/v1.1.json` defines the shared diagnostic-text amendment,
with 36 language-neutral raw JSON cases and independently computed expected
messages. This is the first standalone diagnostic profile. It supplements the
frozen Java behavioral corpus and JS manifest archive; their historical bytes,
observations and case dispositions are retained.

The scope is nested duplicate-object-member diagnostics at the catalog and raw
manifest parsing doors. Catalog member displays were already capped at 256
UTF-16 units, and paths at 4,096. Manifest member displays now use the same cap.
Java has no manifest parsing door and executes the 18 catalog cases. JS and
Swift execute all 36. The profile is a behavioral correction, independent of
catalog syntax, manifest `formatVersion: 1`, locale normalization and URL policy.

## Exact truncation rule

A part that fits within the remaining UTF-16 budget is retained verbatim. For
an overflowing part, reserve one unit for `…` (U+2026). Retain the preceding
UTF-16 units, replacing a retained high surrogate with `�` (U+FFFD) when its
paired low surrogate falls outside the prefix. Then append the ellipsis. This
keeps the cap exact and keeps diagnostics derived from valid Unicode input
well formed. Java and JS previously emitted a lone high surrogate at this
boundary; Swift already decoded the prefix with this replacement behavior.

Paths start with `$` and append the separator, component and suffix as separate
parts. Once the cap is full, later parts do not extend it. A separator can fill
the final unit without an ellipsis. Truncation uses UTF-16 units; it does not
normalize Unicode or preserve whole grapheme clusters. Existing authored lone
surrogates retain each platform's existing parsing policy: this amendment only
repairs pairs split by truncation.

The common message is `SOURCE: duplicate JSON object member 'MEMBER' encountered
at PATH`. Native error representations remain platform-specific: Java exposes
`LocalizedStringLoadingException`; JS and Swift expose `StringsParseError`.
For catalog errors, JS/Swift retain a separate `path` field; their nested
manifest errors retain their existing absent/null `path` field, with the path
present in the message. Source and refusal precedence stay intact.

## Artifact and qualification

Artifact SHA-256: `1394c9136089b2b343f562f4ff7ade8d209f7b049b784fe1cc02eb041045c2a2`.
Sorted ID SHA-256: `e54f84151ee67db3ad9c93b17b4f6208abbaa1f07fb33c96ba9d1237ededdca4`.
The scalar-based Python recipe in `tools/diagnostic_text/contract.py` is independent
of all three production implementations. It covers pairs before, at and after
both caps, nested/terminal paths, ASCII, authored replacement characters and
combining sequences. `schema/diagnostic-text.schema.json` constrains the shape;
the recipe checker also fixes exact IDs, inputs, expected text and artifact bytes.

Run `npm run check:diagnostic-text` or the two Python scripts directly. Six
stdlib-only tests include changed-artifact and duplicate-field refusals plus
15 deliberately corrupted saved-observation reports. A saved-report checker
validates the recorded observations; it cannot itself prove execution.

Each port keeps a byte-identical development fixture, verifies its digest and
calls the actual public parser. Java and JS fixtures live in their test trees.
Swift consumes a five-artifact offline snapshot via `Tools/sync_diagnostic_text.py`.
Its standalone `--diagnostic-text` command retains actual error observations,
compares exact UTF-16 units, and fails on any difference. The Apple deployment
qualification hashes the profile, checker and current sources, builds fresh
binaries for four SDK targets, and executes this command on the matching native
macOS host. Minimum-OS/iOS/Intel runtime qualification requires actual execution
on those platforms. These supplemental cases do not add passes to the frozen
core or manifest ledgers and do not constitute a release certification.

No runtime package dependency or remote loading capability is introduced.
