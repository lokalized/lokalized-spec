#!/usr/bin/env python3
"""Check the separately scoped M7A native manifest report. Python stdlib only.

The frozen JS observations do not configure native execution. This verifier
independently reconstructs typed-carrier eligibility from inputs, verifies the
complete native observation ledger, and derives each registered projection from
actual native fields. It never promotes the original behavioral corpus.
"""
import argparse
import base64
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile

VECTORS_SHA = "6356098bbde353a66886e9552c45efe7ec6353697cf26be2141d3e9f4811d50a"
LOCK_SHA = "faaa51bdacd19f1fbd407848ac545221aad4da5d6d02a1095f1d927a2a96bf03"
ALL_SHA = "cd23a022f9bd427824c451892ab0e922fb8809945a0eb55571d9d4eccec7966f"
ELIGIBLE_SHA = "f8062a5ef05939d4100f68b1a1c64ab351632992a56719154831e5c1babb69c1"
STRICT_SHA = "d76f309201418fdda3c0e7b157ed135576d1a1fb9309c0dc70136dea3bb5bb0f"
PROJECTED_SHA = "35ce8481225f5fde66ec8f966523eda98d7425f18120200deb562c10f897342c"
PENDING_SHA = "c6157779eb161a1e0193b8abc246bc80112e3ba67e27d0f296d3722006f481f4"
# Pin the complete independently executed native receipt, including fields that
# cannot appear in JS's error envelope. This is a reviewable qualification pin,
# never a production answer table or a replacement for executing the library.
NATIVE_LEDGER_SHA = "54aa67d6962a9bf1b3f123ebbd6205004c3ce0d272f36270608656fd3957f548"
LIMITS = {"maximumInputBytes", "maximumReaderCharacters", "maximumJsonNestingDepth",
          "maximumTotalInputBytes", "maximumLocalizedStringsFiles", "maximumTranslationNodes", "maximumWarnings"}


class Number(str):
    """Keep JSON numeric spelling distinct from strings, booleans and floats."""


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def ids_sha(ids):
    return sha("".join(value + "\n" for value in ids).encode())


def read_json(data, lexical=False):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON member: " + key)
            result[key] = value
        return result
    kwargs = {"object_pairs_hook": pairs,
              "parse_constant": lambda value: require(False, "Nonfinite JSON: " + value)}
    if lexical:
        kwargs.update(parse_int=Number, parse_float=Number)
    return json.loads(data, **kwargs)


def normalized(value):
    if isinstance(value, Number):
        return str(value)
    if value is None:
        return "null"
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is int:
        return str(value)
    if type(value) is str:
        return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
    if type(value) is list:
        return "[" + ",".join(normalized(item) for item in value) + "]"
    require(type(value) is dict, "Unexpected normalized JSON value")
    keys = sorted(value, key=lambda key: key.encode("utf-16-be", "surrogatepass"))
    return "{" + ",".join(normalized(key) + ":" + normalized(value[key]) for key in keys) + "}"


def same(left, right):
    # normalized spelling retains exact UTF-16 strings and number lexemes.
    return normalized(left) == normalized(right)


def fields(value, required, optional=()):
    require(type(value) is dict and set(required) <= set(value) <= set(required) | set(optional),
            "Unknown or missing fields; required=" + str(sorted(required)))


def strings(value):
    return type(value) is list and all(type(item) is str for item in value)


def unicode_valid(value):
    if type(value) is str:
        try:
            value.encode("utf-8", "strict")
            return True
        except UnicodeEncodeError:
            return False
    if type(value) is dict:
        return all(unicode_valid(key) and unicode_valid(item) for key, item in value.items())
    if type(value) is list:
        return all(unicode_valid(item) for item in value)
    return True


def pending_input(row):
    """Typed-carrier guards only; no expected observation is consulted."""
    source = row["input"]
    operation = row["operation"]
    if "optionsJSON" in source:
        options = json.loads(source["optionsJSON"])
        require(type(options) is dict, "Unregistered nonobject native options")
        allowed = {"limits", "source"} if operation == "parseStringsManifest" else {"limits"}
        if set(options) - allowed:
            return "typed-options-no-dynamic-members", "Input supplies an unknown dynamic JS option; native argument labels cannot express that member"
        if "source" in options and type(options["source"]) is not str:
            return "typed-source-string", "Native source labels require Swift String"
        if "limits" in options:
            budgets = options["limits"]
            require(type(budgets) is dict, "Unregistered nonobject native budgets")
            if set(budgets) - LIMITS:
                return "typed-limits-no-dynamic-members", "Native loading-option value type cannot express an unknown JS budget name"
            if any(type(value) is not int or not -(2**63) <= value < 2**63 for value in budgets.values()):
                return "typed-loading-budget-integer", "Native loading budgets use Int; this input is not an integral native value"
    subject = None
    for name in ["identityInputJSON", "manifestJSON"]:
        if name in source:
            subject = json.loads(source[name])
            if not unicode_valid(subject):
                return "native-valid-unicode-string-carrier", "Input JSON requires a lone UTF-16 surrogate; Swift String and public ExactString have no preserving constructor"
    if operation == "computeCatalogIdentity":
        if type(subject) is not dict:
            return "typed-identity-object", "Native identity API requires a CatalogIdentityInputV1 value, not an arbitrary JSON root"
        if set(subject) - {"formatVersion", "catalogVersion", "resolvedFallbackLocale", "localeToSha256", "tiebreakerLocalesByLanguageCode"}:
            return "typed-identity-extra-members", "Native identity input has exactly five declared fields; this dynamic object supplies another member"
        if (type(subject.get("formatVersion")) is not int or not -(2**63) <= subject["formatVersion"] < 2**63
                or type(subject.get("catalogVersion")) is not str or type(subject.get("resolvedFallbackLocale")) is not str):
            return "typed-identity-required-fields", "Native required identity fields are Int and nonoptional String; this input omits or mistypes one"
        digests = subject.get("localeToSha256")
        if digests is not None:
            require(type(digests) is dict, "Unregistered nonobject digest map")
            if any(type(value) is not str for value in digests.values()):
                return "typed-identity-digest-string", "Native digest map has nonoptional String values"
        ties = subject.get("tiebreakerLocalesByLanguageCode")
        if ties is not None:
            require(type(ties) is dict, "Unregistered nonobject tiebreaker map")
            for value in ties.values():
                if type(value) is not list:
                    return "typed-tiebreaker-string-array", "Native identity/manifest tiebreaker map requires arrays of Swift String"
                if any(type(item) is not str for item in value):
                    return "typed-tiebreaker-string-array", "Native tiebreaker array elements require Swift String"
    if operation in {"chain", "fetchSet"} and type(source.get("lookupLocale")) is not str:
        return "typed-lookup-string", "Native planning lookupLocale is a nonoptional Swift String; this input supplies another JSON value"
    return None


def projection(row, native):
    fields(native, {"outcome"}, {"value", "error"})
    if native["outcome"] == "returned":
        fields(native, {"outcome", "value"})
        return native, []
    require(native["outcome"] == "threw", "Unknown native outcome")
    fields(native, {"outcome", "error"})
    error = native["error"]
    require(type(error) is dict and type(error.get("name")) is str and type(error.get("message")) is str, "Invalid native error")
    name = error["name"]
    message = error["message"]
    rules = []
    if name == "ConfigurationError":
        fields(error, {"name", "message", "kind", "cause"})
        require(error["kind"] == "invalidArgument" and error["cause"] is None, "Unregistered configuration error kind/cause")
        rules.append("native-configuration-error-envelope")
        if row["operation"] == "computeCatalogIdentity":
            subject = json.loads(row["input"]["identityInputJSON"])
            compared = {"name": "TypeError" if subject["formatVersion"] == 1 else "RangeError", "message": message}
            rules.append("typed-identity-configuration-error-taxonomy")
        else:
            compared = {"name": name, "message": message, "code": "CONFIGURATION"}
    elif name == "LocalizedStringLoadingOptions.ValidationError":
        fields(error, {"name", "message", "field", "value"})
        require(error["field"] in LIMITS and isinstance(error["value"], Number), "Invalid native budget error")
        supplied = json.loads(row["input"]["optionsJSON"])["limits"]
        require(normalized(error["value"]) == str(supplied[error["field"]]), "Native budget error does not retain supplied value")
        compared = {"name": "RangeError", "message": message}
        rules.append("typed-loading-options-validation-error-taxonomy")
    elif name == "LocaleTagError":
        fields(error, {"name", "message", "kind"})
        require(row["operation"] in {"chain", "fetchSet"} and error["kind"] == "malformedLanguageTag", "Unregistered locale error")
        compared = {"name": "RangeError", "message": message}
        rules.append("native-planning-locale-error-taxonomy")
    elif name == "StringsParseError":
        fields(error, {"name", "message", "source", "line", "column", "path", "cause"})
        require(row["operation"] == "parseStringsManifest", "Parse error outside raw door")
        require(type(error["source"]) is str and (error["path"] is None or type(error["path"]) is str), "Invalid parse source/path")
        for field in ["line", "column"]:
            require(error[field] is None or isinstance(error[field], Number) and str(error[field]).isdigit() and int(error[field]) > 0, "Invalid parse position")
        rules.append("native-strings-parse-error-envelope")
        cause = error["cause"]
        if cause is not None:
            fields(cause, {"name", "reason", "offset", "line", "column"})
            require(cause["name"] == "JSONReadError" and type(cause["reason"]) is str, "Unregistered parse cause")
            require(isinstance(cause["offset"], Number) and str(cause["offset"]).isdigit(), "Invalid native cause offset")
        unlocated = all(error[field] is None for field in ["line", "column", "path"])
        prefixes = ["localized strings resource ", "JSON nesting depth exceeds ", "a localized strings file may not be blank;"]
        if unlocated and any(message.startswith(error["source"] + ": " + prefix) for prefix in prefixes):
            compared = {"name": "Error", "message": message}
            rules.append("manifest-preparser-source-error-taxonomy")
        else:
            compared = {"name": name, "message": message, "code": "STRINGS_PARSE", **{key: error[key] for key in ["source", "line", "column", "path"]}}
            if cause is not None:
                require(same(cause["line"], error["line"]) and same(cause["column"], error["column"]), "Parse cause position differs")
                compared["cause"] = {"name": "Error", "message": message, "line": error["line"], "column": error["column"]}
                rules.append("native-json-reader-cause-projection")
    else:
        raise ValueError("Unregistered native error: " + name)
    return {"outcome": "threw", "error": compared}, rules


def check_identity(value):
    fields(value, {"identity", "projection", "canonicalBytesBase64", "byteCount", "sha256"}, {"input"})
    require(type(value["canonicalBytesBase64"]) is str, "Identity bytes must be base64 text")
    data = base64.b64decode(value["canonicalBytesBase64"], validate=True)
    require(isinstance(value["byteCount"], Number) and str(value["byteCount"]) == str(len(data)), "Identity byte count differs")
    require(sha(data) == value["sha256"] == value["identity"]["catalogFingerprint"], "Identity digest differs")
    decoded = read_json(data, lexical=True)
    require(same(decoded, value["projection"]), "Identity projection differs from bytes")
    # This identity profile contains strings/arrays/objects and the integer 1.
    def jcs(item):
        if isinstance(item, Number):
            require(str(item) == "1", "Identity outside bounded integer JCS profile")
            return str(item)
        if type(item) is str:
            item.encode("utf-8", "strict")
            return json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        if type(item) is list:
            return "[" + ",".join(jcs(member) for member in item) + "]"
        require(type(item) is dict, "Identity outside bounded JCS profile")
        return "{" + ",".join(jcs(key) + ":" + jcs(item[key]) for key in sorted(item, key=lambda key: key.encode("utf-16-be", "strict"))) + "}"
    require(jcs(decoded).encode() == data, "Independent JCS byte encoding differs")


def report_check(path, reference):
    reference = Path(reference)
    vector_bytes = (reference / "manifest-contract-vectors.json").read_bytes()
    lock_bytes = (reference / "manifest-contract-lock.json").read_bytes()
    require(sha(vector_bytes) == VECTORS_SHA and sha(lock_bytes) == LOCK_SHA, "Manifest contract archive digest differs")
    archive = read_json(vector_bytes)
    lock = read_json(lock_bytes)
    require(archive["jsCommit"] == lock["jsCommit"] == "617670da887b0c684e2589882447b6b93297f2f7" and lock["vectorsSHA256"] == VECTORS_SHA, "Manifest source pin differs")
    rows = archive["cases"]
    require(len(rows) == 499 and ids_sha([row["id"] for row in rows]) == ALL_SHA, "Manifest full inventory differs")
    report = read_json(Path(path).read_bytes())
    fields(report, {"scope", "nativeMappingsRatified", "status", "totalCases", "eligibleIDs", "eligibleIDsSHA256", "runtimePassed", "strictNativeEqualIDs", "projectedMatchedIDs", "failed", "pendingCarriers", "pendingObservations", "observations", "adaptationObservations"})
    require(report["scope"] == "native-manifest-validation-identity-planning" and report["nativeMappingsRatified"] is False and report["status"] == "passed" and type(report["totalCases"]) is int and report["totalCases"] == 499 and report["failed"] == [], "Report scope/status differs")
    pending = {row["id"]: pending_input(row) for row in rows if pending_input(row) is not None}
    eligible = [row["id"] for row in rows if row["id"] not in pending]
    require(len(eligible) == 468 and ids_sha(eligible) == ELIGIBLE_SHA and len(pending) == 31 and ids_sha(sorted(pending)) == PENDING_SHA, "Input-derived native eligibility differs")
    require(report["eligibleIDs"] == eligible and report["runtimePassed"] == eligible and report["eligibleIDsSHA256"] == ELIGIBLE_SHA, "Report native inventory differs")
    for collection in ["observations", "adaptationObservations", "pendingCarriers", "pendingObservations"]:
        require(type(report[collection]) is list and all(type(item) is dict and type(item.get("id")) is str for item in report[collection]), "Invalid report ledger")
        ids = [item["id"] for item in report[collection]]
        require(ids == sorted(set(ids)), "Duplicate or unsorted ledger IDs")
    require([item["id"] for item in report["observations"]] == eligible, "Native observation ledger omitted an ID")
    row_by_id = {row["id"]: row for row in rows}
    strict, projected, adaptations, native_receipts = [], [], [], []
    for item in report["observations"]:
        fields(item, {"id", "rules", "nativeObservationJSON", "referenceObservationJSON", "comparisonObservationJSON"}, {"difference"})
        require(item.get("difference") is None and strings(item["rules"]), "Invalid observation rules/difference")
        require(all(type(item[name]) is str for name in ["nativeObservationJSON", "referenceObservationJSON", "comparisonObservationJSON"]), "Observation must retain encoded JSON")
        row = row_by_id[item["id"]]
        native = read_json(item["nativeObservationJSON"], lexical=True)
        expected = read_json(json.dumps(row["expected"]), lexical=True)
        require(same(read_json(item["referenceObservationJSON"], lexical=True), expected), "Reference observation differs from immutable oracle: " + item["id"])
        compared, rules = projection(row, native)
        require(item["rules"] == rules, "Unregistered or omitted projection rule: " + item["id"])
        require(same(read_json(item["comparisonObservationJSON"], lexical=True), compared), "Comparison is not derived from actual native fields: " + item["id"])
        require(same(compared, expected), "Actual native comparison differs: " + item["id"])
        if same(native, expected):
            strict.append(item["id"])
        else:
            projected.append(item["id"])
        if rules:
            adaptations.append(item)
        if native["outcome"] == "returned" and row["operation"] in {"computeCatalogIdentity", "identityForManifest"}:
            check_identity(native["value"])
        native_receipts.append(item["id"] + "\n" + normalized(native) + "\n")
    native_sha = sha("".join(native_receipts).encode())
    require(native_sha == NATIVE_LEDGER_SHA, "Complete native observation receipt differs: " + native_sha)
    require(len(strict) == 165 and ids_sha(strict) == STRICT_SHA and report["strictNativeEqualIDs"] == strict, "Strict native-equal inventory differs")
    require(len(projected) == 303 and ids_sha(projected) == PROJECTED_SHA and report["projectedMatchedIDs"] == projected, "Projected inventory differs")
    require(report["adaptationObservations"] == adaptations and [item["id"] for item in adaptations] == projected, "Adaptation ledger omitted or changed observations")
    require([item["id"] for item in report["pendingCarriers"]] == sorted(pending) and [item["id"] for item in report["pendingObservations"]] == sorted(pending), "Pending ledger omitted an ID")
    for carrier, observation in zip(report["pendingCarriers"], report["pendingObservations"]):
        fields(carrier, {"id", "category", "evidence"})
        fields(observation, {"id", "referenceObservationJSON", "reason"}, {"nativeObservationJSON"})
        category, evidence = pending[carrier["id"]]
        require(carrier["category"] == category and carrier["evidence"] == observation["reason"] == evidence, "Pending guard evidence differs")
        require(observation.get("nativeObservationJSON") is None, "Frozen typed pending carrier must not fabricate a native call")
        require(same(read_json(observation["referenceObservationJSON"], lexical=True), read_json(json.dumps(row_by_id[carrier["id"]]["expected"]), lexical=True)), "Pending reference observation changed")
    return {"status": "passed", "scope": report["scope"], "totalCases": 499, "eligibleCases": 468,
            "strictNativeEqualCases": 165, "projectedMatchedCases": 303, "pendingCases": 31,
            "eligibleIDsSHA256": ELIGIBLE_SHA, "strictNativeEqualIDsSHA256": STRICT_SHA,
            "projectedMatchedIDsSHA256": PROJECTED_SHA, "pendingIDsSHA256": PENDING_SHA,
            "nativeObservationLedgerSHA256": native_sha, "vectorsSHA256": VECTORS_SHA, "lockSHA256": LOCK_SHA,
            "nativeMappingsRatified": False}


def self_test(path, reference):
    control = report_check(path, reference)
    original = read_json(Path(path).read_bytes())
    def mutate_text(document, field, change, predicate=lambda item: True):
        item = next(item for item in document["observations"] if predicate(item))
        value = read_json(item[field]); change(value)
        item[field] = json.dumps(value, ensure_ascii=True)
    mutations = {
        "omit-native-observation": lambda value: value["observations"].pop(),
        "omit-adaptation-receipt": lambda value: value["adaptationObservations"].pop(),
        "omit-pending-receipt": lambda value: value["pendingObservations"].pop(),
        "omit-pending-carrier": lambda value: value["pendingCarriers"].pop(),
        "ratify-without-mapping": lambda value: value.update(nativeMappingsRatified=True),
        "alter-eligible-id": lambda value: value["eligibleIDs"].pop(),
        "forge-reference": lambda value: mutate_text(value, "referenceObservationJSON", lambda result: result.update(forged=True)),
        "forge-native-extra-field": lambda value: mutate_text(value, "nativeObservationJSON", lambda result: result.update(forged=True)),
        "forge-comparison": lambda value: mutate_text(value, "comparisonObservationJSON", lambda result: result.update(forged=True)),
        "omit-projection-rule": lambda value: next(item for item in value["observations"] if item["rules"])["rules"].pop(),
        "alter-unprojected-native-cause-reason": lambda value: mutate_text(value, "nativeObservationJSON", lambda result: result["error"]["cause"].update(reason="fabricated"), lambda item: "native-json-reader-cause-projection" in item["rules"]),
        "alter-identity-byte-count": lambda value: mutate_text(value, "nativeObservationJSON", lambda result: result["value"].update(byteCount=0), lambda item: item["id"] == "m7a.identity.base"),
        "unknown-report-field": lambda value: value.update(forged=True),
        "alter-pending-evidence": lambda value: value["pendingCarriers"][0].update(evidence="fabricated"),
    }
    outcomes = []
    with tempfile.TemporaryDirectory(prefix="lokalized-manifest-integrity-") as directory:
        altered = Path(directory) / "report.json"
        for label, mutation in mutations.items():
            candidate = deepcopy(original); mutation(candidate)
            altered.write_text(json.dumps(candidate, ensure_ascii=True), encoding="utf-8")
            try:
                report_check(altered, reference)
            except (ValueError, KeyError, TypeError) as error:
                outcomes.append({"mutation": label, "status": "rejected", "reason": str(error)})
            else:
                raise ValueError("Report integrity mutation was accepted: " + label)
        copied = Path(directory) / "Reference"; copied.mkdir()
        for name in ["manifest-contract-vectors.json", "manifest-contract-lock.json"]:
            (copied / name).write_bytes((Path(reference) / name).read_bytes())
        target = copied / "manifest-contract-vectors.json"
        target.write_bytes(target.read_bytes() + b" ")
        try:
            report_check(path, copied)
        except ValueError as error:
            outcomes.append({"mutation": "alter-frozen-reference-bytes", "status": "rejected", "reason": str(error)})
        else:
            raise ValueError("Altered frozen reference was accepted")
    return {"status": "passed", "control": control, "rejectedMutations": outcomes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--reference", type=Path, default=Path(__file__).resolve().parents[2] / "generated/manifest-contract")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--integrity-report", type=Path)
    args = parser.parse_args()
    result = self_test(args.report, args.reference) if args.self_test else report_check(args.report, args.reference)
    if args.integrity_report:
        require(args.self_test, "--integrity-report requires --self-test")
        args.integrity_report.parent.mkdir(parents=True, exist_ok=True)
        args.integrity_report.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
