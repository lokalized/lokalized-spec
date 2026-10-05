#!/usr/bin/env python3
"""Negative controls for the portable exact Unicode identifier profile."""
from __future__ import annotations

import copy
import json
import unittest

from check_exact_identifier import PROFILE, validate


class ExactIdentifierProfileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.profile = json.loads(PROFILE.read_bytes())

    def test_canonical_profile(self) -> None:
        self.assertEqual(validate(self.profile)["cases"], 15)

    def test_missing_case(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"].pop()
        with self.assertRaisesRegex(ValueError, "inventory"):
            validate(changed)

    def test_composed_and_decomposed_catalog_keys_cannot_collapse(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["fixture"]["catalogs"]["paired"] = changed["fixture"]["catalogs"]["paired"].replace("cafe\\u0301", "caf\\u00e9")
        with self.assertRaisesRegex(ValueError, "catalog key/value sequence"):
            validate(changed)

    def test_lookup_key_spelling_is_exact(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][1]["key"] = "café"
        with self.assertRaisesRegex(ValueError, "exact input spelling"):
            validate(changed)

    def test_missing_key_must_visit_parent_candidates(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][2]["expected"]["attemptedLocales"] = ["en-GB"]
        with self.assertRaisesRegex(ValueError, "exact lookup result"):
            validate(changed)

    def test_placeholder_names_cannot_collapse(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][4]["values"][1]["name"] = "é"
        with self.assertRaisesRegex(ValueError, "exact placeholder names"):
            validate(changed)

    def test_duplicate_source_must_retain_same_decoded_key(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["fixture"]["catalogs"]["duplicateExact"] = changed["fixture"]["catalogs"]["duplicateExact"].replace("café", "café")
        with self.assertRaisesRegex(ValueError, "catalog key/value sequence"):
            validate(changed)

    def test_duplicate_must_be_refused(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][5]["expected"]["status"] = "translated"
        with self.assertRaisesRegex(ValueError, "catalog must be refused"):
            validate(changed)

    def test_supplementary_letter_must_retain_both_surrogates(self) -> None:
        changed = copy.deepcopy(self.profile)
        source = changed["fixture"]["catalogs"]["supplementaryLetter"]
        changed["fixture"]["catalogs"]["supplementaryLetter"] = source.replace("\\ud801\\udc00", "\\ud801")
        with self.assertRaisesRegex(ValueError, "catalog key/value sequence"):
            validate(changed)

    def test_valid_continuation_categories_must_render(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][6]["expected"]["translation"] = "{{áा⃝Ⅻ²2}}"
        with self.assertRaisesRegex(ValueError, "exact lookup result"):
            validate(changed)

    def test_leading_number_is_not_a_letter(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][10]["expected"]["status"] = "translated"
        with self.assertRaisesRegex(ValueError, "expected reason"):
            validate(changed)

    def test_refusal_must_keep_exact_offending_name(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][14]["expected"]["message"] = changed["cases"][14]["expected"]["message"].replace("a\u200d", "a")
        with self.assertRaisesRegex(ValueError, "expected reason"):
            validate(changed)


if __name__ == "__main__": unittest.main()
