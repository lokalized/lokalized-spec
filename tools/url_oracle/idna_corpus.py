"""Shared frozen IDNA corpus, exact input recipe and bounded gzip storage.

This module uses only Python stdlib. Normal checks need neither a port compiler
nor Node. Expected URL outcomes are independently recorded from the pinned
Node URL engine, not inferred from Unicode status columns or port algorithms.
"""
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import zlib
from . import property_inputs
from . import normalization_inputs
from . import oracle_runtime

MAXIMUM_COMPRESSED_BYTES = 2_097_152


MAXIMUM_DECODED_BYTES = 33_554_432


SOURCE_SHA256 = "beb5d0be20e896189b03209a82fdc34f06351502bbd4b8e2523583fc2954d9cf"


PROPERTY_PROFILE_SHA256 = "84ae2c73b06823e54716dff80f7f539e588a676e7ff8529424046fe34f7a1098"


PROPERTY_DATA_SOURCE_SHA256 = "ac8fba37ceddb7c10ca5a24fd57a0f0a0ca32cd3d391e40c6f9f6b7af3801fd4"


NORMALIZATION_PROFILE_SHA256 = "9cb7782123a2f08f8a69a8ec702ff7910cff69cd03773e6d665d79ed5a4b327c"


GOLDENS_SHA256 = "7f84ecb403b6e772f00dfa851d7de42e6d9556998dbb0b47feca23c8fff380db"


NODE_SHA256 = "87026f4b570ee090c0e0b48e8c6586ede31952695aac2b0021cc67e44987d511"


NODE_VERSIONS = {"node": "v26.5.0", "unicode": "17.0", "icu": "78.3", "ada": "4.0.0"}


EXCLUDED_LINES = [548, 549]


NODE = r'''const fs=require('node:fs');
const rows=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify({versions:{node:process.version,unicode:process.versions.unicode,
icu:process.versions.icu,ada:process.versions.ada},results:rows.map(row=>{
try{return{url:new URL(row.input,row.base).href}}catch{return{error:'invalid'}}
})}));'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def gzip_bytes(data):
    # Explicit GzipFile avoids Python-version-specific OS header bytes. No
    # filename or timestamp is stored, so repeated refreshes have stable headers.
    output = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as stream:
        stream.write(data)
    return output.getvalue()


def read_gzip(path, maximum_compressed_bytes=MAXIMUM_COMPRESSED_BYTES, maximum_decoded_bytes=MAXIMUM_DECODED_BYTES):
    if not 0 <= maximum_compressed_bytes < 2**32 - 1 or not 0 <= maximum_decoded_bytes < sys.maxsize:
        raise ValueError("Invalid compressed reference byte budget")
    with Path(path).open("rb") as stream:
        compressed = stream.read(maximum_compressed_bytes + 1)
    if len(compressed) > maximum_compressed_bytes:
        raise ValueError("Reference file exceeds byte budget: " + Path(path).name)
    decoder = zlib.decompressobj(zlib.MAX_WBITS + 16)
    try:
        decoded = decoder.decompress(compressed, maximum_decoded_bytes + 1)
    except zlib.error as error:
        raise ValueError("Compressed reference is invalid or truncated: " + Path(path).name) from error
    if len(decoded) > maximum_decoded_bytes:
        raise ValueError("Decoded reference exceeds byte budget: " + Path(path).name)
    if not decoder.eof:
        raise ValueError("Compressed reference is invalid or truncated: " + Path(path).name)
    if decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError("Compressed reference has trailing data: " + Path(path).name)
    return decoded


def percent_host(value):
    return "".join(f"%{byte:02X}" for byte in value.encode("utf-8"))


def matrix(reference_directory):
    source = Path(reference_directory) / "Unicode-17.0.0/IdnaTestV2.txt"
    raw = source.read_bytes()
    if digest(raw) != SOURCE_SHA256:
        raise ValueError("Unicode 17 IDNA test input digest differs")
    rows, excluded = [], []
    for line_number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        content = line.split("#", 1)[0].strip()
        if not content:
            continue
        value = content.split(";", 1)[0].strip()
        value = "" if value == '""' else value
        value = re.sub(r"\\u([0-9A-Fa-f]{4})|\\x\{([0-9A-Fa-f]+)\}",
                       lambda match: chr(int(match.group(1) or match.group(2), 16)), value)
        if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
            excluded.append(line_number)
            continue
        rows.append({"id": f"manifest-idna-official-{line_number:05d}", "origin": f"IdnaTestV2.txt:{line_number}",
                     "input": {"input": "https://" + percent_host(value) + "/"}})
    if len(rows) != 6389 or excluded != EXCLUDED_LINES:
        raise ValueError("Unicode 17 IDNA source inventory differs")
    domains = [
        "é.example", "e\u0301.example", "café.fr", "CAFÉ.fr", "faß.de", "ς.gr", "Σ.gr", "βόλος.gr",
        "bücher.example", "mañana.example", "日本語.example", "例え.テスト", "παράδειγμα.δοκιμή", "مثال.إختبار",
        "a\u00adb.example", "a\u034fb.example", "a\uFEFFb.example", "\uFEFF.example", "\u00AD", "\uFEFF",
        "\u3002", "。a。b。", "a\uFF0Eb\uFF61c.example", "ｅｘａｍｐｌｅ．ｃｏｍ", "K.example", "Å.example", "Ａ.example",
        "\u0301.example", "\u0903.example", "\u0488.example", "\u20DD.example", "\u302E.example",
        "a\u0903.example", "a\u0488.example", "a\u20DD.example", "a\u302E.example",
        "a\u200Cb.example", "a\u200Db.example", "क्\u200Dष.example", "क्\u200Cष.example", "क\u200Dष.example",
        "ب\u200Cب.example", "ب\u064E\u200C\u064Eب.example", "ا\u200Cب.example", "ب\u200Cا.example",
        "א.example", "אבג.example", "1.א", "א.1", "_a.א", "a-.א", "-.א", "é.1.א", "é._a.א", "é.a-.א",
        "1é.א", "1א.example", "א1.example", "א-.example", "א_.example", "אa.example", "ا١1.example",
        "א\u0301.example", "א\u0301-.example", "א\u061C.example", "א\u200F.example", "a\u0591.א",
        "😀.example", "🫩.example", "\U0001CC00.example", "\U0001E6C0.example", "\U00010D50.example",
        "\U00010FFFF.example", "\U000F0000.example", "\u0378.example", "\uD7FF.example", "\uE000.example",
        "-é.example", "é-.example", "ab--é.example", "a..é.example", ".é.example", "é.example.",
        "é." + "a" * 64, "é." + ".".join(["a" * 63] * 5), "é" * 64 + ".example",
        "\u1100\u1161\u11A8.example", "각.example", "a\u0315\u0300.example", "à\u0315.example",
        "\u0958.example", "क\u093C.example", "\u0344.example", "é.١.example", "é.۱۲.example",
        "①②⑦。①.example", "０x７f。①.example", "１２７。０。０。１", "é.１２３", "é.%31.example",
        "aبb.example", "aب\u200Cبb.example", "aب\u200Cبא.example", "1ب\u200Cب.example", "aب\u200Cب_.example",
        "aב\u200D.example", "aب\u200Cبb.אבa", "אבa.aب\u200Cبb", "aب\u200Cبb.a\u200Db", "a\u200Db.aب\u200Cبb",
        "xn---9ca.é.example", "xn--e-xbb.é.example", "xn--caf-dma-.é.example",
        "بa\u200Caب.example", "ب-\u200C-ب.example", "ب_\u200C_ب.example", "بa\u200Caبa\u200Db.example",
        "a\u200Dbب\u200Cب.example", "ب\u200Cبa\u200Db.example", "a\u200Cbक्\u200Dष.example", "क्\u200Dषa\u200Cb.example",
        "ب\u200Cب\u200Cb.example", "ب\u200Cب\u200Db.example", "\uFEFFxn--0", "\uFEFFxn--", "\uFEFFxn--a",
    ]
    ace_labels = ["xn--", "XN--", "xn--a", "xn--abc", "xn--a-", "xn--abc-", "xn--0", "xn--9ca", "XN--CAF-DMA",
                  "xn--bcher-kva", "xn--e-xbb", "xn--caf-dma-", "xn--_-cga", "xn--4db", "xn--1-zhc",
                  "xn--a-bbb", "xn--a-ecp", "xn--a-0hc", "xn--a-zec", "xn--" + "a" * 64]
    for label in ace_labels:
        domains.extend([label, label + ".example", "é." + label + ".example", label + ".é.example", "א." + label + ".example"])
    for scalar in [0, 0x20, 0x7F, 0xA0, 0xFF03, 0xFF05, 0xFF0F, 0xFF1A, 0xFF1C, 0xFF1E, 0xFF1F,
                   0xFF20, 0xFF3B, 0xFF3C, 0xFF3D, 0xFF3E, 0xFF5C]:
        domains.append("a" + chr(scalar) + "b.example")
    for index, domain in enumerate(domains, 1):
        for form, input_value in [
            ("direct", {"input": "https://" + domain + "/café?q=你好#é"}),
            ("percent", {"input": "https://" + percent_host(domain) + "/"}),
            ("base", {"input": "../next?é#é", "base": "https://" + domain + "/a/b/"}),
        ]:
            rows.append({"id": f"manifest-idna-targeted-{index:03d}-{form}", "origin": f"targeted domain {index}/{form}", "input": input_value})
    for index, host in enumerate(["%C3%28", "%ED%A0%80", "%ED%BF%BF", "%F0%80%80%AF", "%C0%AF", "%F4%90%80%80",
                                  "%E2%82", "%80", "%FF", "%FE", "%EF%BB%BFexample.com", "%EF%BB%BF",
                                  "a%00b.example", "a%09b.example", "a%0Ab.example", "a%20b.example", "a%23b.example",
                                  "a%25b.example", "a%2Fb.example", "a%3Fb.example", "a%40b.example", "%", "%2", "%GG"], 1):
        rows.append({"id": f"manifest-idna-utf8-{index:03d}", "origin": "targeted percent-decoding boundary", "input": {"input": "https://" + host + "/"}})
    for row in property_inputs.property_discriminant_inputs(reference_directory):
        rows.append({"id": "manifest-idna-property-" + row["id"].replace(":", "-"),
                     "origin": "Node validity property discriminant " + row["id"], "input": {"input": row["input"]}})
    for row in normalization_inputs.normalization_discriminant_inputs(reference_directory):
        rows.append({"id": "manifest-idna-normalization-" + row["id"].replace(":", "-"),
                     "origin": "Node normalization discriminant " + row["id"], "input": {"input": row["input"]}})
    # Python's stdlib RFC 3492 codec authors the ASCII input; all expected URL
    # outcomes still come independently from the pinned Node executable.
    for count in [10_659, 10_660, 10_661, 10_662, 12_000]:
        label = "a" * count + "\U0003134A"
        ace = "xn--" + label.encode("punycode").decode("ascii")
        forms = [
            ("direct", {"input": "https://" + label + "/"}),
            ("percent", {"input": "https://" + percent_host(label) + "/"}),
            ("base", {"input": "next", "base": "https://" + label + "/"}),
            ("ace-ascii", {"input": "https://" + ace + "/"}),
            ("ace-unicode", {"input": "https://" + ace + ".é/"}),
        ]
        for form, input_value in forms:
            rows.append({"id": f"manifest-idna-arithmetic-{count:05d}-{form}",
                         "origin": f"Node signed 31-bit Punycode boundary: {count} ASCII scalars + U+3134A/{form}", "input": input_value})
    resource_domains = []
    for count in [16_380, 16_381, 16_382, 16_383]:
        for kind, suffix in [("unicode-label", ".é"), ("ignored-soft-hyphen", "\u00AD"), ("ignored-bom", "\uFEFF"),
                             ("percent-bom", "%EF%BB%BF")]:
            resource_domains.append((f"{kind}-{count:05d}", "b" * count + suffix, kind != "percent-bom"))
    for count in [8_191, 8_192, 8_193]:
        resource_domains.append((f"multibyte-{count:05d}", "é" * count, True))
    resource_domains.append(("ascii-bypass-20000", "b" * 20_000 + ".example", True))
    for name, domain, encode_whole_host in resource_domains:
        forms = [("direct", {"input": "https://" + domain + "/"}),
                 ("base", {"input": "next", "base": "https://" + domain + "/"})]
        if encode_whole_host:
            forms.append(("percent", {"input": "https://" + percent_host(domain) + "/"}))
        for form, input_value in forms:
            rows.append({"id": f"manifest-idna-resource-{name}-{form}",
                         "origin": f"Node non-ASCII decoded-domain 16384-byte boundary/{name}/{form}", "input": input_value})
    for count in [16_383, 16_384, 16_385]:
        domain = "b" * count
        forms = [("literal", {"input": "https://" + domain + "/"}),
                 ("first-percent", {"input": "https://%62" + domain[1:] + "/"}),
                 ("all-percent", {"input": "https://" + percent_host(domain) + "/"}),
                 ("base-first-percent", {"input": "next", "base": "https://%62" + domain[1:] + "/"})]
        for form, input_value in forms:
            rows.append({"id": f"manifest-idna-resource-escaped-ascii-{count:05d}-{form}",
                         "origin": f"Decoded ASCII byte boundary with raw-host shortcut/{count}/{form}", "input": input_value})
    for index, host in enumerate(["xn--0", "%78n--0", "xn--%30", "xn--%2D", "%78n--", "%78n--a", "%EF%BB%BFxn--0",
                                  "xn--bcher-kva", "%78n--bcher-kva", "xn--bcher%2Dkva", "%EF%BB%BFxn--bcher-kva",
                                  "XN--%42CHER-KVA", "%62ücher.example"], 1):
        rows.append({"id": f"manifest-idna-escaped-ace-{index:02d}", "origin": "Partial percent-decoding and ACE profile boundary",
                     "input": {"input": "https://" + host + "/"}})
    return sorted(rows, key=lambda row: row["id"])


def archive_check(archive_path, reference_directory):
    oracle_runtime.read_lock(reference_directory)
    data = read_gzip(archive_path)
    if digest(data) != GOLDENS_SHA256:
        raise ValueError("Manifest IDNA archive digest differs")
    archive = json.loads(data)
    recipe = matrix(reference_directory)
    required = {"formatVersion", "recipeVersion", "oracle", "nodeVersions", "nodeBinarySHA256", "sourceURL", "sourceSHA256",
                "excludedIllFormedSourceLines", "propertyProfileSHA256", "propertyDataSourceSHA256", "normalizationProfileSHA256",
                "oracleRuntimeLockSHA256", "scope", "recipeSHA256", "rows"}
    if set(archive) != required or archive["formatVersion"] != 1 or archive["recipeVersion"] != 1:
        raise ValueError("Manifest IDNA archive field inventory/version differs")
    if (archive["nodeVersions"] != NODE_VERSIONS or archive["nodeBinarySHA256"] != NODE_SHA256
            or archive["sourceSHA256"] != SOURCE_SHA256 or archive["excludedIllFormedSourceLines"] != EXCLUDED_LINES
            or archive["propertyProfileSHA256"] != PROPERTY_PROFILE_SHA256 or archive["propertyDataSourceSHA256"] != PROPERTY_DATA_SOURCE_SHA256
            or archive["normalizationProfileSHA256"] != NORMALIZATION_PROFILE_SHA256 or archive["oracleRuntimeLockSHA256"] != oracle_runtime.LOCK_SHA256
            or archive["recipeSHA256"] != digest(json.dumps(recipe, ensure_ascii=False, separators=(",", ":")).encode())):
        raise ValueError("Manifest IDNA oracle/input provenance differs")
    if len(archive["rows"]) != len(recipe):
        raise ValueError("Manifest IDNA archived input count differs")
    for archived, authored in zip(archive["rows"], recipe):
        if set(archived) != {"id", "origin", "input", "expected"} or {key: archived[key] for key in authored} != authored:
            raise ValueError("Manifest IDNA authored input differs")
        expected = archived["expected"]
        if not isinstance(expected, dict) or not (set(expected) == {"url"} and isinstance(expected["url"], str) or expected == {"error": "invalid"}):
            raise ValueError("Manifest IDNA expected observation shape differs")
    return archive


def refresh_goldens(node, archive_path, reference_directory):
    if not node or digest(Path(node).resolve().read_bytes()) != NODE_SHA256:
        raise ValueError("Refresh requires the pinned Node binary")
    recipe = matrix(reference_directory)
    oracle_runtime.verify_loaded(node, reference_directory)
    run = subprocess.run([node, "-e", NODE], input=json.dumps([row["input"] for row in recipe]), text=True, capture_output=True, check=True)
    oracle = json.loads(run.stdout)
    if oracle["versions"] != NODE_VERSIONS or len(oracle["results"]) != len(recipe):
        raise ValueError("Pinned Node profile/count differs")
    oracle_runtime.verify_loaded(node, reference_directory)
    archive = {"formatVersion": 1, "recipeVersion": 1, "oracle": "Node built-in WHATWG URL", "nodeVersions": oracle["versions"],
               "nodeBinarySHA256": NODE_SHA256, "sourceURL": "https://www.unicode.org/Public/17.0.0/idna/IdnaTestV2.txt",
               "sourceSHA256": SOURCE_SHA256, "excludedIllFormedSourceLines": EXCLUDED_LINES,
               "propertyProfileSHA256": PROPERTY_PROFILE_SHA256, "propertyDataSourceSHA256": PROPERTY_DATA_SOURCE_SHA256,
               "normalizationProfileSHA256": NORMALIZATION_PROFILE_SHA256, "oracleRuntimeLockSHA256": oracle_runtime.LOCK_SHA256,
               "scope": "Unicode scalar-compatible UTS46 official source strings through relaxed browser URL host parsing, directed URL boundaries, and pinned Node validity/normalization discriminants; no strict/transitional UTS46 conformance claim",
               "recipeSHA256": digest(json.dumps(recipe, ensure_ascii=False, separators=(",", ":")).encode()),
               "rows": [dict(row, expected=observation) for row, observation in zip(recipe, oracle["results"])]}
    data = (json.dumps(archive, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    compressed = gzip_bytes(data)
    if len(data) > MAXIMUM_DECODED_BYTES or len(compressed) > MAXIMUM_COMPRESSED_BYTES:
        raise ValueError("Refreshed manifest IDNA archive exceeds byte budget")
    Path(archive_path).write_bytes(compressed)
    return {"archiveSHA256": digest(data), "compressedSHA256": digest(compressed),
                      "decodedBytes": len(data), "compressedBytes": len(compressed),
                      "rows": len(recipe), "recipeSHA256": archive["recipeSHA256"]}
