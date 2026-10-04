"""Strict saved-observation checker; execution provenance is supplied by each port."""
import copy
from .contract import PROFILE_ID, PROFILE_VERSION, SOURCE, check, read


def report_check(value, artifact_path):
    summary = check(artifact_path)
    rows = read(artifact_path)['cases']
    if set(value) != {'formatVersion', 'profileID', 'profileVersion', 'artifactSHA256', 'totalCases', 'status', 'failed', 'observations'}:
        raise ValueError('Diagnostic report fields differ')
    if type(value['formatVersion']) is not int or value['formatVersion'] != 1 or type(value['totalCases']) is not int or value['totalCases'] != len(rows):
        raise ValueError('Diagnostic report inventory differs')
    for field, expected in [('profileID', PROFILE_ID), ('profileVersion', PROFILE_VERSION), ('artifactSHA256', summary['artifactSHA256']), ('status', 'passed'), ('failed', [])]:
        if value[field] != expected: raise ValueError('Diagnostic report differs at '+field)
    observed = value['observations']
    if not isinstance(observed, list) or len(observed) != len(rows):
        raise ValueError('Diagnostic observation count differs')
    for row, actual in zip(rows, observed):
        expected = {'id': row['id'], 'door': row['door'], 'outcome': 'threw', 'name': 'StringsParseError',
            'message': row['expected']['message'], 'source': SOURCE,
            'path': row['expected']['path'] if row['door'] == 'catalog' else None}
        if actual != expected: raise ValueError('Diagnostic observation differs: '+row['id'])
        # Encoding rejects an unpaired surrogate even if a caller changes expectations.
        actual['message'].encode('utf-16-le')
        if actual['path'] is not None and len(actual['path'].encode('utf-16-le')) // 2 > 4096:
            raise ValueError('Diagnostic path exceeds cap')
    return {**summary, 'observations': len(observed), 'mode': 'saved-observation-check'}


def negative_controls(value, artifact_path):
    report_check(value, artifact_path)
    mutations = {
        'status': lambda v: v.update(status='failed'),
        'version': lambda v: v.update(profileVersion='1.0.0'),
        'artifact': lambda v: v.update(artifactSHA256='0'*64),
        'count': lambda v: v.update(totalCases=True),
        'unknown-field': lambda v: v.update(unknown=True),
        'missing-observation': lambda v: v['observations'].pop(),
        'duplicate-id': lambda v: v['observations'].__setitem__(1, copy.deepcopy(v['observations'][0])),
        'order': lambda v: v['observations'].reverse(),
        'outcome': lambda v: v['observations'][0].update(outcome='returned'),
        'text': lambda v: v['observations'][0].update(message='changed'),
        'path': lambda v: v['observations'][0].update(path='$.wrong'),
        'error-name': lambda v: v['observations'][0].update(name='Error'),
        'source': lambda v: v['observations'][0].update(source='wrong'),
        'unknown-observation-field': lambda v: v['observations'][0].update(extra=True),
        'failure': lambda v: v['failed'].append({'id':'invented'}),
    }
    refused=[]
    for name, mutate in mutations.items():
        altered=copy.deepcopy(value); mutate(altered)
        try: report_check(altered, artifact_path)
        except (ValueError, UnicodeError): refused.append(name)
        else: raise ValueError('Diagnostic checker accepted corruption: '+name)
    return {'status':'passed','refused':refused,'negativeControls':len(refused)}
