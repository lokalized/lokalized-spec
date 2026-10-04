"""Input-derived Swift manifest adaptations; compiler refusal is not JS replay."""
import hashlib
import json
from . import archive, native_report

PROFILE_ID = 'swift-native-manifest-v1'
PROFILE_VERSION = '1.0.0'
RUNTIME_IDS = sorted([
    'identity-default-format-version', 'identity-optional-empty-maps',
    'identity-malformed-digest-runtime-refusal', 'manifest-raw-null-runtime-refusal',
    'manifest-semantic-null-runtime-refusal', 'manifest-escaped-high-surrogate-refusal',
    'manifest-escaped-low-surrogate-refusal', 'unicode-decoder-high-repairs',
    'unicode-decoder-low-repairs', 'identity-valid-replacement-character-keys',
    'identity-valid-supplementary-text', 'manifest-options-accepted',
    'manifest-limit-runtime-refusal', 'manifest-planning-empty-string-runtime-refusal',
    'manifest-planning-chain', 'manifest-planning-fetch-set',
])
RULE_IDS = sorted([
    'native-configuration-error-envelope', 'typed-identity-configuration-error-taxonomy',
    'typed-loading-options-validation-error-taxonomy', 'native-planning-locale-error-taxonomy',
    'native-strings-parse-error-envelope', 'manifest-preparser-source-error-taxonomy',
    'native-json-reader-cause-projection',
])
LIMITS = [
    'The 468 runtime observations retain full native and reference receipts; only the named narrow error projections are permitted.',
    'Thirty compiler refusals and one accepted default qualify native API boundaries, not original JS error timing, text or returned values.',
    'Swift String decoding repairs lone UTF-16 surrogates; replacement text is not the authored JS input. Raw manifest JSON still refuses unpaired escapes.',
    'The historical raw report retains 31 pending carriers and nativeMappingsRatified=false. This separate contract adds no runtime passes.',
    'Manifest normalization and wire-name corrections require coordinated versioned shared changes; this profile preserves the frozen observations.',
    'Coverage here does not certify minimum compiler, minimum OS, iOS, Intel, hosted CI or overall release parity.',
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    # Profile data is ASCII; its member ordering is also RFC 8785 ordering.
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def read(path, maximum=8*1024*1024):
    with path.open('rb') as stream:
        data = stream.read(maximum+1)
    require(len(data) <= maximum, 'Artifact exceeds byte bound: ' + str(path))
    return native_report.read_json(data)


def quote(value):
    out = '"'
    for char in value:
        code = ord(char)
        if char in ['"', '\\']:
            out += '\\' + char
        elif code < 32 or 0xD800 <= code <= 0xDFFF:
            out += '\\u{' + format(code, 'X') + '}'
        else:
            out += char
    return out + '"'


def literal(value):
    if value is None: return 'nil'
    if type(value) is bool: return str(value).lower()
    if type(value) is str: return quote(value)
    if type(value) in [int, float]: return repr(value)
    if type(value) is list: return '[' + ', '.join(literal(v) for v in value) + ']'
    require(type(value) is dict, 'Unknown Swift literal carrier')
    if not value: return '[:]'
    return '[' + ', '.join('ExactString(' + quote(k) + '): ' + literal(v) for k,v in value.items()) + ']'


def consumer_for(row):
    """Derive an external source consumer from input alone, before expected results."""
    pending = native_report.pending_input(row)
    require(pending is not None, 'A representable runtime case cannot be mapped')
    category, rationale = pending
    args = row['input']
    kind, expectation, diagnostic, token = 'native-source-boundary', 'refused', 'type', ''
    if category in ['typed-options-no-dynamic-members', 'typed-limits-no-dynamic-members']:
        options = json.loads(args['optionsJSON'])
        if category == 'typed-limits-no-dynamic-members':
            unknown = sorted(set(options['limits']) - native_report.LIMITS)
            require(len(unknown) == 1, 'Ambiguous unknown budget adaptation')
            token = unknown[0]
            body = 'let value = try LocalizedStringLoadingOptions(maximumInputBytes: LocalizedStringLoadingOptions.defaultMaximumInputBytes, ' + token + ': ' + literal(options['limits'][token]) + ')'
        else:
            allowed = {'limits', 'source'} if row['operation'] == 'parseStringsManifest' else {'limits'}
            unknown = sorted(set(options) - allowed)
            require(len(unknown) == 1, 'Ambiguous unknown option adaptation')
            token = unknown[0]
            value = '[:]' if isinstance(options[token], dict) else literal(options[token])
            subject = '"{}"' if row['operation'] == 'parseStringsManifest' else 'StringsManifestValue.null'
            body = 'let value = try LocalizedStringLoader.' + row['operation'] + '(' + subject + ', ' + token + ': ' + value + ')'
        diagnostic = 'argument'
        controls = ['manifest-options-accepted', 'manifest-limit-runtime-refusal']
    elif category == 'typed-lookup-string':
        body = 'func consume(_ manifest: StringsManifestV1) throws { _ = try LocalizedStringLoader.' + row['operation'] + '(manifest, lookupLocale: nil) }'
        token = 'String'
        controls = ['manifest-planning-chain', 'manifest-planning-fetch-set', 'manifest-planning-empty-string-runtime-refusal']
    else:
        subject = json.loads(args['identityInputJSON'])
        controls = ['identity-optional-empty-maps', 'identity-malformed-digest-runtime-refusal']
        if category == 'typed-identity-object':
            value = '[String]()' if isinstance(subject, list) else literal(subject)
            body = 'let value = try LocalizedStringLoader.computeCatalogIdentity(' + value + ')'
            token = 'CatalogIdentityInputV1'
        else:
            parts = [name + ': ' + literal(subject[name]) for name in ['formatVersion', 'catalogVersion', 'resolvedFallbackLocale', 'localeToSha256', 'tiebreakerLocalesByLanguageCode'] if name in subject]
            if category == 'typed-identity-extra-members':
                token = 'unrecognized'
                parts.append('unrecognized: ["ignored": true]')
                diagnostic = 'argument'
            elif category == 'native-valid-unicode-string-carrier':
                token = 'unicode scalar'
                diagnostic = 'unicode'
                kind = 'native-unicode-carrier'
                controls = ['manifest-escaped-high-surrogate-refusal', 'manifest-escaped-low-surrogate-refusal',
                    'unicode-decoder-high-repairs', 'unicode-decoder-low-repairs',
                    'identity-valid-replacement-character-keys', 'identity-valid-supplementary-text']
            elif category == 'typed-identity-required-fields':
                missing = [name for name in ['formatVersion', 'catalogVersion', 'resolvedFallbackLocale'] if name not in subject]
                if missing == ['formatVersion']:
                    kind, expectation, diagnostic, token = 'native-default-format-version', 'accepted', 'none', ''
                    rationale = 'Swift CatalogIdentityInputV1 defaults an omitted formatVersion to 1; JS requires an explicit member. The native accepted default is not the original JS refusal.'
                    controls = ['identity-default-format-version']
                elif missing:
                    require(len(missing) == 1, 'Ambiguous missing identity field')
                    token, diagnostic = missing[0], 'missing'
                else:
                    token = 'Int' if type(subject['formatVersion']) is not int else 'String'
            else:
                token = 'String'
            body = 'let input = CatalogIdentityInputV1(' + ', '.join(parts) + ')\nlet value = try LocalizedStringLoader.computeCatalogIdentity(input)'
    source = 'import Lokalized\n' + body + '\n'
    return {'category': category, 'kind': kind, 'rationale': rationale,
        'source': source, 'sourceSHA256': sha(source.encode()), 'expectation': expectation,
        'diagnosticFamily': diagnostic, 'diagnosticToken': token,
        'adjacentRuntimeControls': sorted(controls)}


def channels(value, prefix=''):
    if type(value) is dict and value:
        return sorted(path for key, item in value.items() for path in channels(item, prefix + ('.' if prefix else '') + key))
    # An array is one retained observation channel; every authored element is in
    # its reference digest and the immutable archive, not a discarded trace.
    return [prefix]


def profile_for(cases):
    require(len(cases) == 499 and native_report.ids_sha([r['id'] for r in cases]) == native_report.ALL_SHA, 'Manifest case inventory differs')
    records, runtime = [], []
    for row in cases:
        pending = native_report.pending_input(row)
        if pending is None:
            runtime.append(row['id'])
            continue
        consumer = consumer_for(row)
        records.append({'id': row['id'], 'operation': row['operation'],
            'inputSHA256': sha(canonical({'operation': row['operation'], 'input': row['input']})),
            'referenceObservationSHA256': sha(canonical(row['expected'])),
            'notReplayedObservationChannels': channels(row['expected']), **consumer})
    require(len(records) == 31 and native_report.ids_sha([r['id'] for r in records]) == native_report.PENDING_SHA, 'Native adaptation inventory differs')
    return {'formatVersion': 1, 'profileID': PROFILE_ID, 'profileVersion': PROFILE_VERSION,
        'scope': 'swift-native-manifest-validation-identity-planning',
        'vectorsSHA256': archive.VECTORS_SHA, 'lockSHA256': archive.LOCK_SHA,
        'runtimeIDs': runtime, 'runtimeIDsSHA256': native_report.ELIGIBLE_SHA,
        'nativeAdaptations': records, 'nativeAdaptationIDsSHA256': native_report.PENDING_SHA,
        'runtimeProjectionRules': RULE_IDS, 'runtimeControls': RUNTIME_IDS, 'limits': LIMITS}


def check_profile(profile, cases):
    require(canonical(profile) == canonical(profile_for(cases)), 'Shared manifest native profile differs from pinned input-derived policy')
    return profile


def coverage(profile, cases, raw):
    """Caller must validate source-bound current compiler/runtime evidence first."""
    check_profile(profile, cases)
    require(raw['runtimePassed'] == profile['runtimeIDs'] and raw['failed'] == [], 'Raw manifest runtime inventory differs')
    ids = [r['id'] for r in profile['nativeAdaptations']]
    require([r['id'] for r in raw['pendingCarriers']] == ids, 'Raw pending inventory differs')
    return {'profileID': PROFILE_ID, 'profileVersion': PROFILE_VERSION,
        'status': 'covered-under-native-contracts-not-certified', 'releaseParity': False,
        'runtimePassed': raw['runtimePassed'], 'strictNativeEqualIDs': raw['strictNativeEqualIDs'],
        'projectedMatchedIDs': raw['projectedMatchedIDs'], 'nativeRepresentationMapped': ids,
        'failed': [], 'unimplemented': [],
        'rawReportPendingIDs': ids, 'runtimePassedAdded': [],
        'unreplayedChannelsByID': {r['id']: r['notReplayedObservationChannels'] for r in profile['nativeAdaptations']},
        'limits': LIMITS}
