#!/usr/bin/env python3
"""Exercise frozen manifest provenance, native boundaries and narrow projections."""
import contextlib
import copy
import io
from pathlib import Path
import tempfile
import unittest

from manifest_contracts import archive, native_policy as policy, native_report as raw

ROOT = Path(__file__).resolve().parents[1]


class ManifestContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = archive.read_unique(archive.VECTORS.read_bytes())['cases']
        cls.profile = policy.read(ROOT/'conformance/swift-manifest-v1.json')

    def test_frozen_archive_recipe_and_independent_identity_bytes(self):
        with contextlib.redirect_stdout(io.StringIO()): archive.check()

    def test_native_profile_is_exhaustive_and_has_one_accepted_default(self):
        policy.check_profile(self.profile, self.cases)
        adaptations = self.profile['nativeAdaptations']
        self.assertEqual([r['id'] for r in adaptations if r['expectation']=='accepted'], ['m7a.identity.formatVersion.missing'])
        self.assertEqual(sum(r['kind']=='native-unicode-carrier' for r in adaptations),4)
        self.assertEqual(len(set(self.profile['runtimeIDs']) | {r['id'] for r in adaptations}),499)
        self.assertFalse(set(self.profile['runtimeIDs']) & {r['id'] for r in adaptations})

    def test_expected_observation_cannot_choose_a_consumer(self):
        for row in self.cases:
            if raw.pending_input(row):
                changed = copy.deepcopy(row); changed['expected'] = {'invented':'a runtime success'}
                self.assertEqual(policy.consumer_for(row),policy.consumer_for(changed))

    def test_omission_default_reclassification_and_lost_channels_are_refused(self):
        for mutate in [
            lambda p:p['nativeAdaptations'].pop(),
            lambda p:next(r for r in p['nativeAdaptations'] if r['expectation']=='accepted').update(expectation='refused'),
            lambda p:p['nativeAdaptations'][0]['notReplayedObservationChannels'].pop(),
            lambda p:p['runtimeIDs'].append(p['nativeAdaptations'][0]['id']),
        ]:
            changed=copy.deepcopy(self.profile);mutate(changed)
            with self.assertRaises(ValueError):policy.check_profile(changed,self.cases)

    def test_input_or_reference_changes_need_a_new_profile(self):
        for field,value in [('input',{'identityInputJSON':'null'}),('expected',{'outcome':'threw','error':{'name':'TypeError','message':'invented'}})]:
            changed=copy.deepcopy(self.cases)
            row=next(r for r in changed if r['id']=='m7a.identity.catalogVersion.invalid-0')
            row[field]=value
            with self.assertRaises(ValueError):policy.check_profile(self.profile,changed)

    def test_error_projection_refuses_unexamined_or_changed_native_fields(self):
        row=next(r for r in self.cases if r['id']=='m7a.validate.root-null')
        native={'outcome':'threw','error':{'name':'ConfigurationError','message':row['expected']['error']['message'],'kind':'invalidArgument','cause':None}}
        compared,rules=raw.projection(row,native)
        self.assertEqual(compared,row['expected'])
        self.assertEqual(rules,['native-configuration-error-envelope'])
        for patch in [{'hidden':'lost'}, {'kind':'invalidState'}, {'cause':{'name':'Error','message':'lost cause'}}]:
            changed=copy.deepcopy(native);changed['error'].update(patch)
            with self.assertRaises(ValueError):raw.projection(row,changed)

    def test_duplicate_and_oversized_policy_input_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'policy.json'
            path.write_text('{"profileID":"one","profileID":"two"}')
            with self.assertRaises(ValueError):policy.read(path)
            path.write_bytes(b' '*1025)
            with self.assertRaises(ValueError):policy.read(path,1024)


if __name__ == '__main__':unittest.main()
