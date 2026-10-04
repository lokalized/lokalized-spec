#!/usr/bin/env python3
"""Freeze/check independent JS manifest-contract observations. Python stdlib only.

--check reads this repository only, without Node, git, a network, or sibling repos.
--refresh requires explicit --source-root and runs exports from immutable git objects.
The original behavioral corpus and baseline are never changed by this tool.
Canonical ownership: lokalized-spec; ports consume pinned offline snapshots.
"""
import argparse
import base64
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "generated/manifest-contract"
CORPUS = ROOT / "generated/behavioral-vectors.json"
COMMIT = "617670da887b0c684e2589882447b6b93297f2f7"
PREVIOUS_COMMIT = "cb3a61c14ecd9086e11f226f6063a13665d43a8c"
CORPUS_SHA = "1eb74caf8524c0a3b33dca99addb268c86b64eb8321fac03257474ddaa3c9753"
NODE_VERSION = "v26.5.0"
VECTORS_SHA = "6356098bbde353a66886e9552c45efe7ec6353697cf26be2141d3e9f4811d50a"
LOCK_SHA = "faaa51bdacd19f1fbd407848ac545221aad4da5d6d02a1095f1d927a2a96bf03"
VECTORS = REFERENCE / "manifest-contract-vectors.json"
LOCK = REFERENCE / "manifest-contract-lock.json"
ORACLE = Path(__file__).with_name("oracle.mjs")
SCHEMA = REFERENCE / "manifest-contract-vectors.schema.json"
def configure(reference, corpus=None):
    global REFERENCE, VECTORS, LOCK, SCHEMA, CORPUS
    REFERENCE = Path(reference)
    VECTORS = REFERENCE / "manifest-contract-vectors.json"
    LOCK = REFERENCE / "manifest-contract-lock.json"
    SCHEMA = REFERENCE / "manifest-contract-vectors.schema.json"
    CORPUS = Path(corpus) if corpus is not None else REFERENCE / "behavioral-vectors.json"

BUILD = {
    "cldrVersion": "48.2",
    "dataFingerprint": "9b4f24165b6dd1ee6dbb5f0822abc7bcde49c5b94d35903045826b45e1f30e68",
    "behavioralVectorsVersion": "1.1.0",
    "localeDataMode": "pinned", "cardinalityMode": "exact",
    "ianaRegistryDate": "2026-09-17",
    "ianaDataFingerprint": "87b3a43b03f490206cead05d865357bd7cfc3953a52ec4d8405243f699385815",
}
OPERATIONS = {
    "validateStringsManifest", "parseStringsManifest", "localeConfigurationForManifest",
    "computeCatalogIdentity", "identityForManifest", "chain", "fetchSet", "wholeManifestPlan",
}
REVIEW_FILES = [
    "package.json", "README.md", "LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md",
    "test/manifest.test.js", "test/planning.test.js", "test/catalog-identity.test.js",
    "test/manifest-build-identity.test.js", "test/manifest-tiebreakers.test.js",
    "test/manifest-fallback-resolution.test.js", "test/manifest-url-and-bytes.test.js",
    "test/identity-projection-and-error-classes.test.js", "test/manifest-trust-boundary.test.js",
]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def compact(value):
    # Input document serialization preserves declaration order. It is NOT JCS.
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), allow_nan=False)

def canonical(value):
    # Independent bounded JCS encoder for the identity projection's value classes.
    if isinstance(value, str):
        value.encode("utf-8", "strict")
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int) and abs(value) <= 9007199254740991:
        return str(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: key.encode("utf-16-be", "strict"))
        return "{" + ",".join(canonical(key) + ":" + canonical(value[key]) for key in keys) + "}"
    raise ValueError("Outside independently checked bounded JCS classes")

def identity_input(manifest, *, resolved=None, files=None, order=None):
    return {
        "formatVersion": 1, "catalogVersion": manifest["catalogVersion"],
        "resolvedFallbackLocale": manifest["fallbackLocale"] if resolved is None else resolved,
        "localeToSha256": {tag: file["sha256"] for tag, file in (manifest["files"] if files is None else files).items()},
        "tiebreakerLocalesByLanguageCode": manifest["tiebreakerLocalesByLanguageCode"] if order is None else order,
    }

def digest_for(tag):
    # Distinct deterministic file digests prevent wrong-file projections looking correct.
    return sha(("catalog-file:" + tag).encode())

def manifest(files=None, *, fallback="en", order=None, base="https://cdn.example/v1/", resolved=None):
    files = {tag: {"url": tag + ".json", "sha256": digest_for(tag)} for tag in (files or ["en", "fr"])}
    result = {
        "formatVersion": 1, "catalogVersion": "m7a.2026.10.01", "catalogFingerprint": "0" * 64,
        **BUILD, "fallbackLocale": fallback, "baseUrl": base, "files": files,
        "tiebreakerLocalesByLanguageCode": deepcopy(order or {}),
    }
    result["catalogFingerprint"] = sha(canonical(identity_input(result, resolved=resolved)).encode())
    return result

def rebuild(value, *, resolved=None, normalized_files=None, normalized_order=None):
    value["catalogFingerprint"] = sha(canonical(identity_input(value, resolved=resolved, files=normalized_files, order=normalized_order)).encode())
    return value

def inputs():
    rows = []
    def add(label, operation, input):
        rows.append({"id": "m7a." + label, "operation": operation, "input": input})
    def semantic(label, value, options=None, both=True):
        argument = {"manifestJSON": compact(value)}
        if options is not None: argument["optionsJSON"] = compact(options)
        add("validate." + label, "validateStringsManifest", argument)
        if both:
            raw = compact(value).encode()
            byte_input = {"carrier": "bytes", "documentBase64": base64.b64encode(raw).decode()}
            if options is not None: byte_input["optionsJSON"] = compact(options)
            add("parse." + label, "parseStringsManifest", byte_input)
    def change(label, path, value, *, missing=False):
        draft = manifest()
        node = draft
        for key in path[:-1]: node = node[key]
        if missing: del node[path[-1]]
        else: node[path[-1]] = value
        semantic(label, draft)
    base = manifest()
    semantic("valid", base)
    for label, value in [("root-null", None), ("root-array", []), ("root-number", 17), ("root-string", "manifest")]:
        semantic(label, value)
    for key, values in {
        "formatVersion": [None, 0, 2, "1", True],
        "catalogVersion": [None, "", 1],
        "catalogFingerprint": [None, "", "A" * 64, "a" * 63, "9" * 64],
        "cldrVersion": [None, "", "48.x", 48, "47.1"],
        "dataFingerprint": [None, "A" * 64, "e" * 64],
        "behavioralVectorsVersion": [None, "", "1.x", "99.0.0"],
        "localeDataMode": [None, "host"], "cardinalityMode": [None, "approximate"],
        "ianaRegistryDate": [None, "", 17, "1999-01-01"],
        "ianaDataFingerprint": [None, "A" * 64, "f" * 64],
        "fallbackLocale": [None, "", 17, "zz", "en_US", "de"],
        "baseUrl": [None, "", "/relative/", "ftp://example.test/", "data:text/plain,x", "https://[bad/"],
        "files": [None, [], "files", {}],
        "tiebreakerLocalesByLanguageCode": [None, [], "orders"],
    }.items():
        change(key + ".missing", [key], None, missing=True)
        for index, value in enumerate(values): change(key + ".invalid-" + str(index), [key], value)
    for key, values in {
        "url": [None, "", 17, "ftp://example.test/file.json", "https://[bad/file"],
        "sha256": [None, "", "A" * 64, "a" * 63],
        "decodedBytes": [None, -1, 1.5, "14", 9007199254740992],
    }.items():
        if key != "decodedBytes": change("file." + key + ".missing", ["files", "en", key], None, missing=True)
        for index, value in enumerate(values): change("file." + key + ".invalid-" + str(index), ["files", "en", key], value)
    for label, value in [("null", None), ("array", []), ("string", "entry")]: change("file.entry-" + label, ["files", "en"], value)
    for label, tag in [("unknown", "zz"), ("malformed", "en_US"), ("empty", ""), ("private-use", "x-foo")]:
        draft = manifest()
        draft["files"][tag] = {"url": "other.json", "sha256": "c" * 64}
        semantic("file-key." + label, draft)
    for label, tag in [("case", "EN"), ("legacy", "iw"), ("grandfathered", "i-klingon")]:
        draft = manifest()
        collision = {"case": "en", "legacy": "he", "grandfathered": "tlh"}[label]
        draft["files"][collision] = {"url": collision + ".json", "sha256": "d" * 64}
        draft["files"][tag] = {"url": tag + ".json", "sha256": "e" * 64}
        semantic("file-key.normalized-duplicate-" + label, draft)
    for label, base_url in [("https", "https://CDN.Example:443/a/../v1/"), ("http", "http://localhost:8080/v1/"), ("file", "file:///srv/catalogs/")]:
        semantic("scheme." + label, manifest(base=base_url))
    draft = manifest(); draft["files"]["en"]["decodedBytes"] = 0; draft["files"]["fr"]["decodedBytes"] = 9007199254740991
    semantic("decodedBytes.valid-boundaries", draft)
    draft = manifest(); draft["ignored"] = {"deep": [[[[1]]]]}; draft["files"]["en"]["ignored"] = True
    semantic("unknown-manifest-members-are-projected-away", draft)
    draft = manifest(); draft["tiebreakers"] = {"fr": ["fr"]}; del draft["tiebreakerLocalesByLanguageCode"]
    semantic("earlier-wire-name-is-not-an-alias", draft)
    for label, order in [
        ("absent", {}), ("wrong-key", {"de": ["en", "en-001"]}),
        ("not-array", {"en": "en"}), ("invalid-member", {"en": ["en", "zz"]}),
        ("null-member", {"en": ["en", None]}), ("repeat", {"en": ["en", "en"]}),
        ("missing", {"en": ["en"]}), ("unrelated", {"en": ["en", "en-US"]}),
        ("non-language-key", {"en-US": ["en", "en-001"]}),
    ]:
        draft = manifest(["en", "en-001", "fr"], order={"en": ["en-001", "en"]})
        draft["tiebreakerLocalesByLanguageCode"] = order
        semantic("tiebreaker." + label, draft)
    for label, fallback, files, order, resolved in [
        ("exact-before-equivalent", "de", ["de", "deu"], {"de": ["deu", "de"]}, "de"),
        ("exact-normalized", "DE", ["de", "deu"], {"de": ["deu", "de"]}, "de"),
        ("sole-equivalent", "sh", ["sr-Latn", "en"], {}, "sr-Latn"),
        ("legacy-equivalent", "iw", ["he", "en"], {}, "he"),
        ("ordered-equivalent-a", "sr-Latn", ["en", "hbs", "sh", "sr-Cyrl"], {"sr": ["sr-Cyrl", "sh", "hbs"]}, "sh"),
        ("ordered-equivalent-b", "sr-Latn", ["en", "hbs", "sh", "sr-Cyrl"], {"sr": ["hbs", "sr-Cyrl", "sh"]}, "hbs"),
        ("und-sole", "und", ["und-bokmal", "fr"], {}, "und-bokmal"),
        ("und-exact", "und-bokmal", ["und-bokmal", "und-nynorsk"], {}, "und-bokmal"),
    ]:
        semantic("fallback." + label, manifest(files, fallback=fallback, order=order, resolved=resolved))
    semantic("fallback.und-ambiguous", manifest(["und-bokmal", "und-nynorsk"], fallback="und"))
    semantic("fallback.same-primary-is-not-equivalent", manifest(["en-US", "fr"], fallback="en-GB"))
    semantic("file-cap.at-limit", base, {"limits": {"maximumLocalizedStringsFiles": 2}})
    semantic("file-cap.over-limit", base, {"limits": {"maximumLocalizedStringsFiles": 1}})
    for count, label, options in [(256, "default-256", None), (257, "default-257", None),
                                  (257, "raised-257", {"limits": {"maximumLocalizedStringsFiles": 257}})]:
        tags = ["en"] + ["en-x-p" + str(index).zfill(3) for index in range(1, count)]
        semantic("file-cap." + label, manifest(tags, order={"en": list(reversed(tags))}), options)
    # Pinned JS's normalization of uppercase UND plus private-use is not
    # idempotent. The intentionally paired claims record that fact, not a fix.
    upper_und = manifest(["UND-x-foo"], fallback="UND-x-foo")
    upper_normalized_files = {"und-x-foo": upper_und["files"]["UND-x-foo"]}
    rebuild(upper_und, resolved="x-foo", normalized_files=upper_normalized_files)
    lower_und = deepcopy(upper_und); lower_und["fallbackLocale"] = "und-x-foo"; lower_und["files"] = upper_normalized_files
    semantic("fallback.upper-und-private-use", upper_und)
    semantic("fallback.once-normalized-und-private-use", lower_und)
    # Multiple faults make the order of real validation checks observable.
    for label, changes in [
        ("format-before-version", [("formatVersion", 2), ("catalogVersion", "")]),
        ("fingerprint-shape-before-provenance", [("catalogFingerprint", "bad"), ("cldrVersion", "bad")]),
        ("cldr-before-mode", [("cldrVersion", "47"), ("localeDataMode", "host")]),
        ("fallback-before-url", [("fallbackLocale", "zz"), ("baseUrl", "/bad")]),
        ("url-before-files", [("baseUrl", "/bad"), ("files", [])]),
        ("files-before-tiebreakers", [("files", []), ("tiebreakerLocalesByLanguageCode", [])]),
    ]:
        draft = manifest()
        for key, value in changes: draft[key] = value
        semantic("priority." + label, draft)
    for label, names in [("fr-before-zz", ["fr", "zz"]), ("zz-before-fr", ["zz", "fr"])]:
        draft = manifest(); draft["files"] = {tag: {"url": "", "sha256": "bad"} for tag in names}
        semantic("priority.file-declaration-" + label, draft)

    text = compact(base)
    def raw(label, payload, *, carrier="bytes", options=None):
        data = {"carrier": carrier}
        if carrier == "text": data["text"] = payload
        else: data["documentBase64"] = base64.b64encode(payload if isinstance(payload, bytes) else payload.encode()).decode()
        if options is not None: data["optionsJSON"] = compact(options)
        add("parse.lexical." + label, "parseStringsManifest", data)
    raw("text-twin", text, carrier="text")
    raw("one-leading-bom", b"\xef\xbb\xbf" + text.encode())
    raw("two-leading-bom", b"\xef\xbb\xbf\xef\xbb\xbf" + text.encode())
    raw("bom-after-whitespace", " \ufeff" + text)
    raw("duplicate-root", text.replace('"cldrVersion"', '"catalogVersion":"other","cldrVersion"'))
    raw("duplicate-files", text.replace('"fr":', '"en":'))
    raw("duplicate-file-entry", text.replace('"url":"en.json"', '"url":"x.json","url":"en.json"'))
    raw("duplicate-unknown-root", text[:-1] + ',"extra":1,"extra":2}')
    raw("duplicate-unknown-nested", text[:-1] + ',"extra":{"x":1,"x":2}}')
    for label, broken in [("empty", ""), ("broken-object", "{ not json"), ("trailing-data", text + " []"),
        ("trailing-comma", text[:-1] + ",}"), ("unclosed-string", '{"catalogVersion":"abc'),
        ("invalid-escape", '{"x":"\\q"}'), ("control-in-string", '{"x":"a\nb"}'),
        ("leading-zero-number", '{"formatVersion":01}'), ("supplementary-before-fault", '{"😀":1,?}'),
        ("crlf-location", '{\r\n"formatVersion":1,\r\n?}')]:
        raw(label, broken, options={"source": "manifest-input.json"})
    for label, octets in [("utf8-overlong", b"\xc0\xaf"), ("utf8-surrogate", b"\xed\xa0\x80"),
        ("utf8-truncated", b"\xf0\x9f\x98"), ("utf8-out-of-range", b"\xf4\x90\x80\x80"),
        ("utf8-isolated-continuation", b"\x80")]: raw(label, octets)
    raw("bytes-at-cap", text, options={"limits": {"maximumInputBytes": len(text.encode())}})
    raw("bytes-over-cap", text, options={"limits": {"maximumInputBytes": len(text.encode()) - 1}})
    raw("reader-at-cap", text, options={"limits": {"maximumReaderCharacters": len(text)}})
    raw("reader-over-cap", text, options={"limits": {"maximumReaderCharacters": len(text) - 1}})
    unicode_draft = manifest(); unicode_draft["catalogVersion"] = "é😀"; rebuild(unicode_draft)
    unicode_text = compact(unicode_draft).replace("\\u00e9", "é").replace("\\ud83d\\ude00", "😀")
    utf16_count = len(unicode_text.encode("utf-16-le")) // 2
    raw("reader-utf16-at-cap", unicode_text, carrier="text", options={"limits": {"maximumReaderCharacters": utf16_count}})
    raw("reader-utf16-over-cap", unicode_text, carrier="text", options={"limits": {"maximumReaderCharacters": utf16_count - 1}})
    raw("nesting-over-cap", text, options={"limits": {"maximumJsonNestingDepth": 2}})
    raw("nesting-at-cap", text, options={"limits": {"maximumJsonNestingDepth": 3}})
    unknown_depth = deepcopy(base); unknown_depth["ignored"] = [[[[0]]]]
    raw("unknown-member-nesting-still-charged", compact(unknown_depth), options={"limits": {"maximumJsonNestingDepth": 3}})
    semantic("object-door-does-not-charge-source-depth", unknown_depth, {"limits": {"maximumJsonNestingDepth": 1}}, both=False)
    for name, invalid in [
        ("maximumInputBytes", 0), ("maximumReaderCharacters", 0), ("maximumJsonNestingDepth", 129),
        ("maximumTotalInputBytes", 0), ("maximumLocalizedStringsFiles", 0),
        ("maximumTranslationNodes", -1), ("maximumWarnings", -1), ("unknownBudget", 1),
    ]:
        semantic("limits." + name, base, {"limits": {name: invalid}})
    for label, options in [("unknown-option", {"mystery": 1}), ("near-miss-option", {"loadingLimits": {}}),
        ("source-not-an-object-option", {"source": "a.json"})]:
        semantic(label, base, options, both=label != "source-not-an-object-option")

    # Identity is intentionally independent of semantic manifest validation.
    ident = identity_input(manifest(["en", "en-001", "fr"], order={"en": ["en-001", "en"]}))
    def ident_case(label, value): add("identity." + label, "computeCatalogIdentity", {"identityInputJSON": compact(value)})
    ident_case("base", ident)
    for label, key, value in [("version-control", "catalogVersion", "other"), ("fallback-control", "resolvedFallbackLocale", "fr")]:
        changed = deepcopy(ident); changed[key] = value; ident_case(label, changed)
    changed = deepcopy(ident); changed["localeToSha256"]["en"] = "c" * 64; ident_case("digest-control", changed)
    changed = deepcopy(ident); changed["tiebreakerLocalesByLanguageCode"]["en"].reverse(); ident_case("ordered-array-control", changed)
    changed = deepcopy(ident); changed["localeToSha256"] = dict(reversed(list(changed["localeToSha256"].items()))); ident_case("object-order-invariance", changed)
    changed = deepcopy(ident); changed["unrecognized"] = {"ignored": True}; ident_case("extra-member-exclusion", changed)
    for label, keys in [
        ("utf16-key-order", ["\U00010000", "\ufffd", "a", "é", "e\u0301"]),
        ("minimal-string-escapes", ['"', "\\", "\b", "\t", "\n", "\f", "\r", "\x00", "\x1f", "/", "\u2028", "\u2029"]),
        ("prototype-name-is-a-key", ["__proto__", "constructor", "toString"]),
    ]:
        changed = deepcopy(ident); changed["localeToSha256"] = {key: digest_for(key) for key in keys}; ident_case(label, changed)
    changed = deepcopy(ident); changed["catalogVersion"] = "é😀\u2028\u2029/\n"; ident_case("unicode-version", changed)
    for label, value in [("root-null", None), ("root-number", 1), ("root-array", [])]: ident_case(label, value)
    for key, values in {"formatVersion": [None, 2, "1"], "catalogVersion": [None, "", 1],
        "resolvedFallbackLocale": [None, "", 1]}.items():
        changed = deepcopy(ident); del changed[key]; ident_case(key + ".missing", changed)
        for index, value in enumerate(values):
            changed = deepcopy(ident); changed[key] = value; ident_case(key + ".invalid-" + str(index), changed)
    for label, value in [("uppercase", "A" * 64), ("short", "a" * 63), ("null", None)]:
        changed = deepcopy(ident); changed["localeToSha256"]["en"] = value; ident_case("digest." + label, changed)
    for label, value in [("not-array", "en"), ("null-element", [None]), ("fractional-element", [0.5]), ("safe-integer-element", [9007199254740991])]:
        changed = deepcopy(ident); changed["tiebreakerLocalesByLanguageCode"] = {"en": value}; ident_case("array." + label, changed)
    for label, value in [("high", "\ud800"), ("low", "\udfff")]:
        changed = deepcopy(ident); changed["catalogVersion"] = value; ident_case("lone-surrogate." + label, changed)
        changed = deepcopy(ident); changed["localeToSha256"] = {value: "a" * 64}; ident_case("lone-surrogate-key." + label, changed)
    for key in ["localeToSha256", "tiebreakerLocalesByLanguageCode"]:
        changed = deepcopy(ident); del changed[key]; ident_case(key + ".missing-means-empty", changed)
        changed = deepcopy(ident); changed[key] = None; ident_case(key + ".null-means-empty", changed)

    transport = manifest(["en", "en-001", "fr"], order={"en": ["en-001", "en"]})
    def projected(label, draft): add("projection." + label, "identityForManifest", {"manifestJSON": compact(draft)})
    projected("base", transport)
    for key, value in {"baseUrl": "https://other.test/v2/", "catalogFingerprint": "f" * 64,
        "cldrVersion": "47", "dataFingerprint": "f" * 64, "ianaRegistryDate": "old",
        "ianaDataFingerprint": "f" * 64, "behavioralVectorsVersion": "99", "localeDataMode": "host",
        "cardinalityMode": "approximate"}.items():
        changed = deepcopy(transport); changed[key] = value; projected("exclude." + key, changed)
    changed = deepcopy(transport); changed["files"]["en"]["url"] = "https://other.test/new.json"; projected("exclude.file-url", changed)
    changed = deepcopy(transport); changed["files"]["en"]["decodedBytes"] = 99; projected("exclude.file-size", changed)
    changed = deepcopy(transport); changed["files"]["en"]["sha256"] = "f" * 64; projected("include.file-sha", changed)
    projected("fallback-alias", manifest(["sr-Latn", "en"], fallback="sh", resolved="sr-Latn"))
    projected("upper-und-private-use", upper_und)
    projected("once-normalized-und-private-use", lower_und)

    # Planning inputs reproduce discriminating JS tests, not outputs from Swift.
    planning_cases = [
        ("simple", ["en", "fr"], "en", {}, ["fr-CA", "fr", "FR-ca", "zz-ZZ", "de-DE-u-ca-gregory"]),
        ("regional-order", ["en-GB", "en-US", "en-CA", "fr"], "fr", {"en": ["en-CA", "en-GB", "en-US"]}, ["en-US", "en"]),
        ("norwegian", ["nb", "en"], "en", {}, ["no", "nn", "no-NO", "nb-NO"]),
        ("script-boundary", ["sr", "en"], "en", {}, ["sr-Latn-RS", "sr-Cyrl-RS"]),
        ("script-order-a", ["sr-Cyrl-BA", "sr-Cyrl-RS", "sr-Latn", "en"], "en", {"sr": ["sr-Cyrl-BA", "sr-Cyrl-RS", "sr-Latn"]}, ["sr-RS"]),
        ("script-order-b", ["sr-Cyrl-BA", "sr-Cyrl-RS", "sr-Latn", "en"], "en", {"sr": ["sr-Cyrl-RS", "sr-Cyrl-BA", "sr-Latn"]}, ["sr-RS"]),
        ("chinese-script", ["zh-Hans", "zh-Hant", "en"], "en", {"zh": ["zh-Hant", "zh-Hans"]}, ["zh-TW", "zh-CN"]),
        ("private-und", ["x-foo", "und-bokmal", "en"], "en", {}, ["x-foo", "x-bar", "und", "und-nynorsk"]),
        ("variant-case-distinct", ["en-FONIPA", "en-fonipa"], "en-FONIPA", {"en": ["en-FONIPA", "en-fonipa"]}, ["en-FONIPA", "en-fonipa"]),
        ("und-variant-case-distinct", ["und-BOKMAL", "und-bokmal"], "und-BOKMAL", {}, ["und-BOKMAL", "und-bokmal"]),
        ("jdk-lvariant", ["en", "ja", "th"], "en", {}, ["en-US-x-lvariant-POSIX", "ja-JP-x-lvariant-JP", "th-TH-x-lvariant-TH"]),
    ]
    for label, files, fallback, order, lookups in planning_cases:
        draft = manifest(files, fallback=fallback, order=order)
        for index, lookup in enumerate(lookups):
            for operation in ["chain", "fetchSet"]:
                add("plan." + label + "." + str(index) + "." + operation, operation, {"manifestJSON": compact(draft), "lookupLocale": lookup})
        add("configuration." + label, "localeConfigurationForManifest", {"manifestJSON": compact(draft)})
    for label, base_url, entry_url in [
        ("plain", "https://cdn.example/v1/", "en.json"),
        ("slashless-base", "https://cdn.example/v1", "en.json"),
        ("root-relative", "https://cdn.example/v1/", "/shared/en.json"),
        ("dot-segments", "https://cdn.example/v1/", "../v2/./en.json"),
        ("absolute-cross-origin", "https://cdn.example/v1/", "https://other.example/en.json"),
        ("serialized-host-port", "HTTPS://CDN.Example:443/a/../v1/", "./en.json"),
        ("query-fragment", "https://cdn.example/v1/", "en.json?q=a%20b#part"),
        ("percent-encoded", "https://cdn.example/v1/", "en%20US.json"),
        ("unicode-path", "https://cdn.example/v1/", "café 😀.json"),
        ("backslash-special", "https://cdn.example/v1/", "..\\v2\\en.json"),
        ("file", "file:///srv/catalogs/", "en.json"),
        ("http", "http://localhost:8080/v1/", "en.json"),
    ]:
        draft = manifest(["en", "fr"], base=base_url); draft["files"]["en"]["url"] = entry_url; draft["files"]["en"]["decodedBytes"] = 0
        draft["files"] = dict(reversed(list(draft["files"].items())))
        for operation in ["fetchSet", "wholeManifestPlan"]:
            add("url." + label + "." + operation, operation, {"manifestJSON": compact(draft), **({"lookupLocale": "fr-CA"} if operation == "fetchSet" else {})})
    for label, lookup in [("empty", ""), ("underscore", "en_US"), ("trailing-hyphen", "fr-"), ("null", None)]:
        for operation in ["chain", "fetchSet"]:
            add("plan.invalid-lookup." + label + "." + operation, operation, {"manifestJSON": compact(base), "lookupLocale": lookup})
    wrong = deepcopy(base); wrong["catalogFingerprint"] = "9" * 64
    for operation in ["chain", "fetchSet", "wholeManifestPlan", "localeConfigurationForManifest"]:
        add("plan.validate-first." + operation, operation, {"manifestJSON": compact(wrong), **({"lookupLocale": "en_US"} if operation in ["chain", "fetchSet"] else {})})
    for label, draft in [("upper-und-private-use", upper_und), ("once-normalized-und-private-use", lower_und)]:
        for operation in ["chain", "fetchSet"]:
            add("plan." + label + "." + operation, operation, {"manifestJSON": compact(draft), "lookupLocale": "de"})
    # A final deterministic inventory catches accidentally duplicate labels.
    rows.sort(key=lambda row: row["id"])
    if len({row["id"] for row in rows}) != len(rows): raise ValueError("Duplicate manifest case ID")
    return rows

def run(command, **kwargs):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode: raise RuntimeError(str(command) + "\n" + result.stderr.decode(errors="replace"))
    return result.stdout

def git_bytes(source, commit, path):
    return run(["git", "-C", str(source), "show", commit + ":" + path])

def read_unique(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result: raise ValueError("Duplicate JSON member " + key)
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON " + value)))

def dump(value):
    return (json.dumps(value, indent=2, ensure_ascii=True, allow_nan=False) + "\n").encode()

def checked_identity(value):
    data = base64.b64decode(value["canonicalBytesBase64"], validate=True)
    if len(data) != value["byteCount"] or sha(data) != value["sha256"] or value["identity"]["catalogFingerprint"] != value["sha256"]:
        raise ValueError("Identity byte count/SHA-256 mismatch")
    projection = read_unique(data)
    if projection != value["projection"] or canonical(projection).encode() != data:
        raise ValueError("Independent bounded JCS bytes differ")

def check():
    raw, lock_raw = VECTORS.read_bytes(), LOCK.read_bytes()
    if sha(raw) != VECTORS_SHA or sha(lock_raw) != LOCK_SHA: raise ValueError("Manifest contract archive digest differs")
    archive, lock = read_unique(raw), read_unique(lock_raw)
    if set(archive) != {"formatVersion", "scope", "jsCommit", "buildIdentity", "cases"} or archive["formatVersion"] != 1 or archive["scope"] != "js-manifest-validation-identity-planning" or archive["jsCommit"] != COMMIT or archive["buildIdentity"] != BUILD:
        raise ValueError("Manifest archive shape/provenance differs")
    expected_inputs = inputs()
    if [{key: row[key] for key in ["id", "operation", "input"]} for row in archive["cases"]] != expected_inputs:
        raise ValueError("Manifest input inventory differs from explicit recipe")
    if lock["formatVersion"] != 1 or lock["jsCommit"] != COMMIT or lock["nodeVersion"] != NODE_VERSION or lock["oracleSourceSHA256"] != sha(ORACLE.read_bytes()) or lock["vectorsSHA256"] != VECTORS_SHA or lock["frozenBehavioralCorpusSHA256"] != CORPUS_SHA:
        raise ValueError("Manifest lock provenance differs")
    if lock["schemaSHA256"] != sha(SCHEMA.read_bytes()): raise ValueError("Manifest schema differs")
    if lock["generatedDeclarations"]["archiveSHA256"] != sha((REFERENCE / "api-inventory.json").read_bytes()): raise ValueError("Source-matched declaration provenance differs")
    if sha((CORPUS).read_bytes()) != CORPUS_SHA:
        raise ValueError("Original behavioral corpus differs")
    for row in archive["cases"]:
        if set(row) != {"id", "operation", "input", "expected"} or row["operation"] not in OPERATIONS: raise ValueError("Unregistered vector field/operation")
        observation = row["expected"]
        if observation.get("outcome") == "returned":
            if set(observation) != {"outcome", "value"}: raise ValueError("Returned observation shape differs")
            if row["operation"] in ["computeCatalogIdentity", "identityForManifest"]: checked_identity(observation["value"])
        elif observation.get("outcome") == "threw":
            if set(observation) != {"outcome", "error"} or not isinstance(observation["error"].get("name"), str) or not isinstance(observation["error"].get("message"), str): raise ValueError("Error observation shape differs")
        else: raise ValueError("Unregistered observation outcome")
    report = summary(archive)
    if lock["summary"] != report: raise ValueError("Manifest summary/ID pins differ")
    if lock["sourcePinsSHA256"] != sha(compact(lock["sourcePins"]).encode()): raise ValueError("Source pin projection differs")
    for local, pin in lock["notices"].items():
        data = (REFERENCE / local).read_bytes()
        if sha(data) != pin["sha256"] or len(data) != pin["bytes"]: raise ValueError("Manifest JS notice differs")
    example = lock["predecessorWire"]["example"]
    checked_identity(example["current"]); checked_identity(example["predecessor"])
    if example["current"]["sha256"] == example["predecessor"]["sha256"]: raise ValueError("Wire migration example lost discriminator")
    print(json.dumps({"status": "passed", **report}, sort_keys=True))

def summary(archive):
    rows = archive["cases"]
    return {"cases": len(rows), "idsSHA256": sha("".join(row["id"] + "\n" for row in rows).encode()),
        "operationCounts": dict(sorted(Counter(row["operation"] for row in rows).items())),
        "outcomeCounts": dict(sorted(Counter(row["expected"]["outcome"] for row in rows).items()))}

def refresh(source, node):
    source = source.resolve()
    if run(["git", "-C", str(source), "rev-parse", COMMIT + "^{commit}"]).decode().strip() != COMMIT:
        raise ValueError("Pinned JS commit unavailable")
    if run([node, "--version"]).decode().strip() != NODE_VERSION: raise ValueError("Explicit oracle Node version differs")
    paths = run(["git", "-C", str(source), "ls-tree", "-r", "--name-only", COMMIT]).decode().splitlines()
    paths = sorted(set(path for path in paths if path.startswith("src/")) | set(REVIEW_FILES))
    pins = []
    with tempfile.TemporaryDirectory(prefix="lokalized-manifest-oracle-") as directory:
        scratch = Path(directory)
        for path in paths:
            data = git_bytes(source, COMMIT, path)
            destination = scratch / path; destination.parent.mkdir(parents=True, exist_ok=True); destination.write_bytes(data)
            pins.append({"path": path, "bytes": len(data), "sha256": sha(data)})
        input_path = scratch / "inputs.json"; input_path.write_bytes(dump(inputs()))
        observed = read_unique(run([node, str(ORACLE), str(scratch), str(input_path)]))
    if observed["nodeVersion"] != NODE_VERSION or observed["buildIdentity"] != BUILD: raise ValueError("Actual JS runtime identity differs")
    archive = {"formatVersion": 1, "scope": "js-manifest-validation-identity-planning", "jsCommit": COMMIT,
        "buildIdentity": BUILD, "cases": observed["cases"]}
    for row in archive["cases"]:
        if row["expected"]["outcome"] == "returned" and row["operation"] in ["computeCatalogIdentity", "identityForManifest"]: checked_identity(row["expected"]["value"])
    raw = dump(archive)
    previous_paths = run(["git", "-C", str(source), "ls-tree", "-r", "--name-only", PREVIOUS_COMMIT]).decode().splitlines()
    previous_paths = sorted(set(path for path in previous_paths if path.startswith("src/")) | {"package.json"})
    previous_pins = []
    example_input = identity_input(manifest(["en", "en-001", "fr"], order={"en": ["en-001", "en"]}))
    previous_input = deepcopy(example_input)
    previous_input["tiebreakers"] = previous_input.pop("tiebreakerLocalesByLanguageCode")
    example_row = {"id": "wire-migration-example", "operation": "computeCatalogIdentity", "input": {"identityInputJSON": compact(previous_input)}}
    with tempfile.TemporaryDirectory(prefix="lokalized-manifest-predecessor-") as directory:
        scratch = Path(directory)
        for path in previous_paths:
            data = git_bytes(source, PREVIOUS_COMMIT, path)
            destination = scratch / path; destination.parent.mkdir(parents=True, exist_ok=True); destination.write_bytes(data)
            previous_pins.append({"path": path, "bytes": len(data), "sha256": sha(data)})
        input_path = scratch / "inputs.json"; input_path.write_bytes(dump([example_row]))
        previous_observed = read_unique(run([node, str(ORACLE), str(scratch), str(input_path)]))
    if previous_observed["cases"][0]["expected"]["outcome"] != "returned": raise ValueError("Predecessor identity example refused")
    previous_example = previous_observed["cases"][0]["expected"]["value"]
    current_example = next(row["expected"]["value"] for row in archive["cases"] if row["id"] == "m7a.identity.base")
    checked_identity(previous_example)
    api_archive = read_unique((REFERENCE / "api-inventory.json").read_bytes())
    if api_archive["javascript"]["commit"] != COMMIT: raise ValueError("Generated declaration archive source commit differs")
    declaration_pins = [pin for pin in api_archive["javascript"]["files"] if pin["path"].startswith("types/load/")]
    for pin in declaration_pins:
        if sha((source / pin["path"]).read_bytes()) != pin["sha256"]: raise ValueError("Generated source-matched declaration differs")
    notices = {}
    for original, local in [("LICENSE", "LICENSE.js"), ("NOTICE", "NOTICE.js"), ("THIRD-PARTY-NOTICES.md", "THIRD-PARTY-NOTICES.js.md")]:
        data = git_bytes(source, COMMIT, original); (REFERENCE / local).write_bytes(data)
        notices[local] = {"sourcePath": original, "bytes": len(data), "sha256": sha(data)}
    lock = {"formatVersion": 1, "jsCommit": COMMIT, "packageVersion": "1.0.0-rc.2",
        "sourceRole": "Reviewed immutable source commit with unreleased wire/API changes; package version alone does not pin this contract",
        "nodeVersion": NODE_VERSION, "oracleSourceSHA256": sha(ORACLE.read_bytes()),
        "schemaSHA256": sha(SCHEMA.read_bytes()),
        "sourcePins": pins, "sourcePinsSHA256": sha(compact(pins).encode()),
        "generatedDeclarations": {"source": "Reference/api-inventory.json", "archiveSHA256": sha((REFERENCE / "api-inventory.json").read_bytes()),
            "note": "types/*.d.ts are generated and untracked in JS git; source-matched M0 archive pins, not pretend git objects", "files": declaration_pins},
        "notices": notices,
        "vectorsSHA256": sha(raw), "vectorsBytes": len(raw), "frozenBehavioralCorpusSHA256": CORPUS_SHA,
        "predecessorWire": {"commit": PREVIOUS_COMMIT, "sourcePins": previous_pins,
            "oldMember": "tiebreakers", "newMember": "tiebreakerLocalesByLanguageCode",
            "note": "Predecessor-source evidence only; this does not attest an npm tarball. HEAD requires regeneration and accepts no old-name alias.",
            "example": {"currentInputJSON": compact(example_input), "predecessorInputJSON": compact(previous_input),
                "current": current_example, "predecessor": previous_example}},
        "summary": summary(archive)}
    VECTORS.write_bytes(raw); LOCK.write_bytes(dump(lock))
    print(json.dumps({"vectorsSHA256": sha(raw), "lockSHA256": sha(dump(lock)), **summary(archive)}, sort_keys=True))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true"); mode.add_argument("--refresh", action="store_true")
    mode.add_argument("--inputs", action="store_true")
    parser.add_argument("--source-root", type=Path); parser.add_argument("--node", default="node")
    args = parser.parse_args()
    if args.check: check()
    elif args.inputs: sys.stdout.buffer.write(dump(inputs()))
    else:
        if args.source_root is None: raise ValueError("--refresh requires explicit --source-root")
        refresh(args.source_root, args.node)

if __name__ == "__main__":
    try: main()
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print("Manifest contract verification refused:", error, file=sys.stderr); sys.exit(1)
