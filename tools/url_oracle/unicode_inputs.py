"""Pinned Unicode data parsing for the shared IDNA input recipe; no port code."""
import hashlib
import re

PINS = {
    "IdnaMappingTable.txt": ("https://www.unicode.org/Public/17.0.0/idna/IdnaMappingTable.txt", "87f05505dc026fdb2bff16132bdc68a8014675836882a9a2b1844540ad3be382"),
    "UnicodeData.txt": ("https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt", "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c"),
    "DerivedNormalizationProps.txt": ("https://www.unicode.org/Public/17.0.0/ucd/DerivedNormalizationProps.txt", "71fd6a206a2c0cdd41feb6b7f656aa31091db45e9cedc926985d718397f9e488"),
    "DerivedBidiClass.txt": ("https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedBidiClass.txt", "4867b4b7f0731ed1bfcd34cc6251211ff1542541fce0734b6fbda139ee80b3a4"),
    "DerivedJoiningType.txt": ("https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedJoiningType.txt", "f39ebe974825d6736aee15582250307aa532b2cfab3caf3f86bd23fddc9c5c4d"),
    "NormalizationTest.txt": ("https://www.unicode.org/Public/17.0.0/ucd/NormalizationTest.txt", "5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db"),
    "LICENSE.txt": ("https://www.unicode.org/license.txt", "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96"),
}


STATUS = {"valid": 0, "ignored": 1, "mapped": 2, "deviation": 3, "disallowed": 4}


BIDI = {"L": 0, "R": 1, "AL": 2, "AN": 3, "EN": 4, "ES": 5,
        "CS": 6, "ET": 7, "ON": 8, "BN": 9, "NSM": 10}


BIDI_NAMES = {"Left_To_Right": "L", "Right_To_Left": "R", "Arabic_Letter": "AL",
              "Arabic_Number": "AN", "European_Number": "EN", "European_Separator": "ES",
              "Common_Separator": "CS", "European_Terminator": "ET", "Other_Neutral": "ON",
              "Boundary_Neutral": "BN", "Nonspacing_Mark": "NSM"}


JOINING = {"U": 0, "L": 1, "R": 2, "D": 3, "T": 4, "C": 5}


JOINING_NAMES = {"Non_Joining": "U", "Left_Joining": "L", "Right_Joining": "R",
                 "Dual_Joining": "D", "Transparent": "T", "Join_Causing": "C"}


MAX = 0x110000


def sha(data):
    return hashlib.sha256(data).hexdigest()


def interval(text):
    values = [int(part, 16) for part in text.strip().split("..")]
    if len(values) == 1:
        values *= 2
    if len(values) != 2 or not 0 <= values[0] <= values[1] < MAX:
        raise ValueError(f"Invalid Unicode interval: {text}")
    return values


def fields(text):
    for line in text.splitlines():
        data = line.split("#", 1)[0].strip()
        if data:
            yield [part.strip() for part in data.split(";")]


def derived_property(text, codes, names, default, unknown=None):
    values = bytearray([default]) * MAX
    for line in text.splitlines():
        match = re.match(r"#\s*@missing:\s*([^;]+);\s*(\S+)", line)
        if match:
            first, last = interval(match.group(1))
            name = names.get(match.group(2), match.group(2))
            code = codes.get(name, unknown)
            if code is None:
                raise ValueError(f"Unknown missing property: {name}")
            values[first:last + 1] = bytes([code]) * (last - first + 1)
    assigned = bytearray(MAX)
    for row in fields(text):
        first, last = interval(row[0])
        name = names.get(row[1], row[1])
        code = codes.get(name, unknown)
        if code is None or any(assigned[first:last + 1]):
            raise ValueError(f"Unknown or overlapping Unicode property: {row}")
        values[first:last + 1] = bytes([code]) * (last - first + 1)
        assigned[first:last + 1] = bytes([1]) * (last - first + 1)
    return values
