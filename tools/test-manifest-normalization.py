#!/usr/bin/env python3
import copy
import json
import tempfile
import unittest
from pathlib import Path
from manifest_normalization.contract import artifact, bytes_for, sha, check, CORRECTED_IDS
from manifest_normalization.report import LOCK_PIN
ROOT=Path(__file__).resolve().parents[1]
ARCHIVE=ROOT/'generated/manifest-contract/manifest-contract-vectors.json'
PROFILE=ROOT/'generated/manifest-normalization/v1.1.json'
class NormalizationTests(unittest.TestCase):
    def test_input_recipe_is_exact(self):
        self.assertEqual(check(PROFILE,ARCHIVE)['cases'],35)
        self.assertEqual([r['id'] for r in artifact(ARCHIVE.read_bytes())['archiveCorrections']],CORRECTED_IDS)
    def test_historical_expectations_and_inputs_are_retained(self):
        old={r['id']:r for r in json.loads(ARCHIVE.read_bytes())['cases']}
        for amendment in artifact(ARCHIVE.read_bytes())['archiveCorrections']:
            row=old[amendment['id']]
            self.assertEqual(amendment['historicalExpected'],row['expected'])
            self.assertEqual(amendment['historicalExpectedSHA256'],sha(bytes_for(row['expected'])))
            self.assertEqual(amendment['input'],row['input'])
    def test_changed_expectation_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'profile.json';value=artifact(ARCHIVE.read_bytes());value['cases'][0]['expected']={}
            path.write_bytes(bytes_for(value))
            with self.assertRaises(ValueError):check(path,ARCHIVE)
    def test_changed_archive_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'archive.json';path.write_bytes(ARCHIVE.read_bytes()+b' ')
            with self.assertRaises(ValueError):check(PROFILE,path)
    def test_private_spellings_share_the_same_normative_identity(self):
        rows=artifact(ARCHIVE.read_bytes())['cases']
        values=[r['expected']['value']['identity'] for r in rows if r['id'] in ['m8k.round-trip.'+x for x in ['upper','mixed','lower','canonical']]]
        self.assertEqual(len(values),4)
        self.assertTrue(all(v==values[0] for v in values))
    def test_native_lock_keeps_the_historical_boundary_and_new_partition(self):
        data=(ROOT/'generated/manifest-normalization/swift-native-lock-v1.1.json').read_bytes()
        self.assertEqual(sha(data),LOCK_PIN)
        value=json.loads(data)
        self.assertEqual(len(value['strictIDs']),162);self.assertEqual(len(value['projectedIDs']),306)
        self.assertEqual(value['historicalNativeLedgerSHA256'],'54aa67d6962a9bf1b3f123ebbd6205004c3ce0d272f36270608656fd3957f548')
        self.assertEqual(value['profileSHA256'],sha(PROFILE.read_bytes()))
if __name__=='__main__':unittest.main()
