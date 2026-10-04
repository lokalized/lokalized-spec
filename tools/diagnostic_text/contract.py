"""Language-neutral bounded diagnostic text profile 1.1.0. Python stdlib only."""
import hashlib
import json
from pathlib import Path

PROFILE_ID = 'diagnostic-text-v1.1'
PROFILE_VERSION = '1.1.0'
SOURCE = 'diagnostic-profile.json'


def bounded(value, maximum):
    # Independent scalar-based implementation of the UTF-16 prefix rule.
    total = len(value.encode('utf-16-le')) // 2
    if total <= maximum: return value
    result, used = '', 0
    for scalar in value:
        width = len(scalar.encode('utf-16-le')) // 2
        if used + width > maximum - 1:
            if width == 2 and used == maximum - 2: result += '\ufffd'
            break
        result += scalar; used += width
    return result + '…'


def cases():
    result = []
    def add(label, path, member):
        # A raw JSON string preserves the nested duplicate, unlike an object map.
        body = '{'+json.dumps(member)+':1,'+json.dumps(member)+':2}'
        for component in reversed(path): body='{'+json.dumps(component)+':'+body+'}'
        # Prefix the root with "$" and apply the rule to each path component;
        # once a component fills the cap no later suffix can extend it.
        diagnostic_path='$'
        for component in path:
            for part in ['.', component]:
                remaining=4096-len(diagnostic_path.encode('utf-16-le'))//2
                if remaining == 0: break
                diagnostic_path+=bounded(part,remaining)
        display=bounded(member,256)
        message=SOURCE+": duplicate JSON object member '"+display+"' encountered at "+diagnostic_path
        for door in ['catalog','manifest']:
            if door=='manifest' and not path: continue
            result.append({'id':'diagnostic.v1.1.'+label+'.'+door,'door':door,'document':body,
                'source':SOURCE,'expected':{'message':message,'path':diagnostic_path,'memberDisplay':display}})
    for count in [253,254,255,256]: add('member-pair-'+str(count),['root'],'a'*count+'😀x')
    for count in [4090,4091,4092,4093]: add('path-pair-'+str(count),['a'*count+'😀x'],'duplicate')
    add('member-ascii-at-cap',['root'],'a'*256)
    add('member-ascii-over-cap',['root'],'a'*257)
    add('path-ascii-at-cap',['a'*4094],'duplicate')
    add('path-ascii-over-cap',['a'*4095],'duplicate')
    add('path-terminal-truncation',['a'*4092+'😀x','child'],'duplicate')
    add('path-prefix-fills-last-unit',['a'*4093,'child'],'duplicate')
    add('path-nested-pair',['root','a'*4087+'😀x','child'],'duplicate')
    add('path-authored-replacement',['a'*4092+'�x'],'duplicate')
    add('member-real-replacement',['root'],'a'*254+'�x')
    add('combining-boundary',['root'],'a'*254+'e\u0301x')
    return sorted(result,key=lambda r:r['id'])


def artifact():
    return {'formatVersion':1,'profileID':PROFILE_ID,'profileVersion':PROFILE_VERSION,
        'budgets':{'pathUTF16Units':4096,'memberUTF16Units':256},
        'rule':'Reserve one UTF-16 unit for ellipsis. Replace a retained high surrogate whose low surrogate is omitted with U+FFFD; retain all other prefix units.',
        'scope':'Diagnostics derived from valid Unicode JSON. This does not repair authored lone-surrogate input or change raw parsing, locale normalization or catalog wire syntax.',
        'cases':cases()}


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()


def read(path):
    data=path.read_bytes()
    if len(data)>1024*1024: raise ValueError('Diagnostic artifact exceeds byte cap')
    def pairs(items):
        out={}
        for key,value in items:
            if key in out: raise ValueError('Duplicate diagnostic member: '+key)
            out[key]=value
        return out
    return json.loads(data,object_pairs_hook=pairs)


def check(path):
    value=read(path)
    if path.read_bytes()!=canonical(artifact()): raise ValueError('Diagnostic profile bytes differ from independent recipe')
    ids=[r['id'] for r in value['cases']]
    return {'status':'passed','profileID':PROFILE_ID,'profileVersion':PROFILE_VERSION,'cases':len(ids),
        'idsSHA256':hashlib.sha256(('\n'.join(ids)+'\n').encode()).hexdigest(),
        'artifactSHA256':hashlib.sha256(path.read_bytes()).hexdigest()}
