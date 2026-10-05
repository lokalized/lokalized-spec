#!/usr/bin/env python3
"""Validate the versioned portable fallback-observer profile and its snapshots."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "generated/fallback-observer/v1.json"
SHA256 = "4c844d73e8d333dde8432cb9e76fcdeb22b4937b50a632205fe74855b6e57d18"
IDS = (
    "observer.first-candidate", "observer.third-candidate", "observer.fourth-candidate",
    "observer.exhausted", "observer.policy-stops", "observer.throws",
    "observer.per-call-replaces", "observer.negotiation-only",
    "observer.no-matching-alternative", "observer.distinct-causes",
    "observer.per-call-inherits", "observer.reentrant",
)
SNAPSHOTS = (
    ROOT.parent / "lokalized-java/src/test/resources/fallback-observer-v1.json",
    ROOT.parent / "lokalized-js/test/fixtures/fallback-observer-v1.json",
    ROOT.parent / "lokalized-swift/Reference/fallback-observer-v1.json",
)


def exact(value: dict, keys: set[str], where: str) -> None:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError(f"{where}: expected exactly {sorted(keys)}")


def strings(value: object, where: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        raise ValueError(f"{where}: expected nonempty strings")
    return value


def validate(profile: dict) -> dict:
    exact(profile, {"formatVersion", "profileID", "profileVersion", "fixture", "cases"}, "root")
    if (profile["formatVersion"], profile["profileID"], profile["profileVersion"]) != (1, "fallback-observer-v1", "1.0.0"):
        raise ValueError("unsupported fallback-observer profile identity")
    fixture = profile["fixture"]
    exact(fixture, {"requestLocale", "negotiationRequestLocale", "fallbackLocale",
                    "tiebreakerLocalesByLanguageCode", "catalogs", "catalogVariants"}, "fixture")
    if (fixture["requestLocale"], fixture["negotiationRequestLocale"], fixture["fallbackLocale"]) != ("en-GB", "en-AU", "fr"):
        raise ValueError("unexpected request/fallback fixture")
    if fixture["tiebreakerLocalesByLanguageCode"] != {"en": ["en-GB", "en-001", "en"]}:
        raise ValueError("unexpected tiebreaker fixture")
    catalogs = fixture["catalogs"]
    if not isinstance(catalogs, dict) or set(catalogs) != {"en-GB", "en-001", "en", "fr"}:
        raise ValueError("unexpected catalog locales")
    for locale, entries in catalogs.items():
        if not isinstance(entries, dict) or not entries or any(not isinstance(k, str) or not isinstance(v, str) for k, v in entries.items()):
            raise ValueError(f"invalid catalog for {locale}")
    variants = fixture["catalogVariants"]
    if not isinstance(variants, dict) or set(variants) != {"mixed", "causes"}:
        raise ValueError("unexpected catalog variants")
    for name, variant in variants.items():
        if not isinstance(variant, dict) or set(variant) != set(catalogs):
            raise ValueError(f"{name}: invalid catalog locales")
        if any(not isinstance(entries, dict) for entries in variant.values()):
            raise ValueError(f"{name}: invalid catalog entries")
    rows = profile["cases"]
    if not isinstance(rows, list) or [row.get("id") for row in rows if isinstance(row, dict)] != list(IDS):
        raise ValueError("fallback-observer case inventory/order changed")
    for row in rows:
        where = row["id"]
        if set(row) - {"id", "key", "policy", "observer", "expected", "requestMode", "catalogVariant", "placeholderMode", "nestedKey"} \
                or not {"id", "key", "policy", "observer", "expected"} <= set(row):
            raise ValueError(f"{where}: unexpected or missing input field")
        if row["key"] not in {"InEvery", "OnlyInEn", "OnlyInFallback", "Nowhere", "Choice", "Broken"}:
            raise ValueError(f"{where}: unknown key")
        if row["policy"] not in {"advance", "stop"} or row["observer"] not in {"record", "throw", "replace", "inherit", "reenter"}:
            raise ValueError(f"{where}: unknown callback mode")
        if row["observer"] in {"inherit", "reenter"} and where not in {"observer.per-call-inherits", "observer.reentrant"}:
            raise ValueError(f"{where}: wrong callback mode")
        if where in {"observer.per-call-inherits", "observer.reentrant"} and row["observer"] != {
                "observer.per-call-inherits": "inherit", "observer.reentrant": "reenter"}[where]:
            raise ValueError(f"{where}: wrong callback mode")
        if row.get("nestedKey") != ("OnlyInFallback" if where == "observer.reentrant" else None):
            raise ValueError(f"{where}: unexpected nested key")
        special = {"observer.negotiation-only": ("negotiated", None, None),
                   "observer.no-matching-alternative": (None, "mixed", "tier-two"),
                   "observer.distinct-causes": (None, "causes", "throwing-two")}
        if (row.get("requestMode"), row.get("catalogVariant"), row.get("placeholderMode")) != special.get(where, (None, None, None)):
            raise ValueError(f"{where}: unexpected input mode")
        expected = row["expected"]
        if set(expected) - {"outcome", "translation", "attemptedLocales", "policyCalls", "handlerCalls",
                            "instanceEvents", "perCallEvents", "isFallback", "causeIdentity", "nestedResult"} \
                or not {"outcome", "translation", "attemptedLocales", "policyCalls", "handlerCalls",
                        "instanceEvents", "perCallEvents"} <= set(expected):
            raise ValueError(f"{where}: unexpected or missing expected field")
        if expected.get("isFallback") != (True if where == "observer.negotiation-only" else None):
            raise ValueError(f"{where}: unexpected negotiation fallback flag")
        if expected.get("causeIdentity") != ("distinct-policy-matched" if where == "observer.distinct-causes" else None):
            raise ValueError(f"{where}: unexpected cause identity claim")
        if where == "observer.reentrant":
            nested = expected.get("nestedResult")
            exact(nested, {"key", "translation", "attemptedLocales"}, where + ".nestedResult")
            if nested != {"key": "OnlyInFallback", "translation": "French only",
                          "attemptedLocales": ["en-GB", "en-001", "en", "fr"]}:
                raise ValueError(f"{where}: nested result differs")
        elif "nestedResult" in expected:
            raise ValueError(f"{where}: unexpected nested result")
        outcome = expected["outcome"]
        if outcome not in {"translated", "returned-key", "observer-threw"}:
            raise ValueError(f"{where}: unknown outcome")
        attempts = expected["attemptedLocales"]
        if outcome == "observer-threw":
            if attempts is not None or expected["translation"] is not None or row["observer"] != "throw":
                raise ValueError(f"{where}: thrown observer cannot return a result")
        else:
            strings(attempts, where + ".attemptedLocales")
            if where == "observer.negotiation-only":
                if attempts != ["en-001"]: raise ValueError(f"{where}: invalid negotiated candidate")
            elif attempts[0] != "en-GB" or len(attempts) > 4 or attempts != ["en-GB", "en-001", "en", "fr"][:len(attempts)]:
                raise ValueError(f"{where}: invalid candidate prefix")
            if outcome == "returned-key" and expected["translation"] != row["key"]:
                raise ValueError(f"{where}: returned key differs")
            if outcome == "translated" and (not isinstance(expected["translation"], str) or not expected["translation"]):
                raise ValueError(f"{where}: missing translation")
        calls = strings(expected["policyCalls"], where + ".policyCalls")
        if not isinstance(expected["handlerCalls"], int) or expected["handlerCalls"] not in {0, 1}:
            raise ValueError(f"{where}: invalid handler count")
        if not isinstance(expected["instanceEvents"], list) or not isinstance(expected["perCallEvents"], list):
            raise ValueError(f"{where}: invalid event arrays")
        events = expected["instanceEvents"] + expected["perCallEvents"]
        if len(events) > (2 if where == "observer.reentrant" else 1) \
                or (row["observer"] == "replace") != bool(expected["perCallEvents"]):
            raise ValueError(f"{where}: invalid observer channel")
        if where == "observer.reentrant" and len(expected["instanceEvents"]) != 2:
            raise ValueError(f"{where}: nested event missing from instance channel")
        if row["observer"] == "throw" and len(events) != 1:
            raise ValueError(f"{where}: throwing observer did not fire")
        all_failures = []
        for index, event in enumerate(events):
            exact(event, {"key", "lookupLocale", "resolvedLocale", "attemptedLocales", "precedingFailures"}, where + ".event")
            attempted = strings(event["attemptedLocales"], where + ".event.attemptedLocales")
            failures = strings(event["precedingFailures"], where + ".event.precedingFailures")
            event_key = row["nestedKey"] if where == "observer.reentrant" and index == 1 else row["key"]
            if event["key"] != event_key or event["lookupLocale"] != "en-GB" or event["resolvedLocale"] != attempted[-1]:
                raise ValueError(f"{where}: event identity differs")
            if attempted != ["en-GB", "en-001", "en", "fr"][:len(attempted)] or len(failures) != len(attempted) - 1:
                raise ValueError(f"{where}: event candidate order differs")
            if any(not failure.startswith(f"{locale}:") or failure.split(":", 1)[1] not in
                   {"missing-translation", "no-matching-alternative", "resolution-failure"}
                   for failure, locale in zip(failures, attempted[:-1])):
                raise ValueError(f"{where}: event preceding failures differ")
            if where == "observer.no-matching-alternative" and failures != ["en-GB:no-matching-alternative", "en-001:missing-translation"]:
                raise ValueError(f"{where}: mixed failure reasons differ")
            if where == "observer.distinct-causes" and failures != ["en-GB:resolution-failure", "en-001:resolution-failure"]:
                raise ValueError(f"{where}: resolution failure reasons differ")
            if where not in {"observer.no-matching-alternative", "observer.distinct-causes"} and any(not failure.endswith(":missing-translation") for failure in failures):
                raise ValueError(f"{where}: unexpected failure reason")
            if outcome != "observer-threw" and attempted != (expected["nestedResult"]["attemptedLocales"] if where == "observer.reentrant" and index == 1 else attempts):
                raise ValueError(f"{where}: event/result attempt mismatch")
            all_failures.extend(failures)
        if events and calls != all_failures:
            raise ValueError(f"{where}: policy/event trace mismatch")
        if outcome == "translated" and (bool(events) != (len(attempts) > 1) or expected["handlerCalls"] != 0):
            raise ValueError(f"{where}: translated event/handler count differs")
        if outcome == "returned-key" and (events or expected["handlerCalls"] != 1):
            raise ValueError(f"{where}: failed lookup notified observer")
        if outcome == "observer-threw" and expected["handlerCalls"] != 0:
            raise ValueError(f"{where}: observer failure reached handler")
        if outcome == "returned-key" and calls != [f"{locale}:missing-translation" for locale in attempts[:len(calls)]]:
            raise ValueError(f"{where}: policy ordering differs")
    return {"status": "passed", "profileID": profile["profileID"], "profileVersion": profile["profileVersion"], "cases": len(rows)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sibling-check", action="store_true", help="also compare adjacent port test snapshots")
    args = parser.parse_args()
    data = PROFILE.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256: raise ValueError("shared fallback-observer artifact digest differs")
    result = validate(json.loads(data))
    if args.sibling_check:
        for path in SNAPSHOTS:
            if path.read_bytes() != data: raise ValueError(f"port snapshot differs: {path}")
        result["snapshots"] = len(SNAPSHOTS)
    result["sha256"] = digest
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__": main()
