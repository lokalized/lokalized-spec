"""Portable normalization discriminants for the pinned Node URL profile."""
import hashlib
import json
from pathlib import Path
from . import property_inputs
from . import unicode_inputs as unicode

PROFILE_SHA256 = '9cb7782123a2f08f8a69a8ec702ff7910cff69cd03773e6d665d79ed5a4b327c'


SOURCE_SHA256 = 'ac8fba37ceddb7c10ca5a24fd57a0f0a0ca32cd3d391e40c6f9f6b7af3801fd4'


def sha(value):
    return hashlib.sha256(value).hexdigest()


def load_profile(reference_directory):
    directory = Path(reference_directory) / 'IDNA-Compatibility'
    raw = (directory / 'normalization-profile.json').read_bytes()
    if sha(raw) != PROFILE_SHA256:
        raise ValueError('IDNA normalization compatibility profile digest differs')
    profile = json.loads(raw)
    if profile['propertyDataSource']['sha256'] != SOURCE_SHA256 or profile['compatibilityAuthority']['nodeVersion'] != 'v26.5.0':
        raise ValueError('IDNA normalization compatibility authority differs')
    ranges = profile['properties']['combiningClasses']
    pairs = profile['properties']['compositionPairs']
    decompositions = profile['properties']['decompositions']
    if len(ranges) != 388 or len(pairs) != 941 or pairs != sorted(pairs) or len({(first, second) for first, second, _ in pairs}) != len(pairs):
        raise ValueError('IDNA normalization compatibility inventory differs')
    if len(decompositions) != 2061 or decompositions != sorted(decompositions) or len({scalar for scalar, _ in decompositions}) != 2061:
        raise ValueError('IDNA normalization decomposition inventory differs')
    previous = -1
    for first, last, value in ranges:
        if not previous < first <= last <= 0x10FFFF or not 0 < value < 256:
            raise ValueError('IDNA normalization compatibility CCC ranges differ')
        previous = last
    _, license_text = property_inputs.load_profile(reference_directory)
    return profile, license_text


def normalization_discriminant_inputs(reference_directory):
    profile, _ = load_profile(reference_directory)
    texts = {}
    for name, (_, pin) in unicode.PINS.items():
        raw = (Path(reference_directory) / 'Unicode-17.0.0' / name).read_bytes()
        if sha(raw) != pin:
            raise ValueError('Unicode normalization discriminant input differs: ' + name)
        texts[name] = raw.decode('utf-8')
    ccc = bytearray(0x110000)
    for first, last, value in profile['properties']['combiningClasses']:
        ccc[first:last + 1] = bytes([value]) * (last - first + 1)
    rows = []

    def add(observation_id, scalars):
        text = ''.join(chr(cp) for cp in scalars)
        rows.append(dict(id=observation_id, input='https://' + text + '.é/'))

    # Every stored composition pair, and its precomposed result followed by
    # marks that can expose a difference from complete canonical decomposition.
    for index, (first, second, result) in enumerate(profile['properties']['compositionPairs']):
        add(f'normalization:pair:{index:04d}', [first, second])
        for mark in [0x0334, 0x0323, 0x0301]:
            add(f'normalization:precomposed:{index:04d}:{mark:04x}', [result, mark])
            add(f'normalization:precomposed-slow:{index:04d}:{mark:04x}', [result, mark, 0x2E, 0x61, 0x301])
    for index, (scalar, _) in enumerate(profile['properties']['decompositions']):
        add(f'normalization:decomposition:{index:04d}', [scalar])
        add(f'normalization:decomposition-slow:{index:04d}', [scalar, 0x323, 0x2E, 0x61, 0x301])
    for row in unicode.fields(texts['UnicodeData.txt']):
        cp = int(row[0], 16)
        if int(row[3]) != ccc[cp]:
            for index, sequence in enumerate([[0x61, cp, 0x0323], [0x61, 0x0323, cp], [0x61, cp, 0x0301], [0x61, 0x0301, cp]]):
                add(f'normalization:ccc:{cp:06x}:{index}', sequence)
                add(f'normalization:ccc-global:{cp:06x}:{index}', [0xE9, 0x323, 0x2E] + sequence)
    # All L/V combinations at both trailing boundaries, plus existing syllables
    # followed by Jamo. These are separately observed URL compatibility cases.
    for leading in range(0x1100, 0x1113):
        for vowel in range(0x1161, 0x1176):
            syllable = 0xAC00 + ((leading - 0x1100) * 21 + vowel - 0x1161) * 28
            for index, sequence in enumerate([[leading, vowel], [leading, vowel, 0x11A8], [leading, vowel, 0x11C2], [syllable, 0x11A8], [syllable + 1, 0x11A8]]):
                add(f'normalization:hangul:{leading:04x}:{vowel:04x}:{index}', sequence)
                add(f'normalization:hangul-slow:{leading:04x}:{vowel:04x}:{index}', sequence + [0x2E, 0x61, 0x301])
                add(f'normalization:hangul-global:{leading:04x}:{vowel:04x}:{index}', [0xE9, 0x323, 0x2E] + sequence)
    if len({row['id'] for row in rows}) != len(rows):
        raise ValueError('Duplicate normalization discriminant ID')
    return rows
