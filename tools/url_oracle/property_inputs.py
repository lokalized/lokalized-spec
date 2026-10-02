"""Portable validity-property discriminants for the pinned Node URL profile."""
import hashlib
import json
from pathlib import Path
from . import unicode_inputs as unicode

PROFILE_SHA256 = '84ae2c73b06823e54716dff80f7f539e588a676e7ff8529424046fe34f7a1098'


LICENSE_SHA256 = 'af0d7d2cef91fc243cf4ad98570b03d1f26f5e0227cad0f5f4a7376e2feb3160'


SOURCE_SHA256 = 'ac8fba37ceddb7c10ca5a24fd57a0f0a0ca32cd3d391e40c6f9f6b7af3801fd4'


NODE_BINARY_SHA256 = '87026f4b570ee090c0e0b48e8c6586ede31952695aac2b0021cc67e44987d511'


BIDI = {'L': 0, 'R': 1, 'AL': 2, 'AN': 3, 'EN': 4, 'ES': 5,
        'CS': 6, 'ET': 7, 'ON': 8, 'BN': 9, 'NSM': 10}


JOINING = {'U': 0, 'L': 1, 'R': 2, 'D': 3}


MAX = 0x110000


def sha(value):
    return hashlib.sha256(value).hexdigest()


def load_profile(reference_directory):
    directory = Path(reference_directory) / 'IDNA-Compatibility'
    raw = (directory / 'property-profile.json').read_bytes()
    license_bytes = (directory / 'LICENSE-MIT.txt').read_bytes()
    if sha(raw) != PROFILE_SHA256 or sha(license_bytes) != LICENSE_SHA256:
        raise ValueError('IDNA compatibility property/license digest differs')
    profile = json.loads(raw)
    authority = profile['compatibilityAuthority']
    source = profile['propertyDataSource']
    if (profile['formatVersion'] != 1 or authority['nodeVersion'] != 'v26.5.0'
            or authority['adaVersion'] != '4.0.0' or authority['nodeBinarySHA256'] != NODE_BINARY_SHA256
            or source['sha256'] != SOURCE_SHA256 or source['section'] != 'src/validity.cpp'
            or profile['defaults'] != dict(mark=False, virama=False, joiningType='U', bidiClass='NONE')):
        raise ValueError('IDNA compatibility profile metadata differs')
    properties = profile['properties']
    counts = {'marks': 2295, 'viramas': 61}
    for name, count in counts.items():
        values = properties[name]
        if len(values) != count or values != sorted(set(values)) or any(type(cp) is not int or not 0 <= cp < MAX for cp in values):
            raise ValueError('IDNA compatibility scalar inventory differs: ' + name)
    joining = properties['joiningTypes']
    if set(joining) != {'L', 'R', 'D'} or {name: len(values) for name, values in joining.items()} != {'L': 1, 'R': 71, 'D': 326}:
        raise ValueError('IDNA compatibility joining inventory differs')
    seen = set()
    for values in joining.values():
        if values != sorted(set(values)) or seen.intersection(values):
            raise ValueError('IDNA compatibility joining data overlaps')
        seen.update(values)
    previous = -1
    ranges = properties['bidiClasses']
    if len(ranges) != 1449:
        raise ValueError('IDNA compatibility Bidi inventory differs')
    names = set(BIDI) | {'WS', 'RLO', 'LRO', 'PDF', 'RLE', 'RLI', 'FSI', 'PDI', 'LRI', 'B', 'S', 'LRE'}
    for first, last, value in ranges:
        if not previous < first <= last < MAX or value not in names:
            raise ValueError('IDNA compatibility Bidi ranges differ')
        previous = last
    return profile, license_bytes.decode('utf-8')


def property_arrays(profile, diagnostic_bidi_default=11):
    properties = profile['properties']
    mark, virama, joining = bytearray(MAX), bytearray(MAX), bytearray(MAX)
    bidi = bytearray([diagnostic_bidi_default]) * MAX
    for cp in properties['marks']:
        mark[cp] = 1
    for cp in properties['viramas']:
        virama[cp] = 1
    for name, values in properties['joiningTypes'].items():
        for cp in values:
            joining[cp] = JOINING[name]
    for first, last, name in properties['bidiClasses']:
        bidi[first:last + 1] = bytes([BIDI.get(name, 11)]) * (last - first + 1)
    return {'marks': mark, 'viramas': virama, 'joiningTypes': joining, 'bidiClasses': bidi}


def property_discriminant_inputs(reference_directory):
    """All 32,203 modern/legacy scalar discriminants, with deterministic IDs.

    The recipe compares property data, then qualifies the resulting URLs against
    the actual frozen binary. It does not infer results from upstream algorithms.
    """
    profile, _ = load_profile(reference_directory)
    texts = {}
    for name, (_, expected) in unicode.PINS.items():
        raw = (Path(reference_directory) / 'Unicode-17.0.0' / name).read_bytes()
        if sha(raw) != expected:
            raise ValueError('Unicode discriminant input digest differs: ' + name)
        texts[name] = raw.decode('utf-8')
    modern_marks, modern_viramas = set(), set()
    for row in unicode.fields(texts['UnicodeData.txt']):
        cp = int(row[0], 16)
        if row[2].startswith('M'):
            modern_marks.add(cp)
        if int(row[3]) == 9:
            modern_viramas.add(cp)
    modern_joining = unicode.derived_property(texts['DerivedJoiningType.txt'], unicode.JOINING, unicode.JOINING_NAMES, 0)
    modern_bidi = unicode.derived_property(texts['DerivedBidiClass.txt'], unicode.BIDI, unicode.BIDI_NAMES, 0, 11)
    # Diagnostic NONE=12 keeps unknown source membership distinct from known
    # unsupported Bidi classes, even though both have runtime refusal code 11.
    legacy = property_arrays(profile, diagnostic_bidi_default=12)
    status = bytearray(MAX)
    for row in unicode.fields(texts['IdnaMappingTable.txt']):
        first, last = unicode.interval(row[0])
        status[first:last + 1] = bytes([unicode.STATUS[row[1]]]) * (last - first + 1)
    allowed = [cp for cp in range(MAX) if status[cp] in (0, 3)]
    mark_diffs = [cp for cp in allowed if (cp in modern_marks) != bool(legacy['marks'][cp])]
    virama_diffs = [cp for cp in allowed if (cp in modern_viramas) != bool(legacy['viramas'][cp])]
    joining_diffs = [cp for cp in allowed if modern_joining[cp] != legacy['joiningTypes'][cp]
                     and (modern_joining[cp] in (1, 2, 3) or legacy['joiningTypes'][cp] in (1, 2, 3))]
    bidi_diffs = [cp for cp in allowed if modern_bidi[cp] != legacy['bidiClasses'][cp]]
    rows = []

    def add(kind, cp, domain):
        rows.append(dict(id=f'{kind}:{cp:06x}', scalar=f'{cp:06x}', input='https://' + domain + '/'))

    for cp in mark_diffs:
        add('mark-leading', cp, chr(cp) + 'a')
    for cp in virama_diffs:
        add('virama-zwj', cp, 'a' + chr(cp) + '\u200d')
    for cp in joining_diffs:
        if modern_joining[cp] in (1, 3) or legacy['joiningTypes'][cp] in (1, 3):
            add('joining-left', cp, 'a' + chr(cp) + '\u200cب')
        if modern_joining[cp] in (2, 3) or legacy['joiningTypes'][cp] in (2, 3):
            add('joining-right', cp, 'ب\u200c' + chr(cp) + 'a')
    for cp in bidi_diffs:
        add('bidi-mixed-rtl', cp, 'ב' + chr(cp) + 'ב')
        add('bidi-latin-wrap', cp, 'a' + chr(cp) + 'a')
    if len(rows) != 32_203 or len({row['id'] for row in rows}) != len(rows):
        raise ValueError('IDNA property discriminant inventory differs')
    return rows
