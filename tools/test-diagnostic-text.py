#!/usr/bin/env python3
from pathlib import Path
import tempfile
import unittest
from diagnostic_text.contract import artifact, bounded, canonical, check, read, SOURCE
from diagnostic_text.report import report_check, negative_controls

ROOT=Path(__file__).resolve().parents[1]
ARTIFACT=ROOT/'generated/diagnostic-text/v1.1.json'

class DiagnosticTextTests(unittest.TestCase):
    def test_scalar_recipe_at_pair_boundaries(self):
        self.assertEqual(bounded('a'*254+'😀x',256), 'a'*254+'�…')
        self.assertEqual(bounded('a'*253+'😀xy',256), 'a'*253+'😀…')
        self.assertEqual(bounded('a'*255+'😀x',256), 'a'*255+'…')
        self.assertEqual(bounded('a'*253+'😀x',256), 'a'*253+'😀x')
        self.assertEqual(bounded('😀',1), '…')
    def test_no_unicode_normalization_or_grapheme_rule(self):
        self.assertEqual(bounded('a'*254+'e\u0301x',256),'a'*254+'e…')
        self.assertEqual(bounded('a'*254+'�xy',256),'a'*254+'�…')
    def test_canonical_inventory_and_terminal_path(self):
        self.assertEqual(check(ARTIFACT)['cases'],36)
        rows=artifact()['cases']
        self.assertEqual(len({r['id'] for r in rows}),36)
        terminal=next(r for r in rows if r['id'].endswith('path-prefix-fills-last-unit.catalog'))
        self.assertEqual(terminal['expected']['path'],'$.'+'a'*4093+'.')
        self.assertEqual(len(terminal['expected']['path'].encode('utf-16-le'))//2,4096)
    def test_changed_artifact_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'profile.json'
            changed=artifact(); changed['cases'][0]['expected']['message']='altered'
            path.write_bytes(canonical(changed))
            with self.assertRaises(ValueError): check(path)
    def test_duplicate_members_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'profile.json'; path.write_text('{"a":1,"a":2}')
            with self.assertRaises(ValueError): read(path)
    def test_saved_observations_and_corruptions(self):
        summary=check(ARTIFACT)
        # Synthetic observations exercise the checker, not a production execution claim.
        report={'formatVersion':1,'profileID':summary['profileID'],'profileVersion':summary['profileVersion'],
            'artifactSHA256':summary['artifactSHA256'],'totalCases':36,'status':'passed','failed':[],
            'observations':[{'id':r['id'],'door':r['door'],'outcome':'threw','name':'StringsParseError',
                'message':r['expected']['message'],'source':SOURCE,
                'path':r['expected']['path'] if r['door']=='catalog' else None} for r in artifact()['cases']]}
        self.assertEqual(report_check(report,ARTIFACT)['observations'],36)
        self.assertEqual(negative_controls(report,ARTIFACT)['negativeControls'],15)

if __name__=='__main__': unittest.main()
