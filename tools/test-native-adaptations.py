#!/usr/bin/env python3
"""Offline shared policy tests; these never claim execution of a native port."""
import copy
from pathlib import Path
import tempfile
import unittest

from native_adaptations import contract as c

ROOT = Path(__file__).resolve().parents[1]


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.corpus = c.read_corpus(ROOT/'generated/behavioral-vectors.json')
        cls.profile = c.read(ROOT/'conformance/swift-native-v1.json')

    def test_exact_inventory_and_partitions(self):
        c.check_profile(self.profile, self.corpus)
        records = self.profile['records']
        self.assertEqual(len(records), 184)
        self.assertEqual(sum(r['kind'] == 'nonoptional-api-boundary' and r['partition'] == 'requiredPortableIds' for r in records), 20)
        self.assertTrue(all(r['partition'] == 'informationalIds' for r in records if r['kind'] != 'nonoptional-api-boundary'))

    def test_contract_mutations_fail_closed(self):
        for mutate in [lambda p: p['records'].pop(), lambda p: p['records'].append(p['records'][0]),
                       lambda p: p.update(originalObservationsModified=True), lambda p: p.update(approved=True),
                       lambda p: p['records'][0].update(inputSHA256='0'*64), lambda p: p.update(limits=[])]:
            changed = copy.deepcopy(self.profile)
            mutate(changed)
            with self.assertRaises(ValueError):
                c.check_profile(changed, self.corpus)

    def test_guard_cannot_be_reused_for_a_representable_input(self):
        corpus = copy.deepcopy(self.corpus)
        row = next(r for r in corpus['cases'] if r['id'] == 'callback-smoke.resolver.null-return-is-rejected')
        corpus['fixtures'][row['fixture']]['phoneticResolver']['behavior'] = 'constant'
        with self.assertRaises(ValueError):
            c.check_profile(self.profile, corpus)

    def test_complete_filename_rule_is_narrow(self):
        records = [r for r in self.profile['records'] if r['kind'] == 'native-filename-attribution']
        self.assertEqual([(r['filenameRule']['nativeFilename'], r['filenameRule']['referenceFilename']) for r in records],
                         [('notes.json', 'zz.json'), ('amh', 'afu'), ('fr', 'en'), ('fr', 'en'), ('en.json', 'en')])
        for r in records:
            self.assertEqual(r['notReplayedObservationChannels'], [])
            self.assertEqual(r['filenameRule']['differentChannels'], ['failureMessage.filename'])
            self.assertEqual(len(r['filenameRule']['equalChannels']), 5)

    def test_required_case_cannot_be_excluded_as_a_jvm_carrier(self):
        corpus = copy.deepcopy(self.corpus)
        row = next(r for r in corpus['cases'] if r['operation'] == 'loadClasspath')
        row['partition'] = 'requiredPortableIds'
        with self.assertRaisesRegex(ValueError, 'Required JVM carrier'):
            c.profile_for(corpus)

    def test_byte_reader_rejects_duplicates_nonfinite_and_oversize(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'test.json'
            for text in ['{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}']:
                path.write_text(text)
                with self.assertRaises(ValueError):
                    c.read(path)
            path.write_text('{}')
            with self.assertRaisesRegex(ValueError, 'byte limit'):
                c.read(path, maximum_bytes=1)

    def test_frozen_corpus_cannot_be_replaced(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'corpus.json'
            path.write_bytes(c.canonical(self.corpus) + b'\n')
            with self.assertRaisesRegex(ValueError, 'corpus bytes changed'):
                c.read_corpus(path)


if __name__ == '__main__':
    unittest.main()
