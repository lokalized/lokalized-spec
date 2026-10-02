# Shared manifest URL / IDNA oracle

The canonical 56,513-case compatibility archive is
[`generated/url-oracle/manifest-idna-goldens.json.gz`](../../generated/url-oracle/manifest-idna-goldens.json.gz).
It was introduced during the Swift port and is now owned here because its inputs
and expected observations are independent of any port. The original case IDs,
input recipe, expected results and decoded SHA-256 are unchanged by migration.
The archive occupies 731,845 bytes and expands to 19,308,094 bytes of JSON.

This is a named observed profile: Node **26.5.0**, Ada **4.0.0**, Unicode **17.0**
mapping, ICU **78.3**, and the exact engine images recorded in
[`reference/IDNA-Compatibility/oracle-runtime-lock.json`](reference/IDNA-Compatibility/oracle-runtime-lock.json).
It preserves the recorded engine's normalization, validity-property and
contextual behavior. It is a supplement to the existing behavioral corpus,
and does not change its version, cases or release dispositions. Ports exposing
manifest URL resolution can consume this profile; its existence does not add
HTTP loading to a port or certify strict UTS #46 / complete WHATWG conformance.

The archive contains 6,389 official Unicode `IdnaTestV2.txt` scalar inputs,
32,203 validity-property discriminants, 17,062 normalization discriminants and
859 authored URL boundaries. The two official source lines containing lone
UTF-16 surrogates (548 and 549) remain explicitly excluded from this scalar
profile; their native string carriers need separate qualification. Expected
results were independently recorded from the pinned Node engine, never from
Swift or Unicode test status columns.

`idna_corpus.py` authors and checks the exact recipe. `property_inputs.py` and
`normalization_inputs.py` generate directed inputs from the frozen data, and
`unicode_inputs.py` parses pinned Unicode inputs. These modules contain no
Swift code, port compiler invocations or upstream runtime algorithms.
`oracle_runtime.py` verifies recorded metadata offline and verifies the actual
loaded engine images during an explicit oracle refresh. All reference inputs
and their licenses are checked in under `reference/`; no download is required.

From the repository root:

```sh
python3 tools/check-url-oracle.py --check
python3 tools/test-url-oracle.py
gzip -dc generated/url-oracle/manifest-idna-goldens.json.gz
```

Normal checks use only Python's standard library. They validate decoded archive
identity, exact authored inputs, output shapes, sorted unique IDs, provenance
and the stored artifact/module inventory in
[`manifest-idna-lock.json`](../../generated/url-oracle/manifest-idna-lock.json).
The gzip reader requires one complete member with a valid CRC/size trailer,
refuses extra members or trailing bytes and limits stored/decoded data to
2 MiB / 32 MiB. Gzip headers omit filenames and use a zero timestamp.

Refreshing observations is a deliberate shared baseline action:

```sh
python3 tools/check-url-oracle.py --refresh-goldens --node /path/to/pinned/node
# Review observations/pins, then record and check the reviewed source snapshot.
python3 tools/check-url-oracle.py --write-lock
python3 tools/check-url-oracle.py --check
```

Refresh requires the exact recorded executable and engine image bytes, not
merely a matching version string. Changes to expectations/profile require
reviewed pins and a coordinated port update. Moving or recompressing the
archive does not rebaseline behavior.

Ports vendor a frozen compressed copy, these recipe modules and their required
data/license inputs into development-only directories. Offline port checks
verify local pins without a sibling checkout; explicit sync/source checks verify
the copy against this canonical repository. Swift's adapter is
`lokalized-swift/Tools/sync_url_oracle.py`. None of this is shipped or loaded by
the production library.

Unicode source data is under Unicode License v3, reproduced in
[`reference/Unicode-17.0.0/LICENSE.txt`](reference/Unicode-17.0.0/LICENSE.txt).
The separately extracted Ada property/normalization data is under the MIT license,
reproduced in [`reference/IDNA-Compatibility/LICENSE-MIT.txt`](reference/IDNA-Compatibility/LICENSE-MIT.txt).
Profile JSON records the exact upstream Node/Ada source URLs and hashes. The
source hashes identify data provenance; expected algorithms remain observations
of the pinned binary.
