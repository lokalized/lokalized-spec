# lokalized-spec
Common specification data for Lokalized ports

[Public API naming policy](API-NAMING.md)

[Native conformance contracts](NATIVE-ADAPTATIONS.md) define versioned native
boundaries and evidence requirements separately from exact runtime agreement
and informational platform-specific cases.

[Shared manifest URL / IDNA oracle](tools/url_oracle/README.md) contains the
port-agnostic frozen compatibility corpus and its offline input/provenance checks.

[Shared manifest contract](MANIFEST-CONTRACT.md) owns the frozen validation,
identity and planning observations, input recipe, oracle and versioned Swift
native adaptations. These pure helpers require no network transport.

[Diagnostic text profile 1.1.0](DIAGNOSTIC-TEXT.md) defines bounded, well-formed
nested duplicate-member messages shared by Java, JS and Swift.

[Manifest normalization profile 1.1.0](MANIFEST-NORMALIZATION.md) makes private-use
locale spelling stable across validation, identity and planning, with explicit
historical amendments and fingerprint migration.

[Oracle replay inputs](ORACLE-REPLAY.md) distinguish the current Java surface
inventory from the historical Java build used by frozen behavioral/IANA checks.
