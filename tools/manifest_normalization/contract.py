"""Independent manifest-normalization recipe and identity bytes. Stdlib only."""
import base64
import copy
import hashlib
import json

PROFILE_ID='manifest-normalization-v1.1'
VERSION='1.1.0'
ARCHIVE_SHA='6356098bbde353a66886e9552c45efe7ec6353697cf26be2141d3e9f4811d50a'
CORRECTED_IDS=['m7a.parse.fallback.upper-und-private-use','m7a.plan.upper-und-private-use.chain',
    'm7a.projection.upper-und-private-use','m7a.validate.fallback.upper-und-private-use']
# Authored expected projections, independent of runtime locale libraries.
TAGS=[('UND-x-foo','x-foo','und-x-foo'),('Und-X-FOO','x-foo','und-x-foo'),
    ('und-x-foo','x-foo','x-foo'),('x-foo','x-foo','x-foo'),
    ('zh-und-x-foo','x-foo','und-x-foo'),('zh-UND-X-FOO','x-foo','und-x-foo'),
    ('UND-x-a-b','x-a-b','und-x-a-b'),('UND-Latn-x-foo','und-Latn-x-foo','und-Latn-x-foo'),
    ('UND-US-x-foo','und-US-x-foo','und-US-x-foo'),('UND-1901-x-foo','und-1901-x-foo','und-1901-x-foo'),
    ('UND-u-ca-gregory-x-foo','und-u-ca-gregory-x-foo','und-u-ca-gregory-x-foo'),
    ('x-lvariant-FOO','x-lvariant-FOO','x-lvariant-FOO'),('x-lvariant-1901','und-1901','und-1901'),
    ('UND-x-FOO-lvariant-ABC','x-foo-lvariant-ABC','und-x-foo-lvariant-ABC'),
    ('EN-us','en-US','en-US'),('iw','he','he'),('i-klingon','tlh','tlh'),
    ('en-x-FOO','en-x-foo','en-x-foo'),('en-u-ca-gregory-x-foo','en-u-ca-gregory-x-foo','en-u-ca-gregory-x-foo'),
    ('zz-X-FOO','zz-x-foo','zz-x-foo')]
PUBLIC=[('upper','UND-x-foo','x-foo'),('mixed','Und-X-FOO','x-foo'),('lower','und-x-foo','x-foo'),
    ('canonical','x-foo','x-foo'),('script-control','UND-Latn-x-foo','und-Latn-x-foo'),
    ('region-control','UND-US-x-foo','und-US-x-foo'),('variant-control','UND-1901-x-foo','und-1901-x-foo'),
    ('extension-control','UND-u-ca-gregory-x-foo','und-u-ca-gregory-x-foo'),
    ('lifted-variant-control','x-lvariant-1901','und-1901'),('case-control','EN-us','en-US'),
    ('legacy-alias-control','iw','he'),('language-private-control','en-x-FOO','en-x-foo')]


def sha(data): return hashlib.sha256(data).hexdigest()

def canonical(value):
    if value is None: return 'null'
    if type(value) is bool: return 'true' if value else 'false'
    if type(value) is int: return str(value)
    if type(value) is str: return json.dumps(value,ensure_ascii=False,separators=(',',':'))
    if type(value) is list: return '['+','.join(map(canonical,value))+']'
    if type(value) is dict:
        return '{'+','.join(canonical(k)+':'+canonical(value[k]) for k in sorted(value,key=lambda k:k.encode('utf-16-be')))+'}'
    raise ValueError('Outside bounded identity profile')

def bytes_for(value): return canonical(value).encode('utf-8')

def identity(manifest, resolved=None):
    return {'formatVersion':1,'catalogVersion':manifest['catalogVersion'],
        'resolvedFallbackLocale':resolved or manifest['fallbackLocale'],
        'localeToSha256':{k:f['sha256'] for k,f in manifest['files'].items()},
        'tiebreakerLocalesByLanguageCode':manifest['tiebreakerLocalesByLanguageCode']}

def identity_observation(value, with_input=False):
    data=bytes_for(value); digest=sha(data)
    out={'identity':{'catalogVersion':value['catalogVersion'],'catalogFingerprint':digest},
        'projection':value,'canonicalBytesBase64':base64.b64encode(data).decode(),'byteCount':len(data),'sha256':digest}
    if with_input: out['input']=value
    return out

def refusal(message): return {'outcome':'threw','error':{'name':'ConfigurationError','code':'CONFIGURATION','message':message}}

def archive(raw):
    if sha(raw)!=ARCHIVE_SHA: raise ValueError('Historical manifest archive bytes differ')
    return json.loads(raw)

def corrections(value):
    by_id={r['id']:r for r in value['cases']}; result=[]
    for id in CORRECTED_IDS:
        row=by_id[id]; raw=row['input']
        if 'manifestJSON' in raw: manifest=json.loads(raw['manifestJSON'])
        else: manifest=json.loads(base64.b64decode(raw['documentBase64']))
        projected=identity(manifest,'x-foo')
        if row['operation']=='identityForManifest': expected={'outcome':'returned','value':identity_observation(projected,True)}
        else:
            normalized=copy.deepcopy(manifest); normalized['fallbackLocale']='x-foo'
            normalized['files']={'x-foo':next(iter(manifest['files'].values()))}
            computed=sha(bytes_for(identity(normalized)))
            expected=refusal("A manifest's declared catalogFingerprint does not match its contents: declared "+manifest['catalogFingerprint']+', computed '+computed)
        result.append({'id':id,'operation':row['operation'],'input':row['input'],'historicalExpected':row['expected'],
            'historicalExpectedSHA256':sha(bytes_for(row['expected'])),'expected':expected})
    return result

def artifact(raw):
    original=archive(raw); cases=[]
    for index,(tag,projected,core) in enumerate(TAGS):
        cases.append({'id':f'm8k.normalize.{index:02d}','operation':'normalize','input':{'tag':tag},
            'expected':{'outcome':'returned','value':{'normalized':projected,'repeated':projected,'coreProjection':core}}})
    for label,tag,projected in PUBLIC:
        normalized={'formatVersion':1,'catalogVersion':PROFILE_ID,'catalogFingerprint':'0'*64,**original['buildIdentity'],
            'fallbackLocale':projected,'baseUrl':'https://cdn.example/v1/','files':{projected:{'url':'catalog.json','sha256':'a'*64,'decodedBytes':12}},
            'tiebreakerLocalesByLanguageCode':{}}
        normalized['catalogFingerprint']=sha(bytes_for(identity(normalized)))
        authored=copy.deepcopy(normalized); authored['fallbackLocale']=tag; authored['files']={tag:next(iter(normalized['files'].values()))}
        entry={'locale':projected,'url':'https://cdn.example/v1/catalog.json','sha256':'a'*64,'expectedDecodedBytes':12}
        config={'fallbackLocale':projected,'supportedLocales':[projected],'tiebreakerLocalesByLanguageCode':{}}
        observation={'validated':normalized,'parsedText':normalized,'parsedBytes':normalized,'revalidated':normalized,
            'configuration':config,'identity':identity_observation(identity(normalized),True),
            'chain':['de',projected],'fetchSet':[entry],'wholePlan':[entry],'lookupAuthored':[entry],'lookupCanonical':[entry]}
        cases.append({'id':'m8k.round-trip.'+label,'operation':'roundTrip','input':{'manifestJSON':canonical(authored),'lookupLocale':tag},
            'expected':{'outcome':'returned','value':observation}})
    base=json.loads(next(r for r in cases if r['id']=='m8k.round-trip.upper')['input']['manifestJSON'])
    collision=copy.deepcopy(base); collision['files']['x-foo']=False
    for operation in ['validateStringsManifest','parseStringsManifest']:
        cases.append({'id':'m8k.collision.'+operation,'operation':operation,'input':{'manifestJSON':canonical(collision)},
            'expected':refusal("A manifest declares two file keys that normalize to 'x-foo'")})
    # An extlang UND can be a legal lookup without becoming a pinned-known file key.
    unknown=copy.deepcopy(base); unknown['fallbackLocale']='zh-und-x-foo'
    cases.append({'id':'m8k.unknown-file-locale','operation':'validateStringsManifest','input':{'manifestJSON':canonical(unknown)},
        'expected':refusal("A manifest's fallbackLocale is 'zh-und-x-foo', which is not a valid pinned-data-known locale tag")})
    return {'formatVersion':1,'profileID':PROFILE_ID,'profileVersion':VERSION,'wireFormatVersion':1,
        'archiveSHA256':ARCHIVE_SHA,'rule':'After strict JDK projection, remove a leading und- only when the serialized tag begins und-x-. Core locale projection and arbitrary identity property names retain their contracts.',
        'archiveCorrections':corrections(original),'cases':sorted(cases,key=lambda r:r['id'])}

def check(path, archive_path):
    expected=bytes_for(artifact(archive_path.read_bytes()))
    if path.read_bytes()!=expected: raise ValueError('Manifest normalization profile differs from independent recipe')
    value=json.loads(expected)
    return {'status':'passed','profileID':PROFILE_ID,'profileVersion':VERSION,'artifactSHA256':sha(expected),
        'cases':len(value['cases']),'archiveCorrections':CORRECTED_IDS}
