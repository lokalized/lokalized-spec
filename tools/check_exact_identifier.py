#!/usr/bin/env python3
"""Validate the portable exact Unicode identifier profile and port snapshots."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "generated/exact-identifier/v1.json"
SHA256 = "3b20ec306ec5da919909e28a6db04085ad4cf9133d76adb6cf87f3631ee72e6f"
COMPOSED = "caf\u00e9"
DECOMPOSED = "cafe\u0301"
SLOT_COMPOSED = "\u00e9"
SLOT_DECOMPOSED = "e\u0301"
IDS = (
    "exact-key.paired-composed", "exact-key.paired-decomposed",
    "exact-key.composed-only-misses-decomposed", "exact-key.decomposed-only-misses-composed",
    "exact-placeholder.paired", "exact-key.escaped-literal-duplicate",
    "identifier.unicode-continuations", "identifier.supplementary-letter",
    "identifier.ascii-punctuation", "identifier.leading-mark",
    "identifier.leading-letter-number", "identifier.leading-digit",
    "identifier.leading-hyphen", "identifier.emoji-continuation",
    "identifier.format-continuation",
)
SNAPSHOTS = (
    ROOT.parent / "lokalized-java/src/test/resources/exact-identifier-v1.json",
    ROOT.parent / "lokalized-js/test/fixtures/exact-identifier-v1.json",
    ROOT.parent / "lokalized-swift/Reference/exact-identifier-v1.json",
)
CATALOG_PAIRS = {
    "paired": [(COMPOSED, "NFC key"), (DECOMPOSED, "NFD key"),
               ("Slots", "{{\u00e9}}|{{e\u0301}}")],
    "composedOnly": [(COMPOSED, "NFC key")],
    "decomposedOnly": [(DECOMPOSED, "NFD key")],
    "duplicateExact": [(COMPOSED, "first"), (COMPOSED, "second")],
}
CASE_INPUTS = (
    ("lookup", "paired", COMPOSED),
    ("lookup", "paired", DECOMPOSED),
    ("lookup", "composedOnly", DECOMPOSED),
    ("lookup", "decomposedOnly", COMPOSED),
    ("lookup", "paired", "Slots"),
    ("parse", "duplicateExact", None),
    ("lookup", "unicodeContinuations", "Boundary"),
    ("lookup", "supplementaryLetter", "Boundary"),
    ("lookup", "asciiPunctuation", "Boundary"),
    ("parse", "leadingMark", None),
    ("parse", "leadingLetterNumber", None),
    ("parse", "leadingDigit", None),
    ("parse", "leadingHyphen", None),
    ("parse", "emojiContinuation", None),
    ("parse", "formatContinuation", None),
)
VALID_BOUNDARIES = {
    "unicodeContinuations": ("a\u0301\u093e\u20dd\u216b\u00b22", "marks and numbers"),
    "supplementaryLetter": ("\U00010400", "supplementary letter"),
    "asciiPunctuation": ("_a-1", "underscore and hyphen"),
}
INVALID_BOUNDARIES = {
    "leadingMark": "\u0301a", "leadingLetterNumber": "\u216ba", "leadingDigit": "2a",
    "leadingHyphen": "-a", "emojiContinuation": "a\U0001f600", "formatContinuation": "a\u200d",
}
# Preserve every decoded member as a pair, including nested placeholder names.
for catalog, (name, text) in VALID_BOUNDARIES.items():
    CATALOG_PAIRS[catalog] = [("Boundary", [("translation", "{{" + name + "}}"),
                              ("placeholders", [(name, [("translation", text)])])])]
for catalog, name in INVALID_BOUNDARIES.items():
    CATALOG_PAIRS[catalog] = [("Boundary", [("translation", "boundary"),
                              ("placeholders", [(name, [("translation", "generated")])])])]


def exact(value: object, keys: set[str], where: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError(f"{where}: expected exactly {sorted(keys)}")
    return value


def validate(profile: dict) -> dict:
    exact(profile, {"formatVersion", "profileID", "profileVersion", "fixture", "cases"}, "root")
    if (profile["formatVersion"], profile["profileID"], profile["profileVersion"]) != (1, "exact-identifier-v1", "1.0.0"):
        raise ValueError("unsupported exact-identifier profile identity")
    fixture = exact(profile["fixture"], {"locale", "catalogs"}, "fixture")
    if fixture["locale"] != "en-GB": raise ValueError("unexpected locale")
    catalogs = fixture["catalogs"]
    if not isinstance(catalogs, dict) or set(catalogs) != set(CATALOG_PAIRS):
        raise ValueError("catalog inventory differs")
    for name, expected_pairs in CATALOG_PAIRS.items():
        source = catalogs[name]
        if not isinstance(source, str): raise ValueError(f"{name}: catalog source must be text")
        try: pairs = json.loads(source, object_pairs_hook=lambda items: items)
        except ValueError as error: raise ValueError(f"{name}: invalid catalog source") from error
        if pairs != expected_pairs:
            raise ValueError(f"{name}: decoded catalog key/value sequence differs")
    if "\\u00e9" not in catalogs["duplicateExact"] or "caf\u00e9" not in catalogs["duplicateExact"]:
        raise ValueError("duplicate source must mix escaped and literal spellings")
    rows = profile["cases"]
    if not isinstance(rows, list) or len(rows) != len(IDS) or not all(isinstance(row, dict) for row in rows):
        raise ValueError("exact-identifier case inventory differs")
    if [row.get("id") for row in rows] != list(IDS):
        raise ValueError("exact-identifier case inventory/order differs")
    for index, row in enumerate(rows):
        where = row["id"]
        operation, catalog, key = CASE_INPUTS[index]
        if operation == "parse":
            exact(row, {"id", "operation", "catalog", "expected"}, where)
            if (row["operation"], row["catalog"]) != (operation, catalog):
                raise ValueError(f"{where}: parse input differs")
            if catalog == "duplicateExact":
                message = f"{where}: duplicate localized string key '{COMPOSED}' encountered"
            else:
                message = (f"{where}: invalid placeholder '{INVALID_BOUNDARIES[catalog]}'. Placeholder names must start "
                           "with a Unicode letter or underscore and contain only Unicode letters, Unicode numbers, "
                           "Unicode combining marks, underscores, or hyphens. Key is 'Boundary'")
            if exact(row["expected"], {"status", "message"}, where + ".expected") != {"status": "refused", "message": message}:
                raise ValueError(f"{where}: catalog must be refused for the expected reason")
            continue
        fields = {"id", "operation", "catalog", "key", "expected"}
        if where == "exact-placeholder.paired": fields.add("values")
        exact(row, fields, where)
        if (row["operation"], row["catalog"], row["key"]) != (operation, catalog, key):
            raise ValueError(f"{where}: exact input spelling differs")
        if where == "exact-placeholder.paired":
            if row["values"] != [{"name": SLOT_COMPOSED, "text": "NFC"},
                                  {"name": SLOT_DECOMPOSED, "text": "NFD"}]:
                raise ValueError(f"{where}: exact placeholder names/values differ")
        expected = exact(row["expected"], {"status", "key", "translation", "attemptedLocales"}, where + ".expected")
        matches = [text for name, text in CATALOG_PAIRS[catalog] if name == key]
        if len(matches) > 1: raise ValueError(f"{where}: lookup catalog contains duplicate exact key")
        status = "translated" if matches else "returned-key"
        translation = matches[0] if matches else key
        if where == "exact-placeholder.paired": translation = "NFC|NFD"
        elif catalog in VALID_BOUNDARIES: translation = VALID_BOUNDARIES[catalog][1]
        attempts = ["en-GB"] if matches else ["en-GB", "en-001", "en"]
        if expected != {"status": status, "key": key, "translation": translation,
                        "attemptedLocales": attempts}:
            raise ValueError(f"{where}: exact lookup result differs")
    return {"status": "passed", "profileID": profile["profileID"],
            "profileVersion": profile["profileVersion"], "cases": len(rows)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sibling-check", action="store_true", help="also compare adjacent port test snapshots")
    args = parser.parse_args()
    data = PROFILE.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256: raise ValueError("shared exact-identifier artifact digest differs")
    result = validate(json.loads(data))
    if args.sibling_check:
        for path in SNAPSHOTS:
            if path.read_bytes() != data: raise ValueError(f"port snapshot differs: {path}")
        result["snapshots"] = len(SNAPSHOTS)
    result["sha256"] = digest
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__": main()
