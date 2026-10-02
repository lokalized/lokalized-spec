#!/usr/bin/env python3
"""Check the shared IDNA corpus offline, or explicitly refresh its pinned oracle.

Python standard library only. Normal checks need no Swift, Java, Node, network,
or sibling repository. --refresh-goldens alone requires the exact recorded Node
executable and its actual loaded URL/Unicode engine images.
"""
import argparse
import hashlib
import json
from pathlib import Path
from url_oracle import idna_corpus

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "tools/url_oracle"
REFERENCE = PACKAGE / "reference"
ARCHIVE = ROOT / "generated/url-oracle/manifest-idna-goldens.json.gz"
LOCK = ARCHIVE.with_name("manifest-idna-lock.json")
MODULES = ["__init__.py", "idna_corpus.py", "normalization_inputs.py", "oracle_runtime.py", "property_inputs.py", "unicode_inputs.py"]
REFERENCE_FILES = [
    "Unicode-17.0.0/IdnaMappingTable.txt", "Unicode-17.0.0/UnicodeData.txt",
    "Unicode-17.0.0/DerivedNormalizationProps.txt", "Unicode-17.0.0/DerivedBidiClass.txt",
    "Unicode-17.0.0/DerivedJoiningType.txt", "Unicode-17.0.0/NormalizationTest.txt",
    "Unicode-17.0.0/LICENSE.txt", "Unicode-17.0.0/IdnaTestV2.txt",
    "IDNA-Compatibility/property-profile.json", "IDNA-Compatibility/normalization-profile.json",
    "IDNA-Compatibility/oracle-runtime-lock.json", "IDNA-Compatibility/LICENSE-MIT.txt",
]


def source_lock():
    archive = idna_corpus.archive_check(ARCHIVE, REFERENCE)
    ids = [row["id"] for row in archive["rows"]]
    qualified = hashlib.sha256("".join(value + "\n" for value in ids).encode()).hexdigest()
    if len(ids) != 56_513 or ids != sorted(set(ids)) or qualified != "c9c6944a8e63b3d92680f19fd53c3a1f4ee871db10efca26183a2ead699a9432":
        raise ValueError("Shared IDNA case identity differs")
    files = [ARCHIVE] + [PACKAGE / name for name in MODULES] + [REFERENCE / name for name in REFERENCE_FILES]
    inventory = []
    for path in sorted(files):
        data = path.read_bytes()
        inventory.append({"path": path.relative_to(ROOT).as_posix(), "bytes": len(data), "sha256": idna_corpus.digest(data)})
    return {
        "formatVersion": 1,
        "profileId": "whatwg-url-node-26.5.0-ada-4.0.0-unicode-mapping-17.0",
        "scope": "Frozen Unicode-scalar URL compatibility observations; no strict UTS #46 or whole WHATWG suite conformance claim",
        "archive": {"path": ARCHIVE.relative_to(ROOT).as_posix(), "decodedBytes": 19_308_094,
                    "decodedSHA256": idna_corpus.GOLDENS_SHA256, "recipeSHA256": archive["recipeSHA256"],
                    "qualifiedIDSetSHA256": qualified, "rows": len(ids),
                    "officialScalarInputs": 6_389, "propertyDiscriminants": 32_203,
                    "normalizationDiscriminants": 17_062, "authoredBoundaries": 859,
                    "excludedIllFormedSourceLines": archive["excludedIllFormedSourceLines"]},
        "oracleRuntimeLockSHA256": idna_corpus.oracle_runtime.LOCK_SHA256,
        "files": inventory,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--check", action="store_true")
    modes.add_argument("--write-lock", action="store_true", help="Record reviewed shared source/module identities")
    modes.add_argument("--refresh-goldens", action="store_true", help="Explicitly replace canonical oracle observations")
    parser.add_argument("--node", help="Exact pinned Node executable, required only for refresh")
    args = parser.parse_args()
    if args.refresh_goldens:
        if not args.node:
            parser.error("--refresh-goldens requires --node pointing to the pinned executable")
        print(json.dumps(idna_corpus.refresh_goldens(args.node, ARCHIVE, REFERENCE), indent=2))
        return
    expected = source_lock()
    if args.write_lock:
        LOCK.write_text(json.dumps(expected, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    elif json.loads(LOCK.read_bytes()) != expected:
        raise ValueError("Shared IDNA source lock differs; review changes before --write-lock")
    print(json.dumps({"status": "passed", "profileId": expected["profileId"],
                      "rows": expected["archive"]["rows"], "archiveSHA256": idna_corpus.GOLDENS_SHA256,
                      "sourceFiles": len(expected["files"]), "mode": "wrote-lock" if args.write_lock else "offline-check"}, indent=2))


if __name__ == "__main__":
    main()
