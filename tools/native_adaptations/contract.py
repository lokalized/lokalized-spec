"""Versioned Swift native boundary decisions, independent of port execution.

The frozen Java observations are obligations, never replacement native inputs.
Ports must validate their own compiler/runtime evidence before calling coverage.
"""
from collections import Counter
import hashlib
import json

CORPUS_SHA256 = '1eb74caf8524c0a3b33dca99addb268c86b64eb8321fac03257474ddaa3c9753'
PROFILE_ID = 'swift-native-local-v1'
TYPE_IDS_SHA256 = 'e19eacaf8f0773df2bdb0ca83e38a025fa8b964f20f2dfc188ec05e5fd83dd79'
FILENAME_IDS_SHA256 = 'f2e4b155d9ff9f7a77acf00a53fcead51f8482fce9e47230466543a51f779131'
UNMAPPED_ID = 'phonetic-resolver.constants.unmapped-term-returns-null'
FILENAME_CASES = {
    'classpath-filenames.warn.two-invalid-json-filesystem': 'native-competing-invalid-json-filenames',
    'loading-limits.files.manifest-of-257-exceeds-the-default': 'native-aggregate-file-cap-diagnostic-order',
    'loading-limits.files.one-rejects-a-second-file': 'native-aggregate-file-cap-diagnostic-order',
    'manifest-loads.load.file-limit-exceeded-aborts-whole-load': 'native-aggregate-file-cap-diagnostic-order',
    'manifest-loads.load.two-filename-spellings-of-one-locale-collide': 'native-extensionless-json-alias-diagnostic-order',
}
LIMITS = [
    'Native type boundaries qualify source rejection and adjacent representable behavior, not the original null diagnostics or callback traces.',
    'Filename adaptations compare complete observations, allowing only the filename selected by the declared native ordering rule.',
    'Informational JVM carriers are outside this native profile; their observations are not runtime-replayed or counted as native mappings.',
    'Coverage under declared native contracts does not certify release parity, minimum compiler, other-platform or minimum-OS runtime, or hosted CI execution.',
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def id_digest(ids):
    return sha(''.join(i + '\n' for i in sorted(ids)).encode())


def unique(items):
    result = {}
    for key, value in items:
        require(key not in result, 'Duplicate JSON member: ' + key)
        result[key] = value
    return result


def read(path, maximum_bytes=8 * 1024 * 1024):
    require(path.stat().st_size <= maximum_bytes, 'Artifact exceeds byte limit: ' + str(path))
    def nonfinite(value):
        raise ValueError('Nonfinite JSON number: ' + value)
    return json.loads(path.read_bytes(), object_pairs_hook=unique, parse_constant=nonfinite)


def read_corpus(path):
    corpus = read(path)
    require(sha(path.read_bytes()) == CORPUS_SHA256, 'Frozen behavioral corpus bytes changed')
    return corpus


def guards_for(row, fixture):
    guards = []
    def add(category, path):
        guards.append({'category': category, 'inputPath': path})
    if row['input'].get('nullPlaceholderName') is True:
        add('placeholder-name-null', 'input.nullPlaceholderName')
    overrides = fixture.get('constructionOverrides') or {}
    if overrides.get('catalogSource') in ['returnsNull', 'nullCatalogValue', 'nullLocaleKey', 'nullEntry']:
        add('catalog-null-shape', 'fixture.constructionOverrides.catalogSource')
    if overrides.get('tiebreakerSource') in ['nullList', 'nullEntry', 'nullLanguageCode']:
        add('tiebreaker-null-shape', 'fixture.constructionOverrides.tiebreakerSource')
    for label, source in [('fixture', fixture), ('input', row['input'])]:
        for name in ['translationFailureHandler', 'translationFallbackPolicy', 'phoneticResolver']:
            value = source.get(name)
            if isinstance(value, dict) and value.get('behavior') == 'return-null':
                add('callback-null-configuration', f'{label}.{name}.behavior')
    if row['id'] == UNMAPPED_ID:
        resolver = fixture['phoneticResolver']
        term = row['input']['placeholders']['term']
        require(resolver['behavior'] == 'by-term' and resolver.get('default') is None
                and term not in resolver['mapping'], 'Unmapped native resolver guard changed')
        add('phonetic-unmapped-null-return', 'fixture.phoneticResolver.mapping/default')
    return sorted(guards, key=lambda g: (g['category'], g['inputPath']))


def type_evidence(guards, fixture):
    negatives, controls = set(), set()
    for guard in guards:
        category, path = guard['category'], guard['inputPath']
        if category == 'callback-null-configuration':
            if 'translationFailureHandler' in path:
                negatives.add('failure-handler-nil')
                controls.update(['handler-unconsulted-on-success', 'handler-after-complete-walk'])
            elif 'translationFallbackPolicy' in path:
                negatives.add('fallback-policy-nil')
                controls.update(['policy-unconsulted-on-single-candidate', 'policy-before-handler-get', 'policy-before-handler-getResult',
                    'policy-error-get', 'policy-error-getResult', 'policy-error-preserves-consultation-cause', 'policy-receives-current-resolution-cause'])
            elif 'phoneticResolver' in path:
                negatives.add('phonetic-resolver-nil')
                controls.update(['expression-resolver-error-retains-cause', 'handler-retains-first-same-type-cause',
                    'result-retains-first-same-type-cause', 'get-rethrows-first-cause-verbatim', 'other-is-valid-phonetic-category'])
            else:
                raise ValueError('Unknown callback guard')
        elif category == 'catalog-null-shape':
            negatives.update({'returnsNull': ['catalog-supplier-nil'], 'nullCatalogValue': ['catalog-value-nil'],
                'nullLocaleKey': ['catalog-key-nil'], 'nullEntry': ['catalog-entry-nil', 'catalog-entry-value-nil']}[fixture['constructionOverrides']['catalogSource']])
            controls.update(['raw-null-catalog-refused', 'raw-null-entry-refused'])
        elif category == 'tiebreaker-null-shape':
            negatives.add({'nullList': 'tiebreaker-list-nil', 'nullEntry': 'tiebreaker-entry-nil',
                'nullLanguageCode': 'tiebreaker-key-nil'}[fixture['constructionOverrides']['tiebreakerSource']])
            controls.add('nil-whole-tiebreaker-setting-is-valid')
        elif category == 'placeholder-name-null':
            negatives.add('placeholder-key-nil')
            controls.update(['explicit-null-remains-runtime-refusal', 'missing-binding-remains-runtime-refusal', 'raw-null-placeholder-definition-refused'])
        elif category == 'phonetic-unmapped-null-return':
            negatives.add('phonetic-resolver-nil')
            controls.update(['unmapped-resolver-can-throw-explicitly', 'other-is-valid-phonetic-category'])
        else:
            raise ValueError('Unknown native type boundary')
    return {'negativeConsumers': sorted(negatives), 'adjacentRuntimeControls': sorted(controls)}


def filename_rule(row, fixture):
    require(row['operation'] == 'load' and row['partition'] == 'informationalIds' and row['input'] == {}
            and fixture['pathShape'] == 'directory', 'Filename adaptation input changed')
    names = sorted(set(fixture['files']) | set(fixture['rawFiles']) | set(fixture['rawFilesBase64']), key=lambda s: s.encode('utf8'))
    category = FILENAME_CASES[row['id']]
    root = '<fixtures>/' + row['fixture'] + '/'
    cap = (fixture['loadingOptions'] or {}).get('maximumLocalizedStringsFiles', 256)
    if category == 'native-competing-invalid-json-filenames':
        candidates = sorted(fixture['rawFiles'], key=lambda s: s.encode('utf8'))
        require(candidates == ['notes.json', 'zz.json'], 'Invalid-filename boundary changed')
        selected = candidates[0]
        template = "File '{filename}' ends with .json but is not named with a valid IETF BCP 47 language tag. Use names like 'en', 'en.json', or 'en-US.json'"
        controls = ['directory-invalid-filename-byte-order', 'discovery-overflow-before-selected-file-fault']
    elif category == 'native-aggregate-file-cap-diagnostic-order':
        require(not fixture['rawFiles'] and not fixture['rawFilesBase64'] and type(cap) is int and 0 < cap < len(names), 'File-cap boundary changed')
        candidates, selected = names, names[cap]
        template = root + '{filename}: localized strings load exceeds the aggregate localized strings file limit of ' + str(cap)
        controls = ['directory-file-cap-byte-order', 'mapping-file-cap-before-validation-and-io']
    else:
        require(names == ['en', 'en.json'], 'Filename-alias boundary changed')
        candidates, selected = names, names[1]
        template = "Duplicate localized strings file for locale 'en' found at '" + root + "{filename}'"
        controls = ['directory-extensionless-before-json', 'discovery-overflow-before-selected-file-fault']
    donor = [name for name in candidates if template.format(filename=name) == row['expected']['load']['failureMessage']]
    require(len(donor) == 1 and donor[0] != selected, 'Reference attribution no longer fits the narrow filename rule')
    return {'category': category, 'nativeFilename': selected, 'referenceFilename': donor[0], 'messageTemplate': template,
        'authoredCandidatesInByteOrder': candidates, 'maximumLocalizedStringsFiles': cap,
        'equalChannels': ['locales', 'keysByLocale', 'failed', 'failureType', 'warnings'],
        'differentChannels': ['failureMessage.filename'], 'nativeControls': sorted(controls)}


def carrier_rule(operation):
    controls = ['explicit-bundle-context', 'canonical-origins-and-exact-keys']
    if operation == 'loadClasspath':
        controls += ['bundle-missing-exact-directory', 'bundle-empty-directory', 'bundle-file-not-directory', 'bundle-literal-path-validation',
            'bundle-has-no-jvm-reserved-namespace', 'bundle-discovery-nonrecursive', 'directory-invalid-filename-byte-order']
        return {'category': 'jvm-classpath-discovery', 'nativeAPI': 'loadFromBundle(directory:)', 'nativeControls': sorted(controls)}
    controls += ['explicit-mapping-bypasses-filename-rules', 'explicit-lproj-remains-literal', 'mapping-repeated-resource-charges-bytes',
        'mapping-no-discovery-charge', 'mapping-file-cap-before-validation-and-io', 'mapping-directory-refused',
        'mapping-rendered-collision-before-io', 'warning-error-identity-and-reentry']
    return {'category': 'jvm-classpath-resource-resolution', 'nativeAPI': 'loadFromResources / loadFromBundle(resourcePathsByLocale:)', 'nativeControls': sorted(controls)}


def profile_for(corpus):
    records = []
    require(len(corpus['cases']) == 2381 and len({r['id'] for r in corpus['cases']}) == 2381, 'Corpus ID inventory changed')
    for row in sorted(corpus['cases'], key=lambda r: r['id']):
        fixture = corpus['fixtures'][row['fixture']]
        guards = guards_for(row, fixture) if row['operation'] in ['construct', 'get', 'getResult'] else []
        record = {'id': row['id'], 'operation': row['operation'], 'partition': row['partition'], 'fixtureID': row['fixture'],
            'inputSHA256': sha(canonical({'operation': row['operation'], 'input': row['input'], 'fixture': fixture})),
            'referenceObservationSHA256': sha(canonical(row['expected']))}
        if guards:
            require(row['partition'] == 'requiredPortableIds', 'Native type partition changed')
            record.update(kind='nonoptional-api-boundary', guards=guards, requiredEvidence=type_evidence(guards, fixture),
                          notReplayedObservationChannels=sorted(row['expected']))
        elif row['id'] in FILENAME_CASES:
            record.update(kind='native-filename-attribution', filenameRule=filename_rule(row, fixture), notReplayedObservationChannels=[])
        elif row['operation'] in ['loadClasspath', 'loadClasspathResources']:
            require(row['partition'] == 'informationalIds', 'Required JVM carrier cannot be excluded')
            record.update(kind='informational-jvm-carrier', carrierRule=carrier_rule(row['operation']),
                          notReplayedObservationChannels=['load.' + key for key in sorted(row['expected']['load'])])
        else:
            continue
        records.append(record)
    kinds = Counter(r['kind'] for r in records)
    require(kinds == {'nonoptional-api-boundary': 20, 'native-filename-attribution': 5, 'informational-jvm-carrier': 159}, 'Native contract inventory changed')
    for kind, expected in [('nonoptional-api-boundary', TYPE_IDS_SHA256), ('native-filename-attribution', FILENAME_IDS_SHA256)]:
        require(id_digest([r['id'] for r in records if r['kind'] == kind]) == expected, 'Native contract ID set changed')
    return {'formatVersion': 1, 'policyVersion': '1.0.0', 'profileID': PROFILE_ID, 'implementationFamily': 'swift',
        'corpusSHA256': CORPUS_SHA256, 'originalObservationsModified': False, 'records': records, 'limits': LIMITS}


def check_profile(profile, corpus):
    require(canonical(profile) == canonical(profile_for(corpus)), 'Native contract is altered, incomplete or stale')


def coverage(profile, corpus, audit, native_types, loaders):
    """Account for validated port evidence. Compiler/source checks belong to the port."""
    check_profile(profile, corpus)
    rows = {r['id']: r for r in corpus['cases']}
    records = {r['id']: r for r in profile['records']}
    typed = {r['id']: r for r in native_types['cases']}
    loaded = {r['id']: r for r in loaders['records']}
    require(len(typed) == len(native_types['cases']) == 20 and len(loaded) == len(loaders['records']) == 164, 'Missing/duplicate port evidence cases')
    require(set(typed) | set(loaded) == set(records) and not set(typed) & set(loaded), 'Port evidence inventory differs from contract')
    require(audit['status'] == 'incomplete' and audit['failed'] == audit['failures'] == audit['nativeRepresentationMapped'] == [], 'Original audit failed or changed meaning')
    passed = audit['runtimePassed']
    require(len(passed) == len(set(passed)) == 2197 and set(passed) == set(rows) - set(records)
            and set(audit['unimplemented']) == set(records) and len(audit['unimplemented']) == 184, 'Original exact runtime agreement set changed')
    evidence = []
    for identifier, record in records.items():
        proof = typed.get(identifier, loaded.get(identifier))
        require(proof['operation'] == record['operation'] and proof['partition'] == record['partition'], 'Evidence operation/partition changed')
        require(proof.get('inputSHA256', proof.get('inputSha256')) == record['inputSHA256']
                and proof.get('referenceObservationSHA256', proof.get('referenceObservationSha256')) == record['referenceObservationSHA256'], 'Evidence input/reference changed')
        require(proof['notReplayedObservationChannels'] == record['notReplayedObservationChannels'], 'Unreplayed observation channels changed')
        if record['kind'] == 'nonoptional-api-boundary':
            require(sorted([{'category': g['category'], 'inputPath': g['inputPath']} for g in proof['guards']],
                           key=lambda g: (g['category'], g['inputPath'])) == record['guards'], 'Native guard changed')
            require({key: proof[key] for key in record['requiredEvidence']} == record['requiredEvidence'], 'Native compiler/runtime controls changed')
        elif record['kind'] == 'informational-jvm-carrier':
            require({key: proof[key] for key in record['carrierRule']} == record['carrierRule'], 'Native carrier evidence changed')
        else:
            rule = record['filenameRule']; actual = proof['filenameEvidence']
            require(actual['nativeFilename'] == rule['nativeFilename'] and actual['referenceFilename'] == rule['referenceFilename']
                    and actual['authoredCandidatesInByteOrder'] == rule['authoredCandidatesInByteOrder']
                    and actual['equalChannels'] == rule['equalChannels'] and actual['differentChannels'] == rule['differentChannels']
                    and sorted(actual['nativeControls']) == rule['nativeControls'], 'Native filename attribution changed')
            native, donor = actual['nativeObservation']['load'], actual['referenceObservation']['load']
            require(actual['referenceObservation'] == rows[identifier]['expected'] and set(native) == set(donor), 'Filename reference/channels changed')
            require(all(native[k] == donor[k] for k in rule['equalChannels']) and native['failed'] is True, 'Filename adaptation changed another channel')
            require(native['failureMessage'] == rule['messageTemplate'].format(filename=rule['nativeFilename']), 'Filename adaptation permits an unrelated diagnostic')
        evidence.append({'id': identifier, 'kind': record['kind'], 'inputSHA256': record['inputSHA256'],
            'referenceObservationSHA256': record['referenceObservationSHA256'],
            'notReplayedObservationChannels': record['notReplayedObservationChannels'], 'portRecordSHA256': sha(canonical(proof))})
    def select(kind, partition):
        return sorted(r['id'] for r in records.values() if r['kind'] == kind and r['partition'] == partition)
    sets = {'requiredPortableRuntimePassed': sorted(i for i in passed if rows[i]['partition'] == 'requiredPortableIds'),
        'requiredPortableNativeAdaptations': select('nonoptional-api-boundary', 'requiredPortableIds'),
        'informationalRuntimePassed': sorted(i for i in passed if rows[i]['partition'] == 'informationalIds'),
        'informationalNativeAdaptations': select('native-filename-attribution', 'informationalIds'),
        'informationalPlatformSpecific': select('informational-jvm-carrier', 'informationalIds')}
    accounted = [i for values in sets.values() for i in values]
    require(len(accounted) == len(set(accounted)) == len(rows) and set(accounted) == set(rows), 'Coverage sets overlap or omit cases')
    require(sum(len(v) for k, v in sets.items() if k.startswith('requiredPortable')) == 2155, 'Required portable coverage is incomplete')
    return {'formatVersion': 1, 'scope': 'native-contract-coverage', 'status': 'covered-under-native-contracts', 'profileID': PROFILE_ID,
        'policyVersion': profile['policyVersion'], 'profileSHA256': sha(canonical(profile)), 'corpusSHA256': CORPUS_SHA256,
        'releaseParity': False, 'originalRuntimePassedAdded': [], 'strictRuntimeAgreement': len(passed),
        'requiredPortableCovered': 2155, 'nativeAdaptationsQualified': 25, 'informationalPlatformSpecific': 159,
        'caseIDSets': sets, 'caseIDSetSHA256': {key: id_digest(value) for key, value in sets.items()},
        'unaccountedRequiredPortableIDs': [], 'failed': [], 'records': evidence, 'limits': LIMITS}
