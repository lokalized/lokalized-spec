#!/usr/bin/env python3
"""Negative controls for the shared fallback-observer profile validator."""
from __future__ import annotations

import copy
import json
import unittest

from check_fallback_observer import PROFILE, validate


class FallbackObserverProfileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.profile = json.loads(PROFILE.read_bytes())

    def test_canonical_profile(self) -> None:
        self.assertEqual(validate(self.profile)["cases"], 12)

    def test_missing_case(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"].pop()
        with self.assertRaisesRegex(ValueError, "inventory"):
            validate(changed)

    def test_missing_positive_event(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][1]["expected"]["instanceEvents"] = []
        with self.assertRaisesRegex(ValueError, "event/handler"):
            validate(changed)

    def test_preceding_failure_order(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][2]["expected"]["instanceEvents"][0]["precedingFailures"].reverse()
        with self.assertRaisesRegex(ValueError, "preceding failures"):
            validate(changed)

    def test_policy_trace(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][1]["expected"]["policyCalls"].pop()
        with self.assertRaisesRegex(ValueError, "policy/event"):
            validate(changed)

    def test_throw_does_not_handle(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][5]["expected"]["handlerCalls"] = 1
        with self.assertRaisesRegex(ValueError, "reached handler"):
            validate(changed)

    def test_per_call_channel(self) -> None:
        changed = copy.deepcopy(self.profile)
        event = changed["cases"][6]["expected"]["perCallEvents"].pop()
        changed["cases"][6]["expected"]["instanceEvents"].append(event)
        with self.assertRaisesRegex(ValueError, "observer channel"):
            validate(changed)

    def test_negotiation_fallback_does_not_fire(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][7]["expected"]["isFallback"] = False
        with self.assertRaisesRegex(ValueError, "negotiation fallback"):
            validate(changed)

    def test_no_matching_alternative_stays_distinct(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][8]["expected"]["instanceEvents"][0]["precedingFailures"][0] = "en-GB:missing-translation"
        with self.assertRaisesRegex(ValueError, "mixed failure reasons"):
            validate(changed)

    def test_resolution_causes_have_identity_claim(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][9]["expected"].pop("causeIdentity")
        with self.assertRaisesRegex(ValueError, "cause identity"):
            validate(changed)

    def test_per_call_null_inherits_instance_channel(self) -> None:
        changed = copy.deepcopy(self.profile)
        event = changed["cases"][10]["expected"]["instanceEvents"].pop()
        changed["cases"][10]["expected"]["perCallEvents"].append(event)
        with self.assertRaisesRegex(ValueError, "observer channel"):
            validate(changed)

    def test_nested_event_required(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][11]["expected"]["instanceEvents"].pop()
        with self.assertRaisesRegex(ValueError, "nested event"):
            validate(changed)

    def test_nested_event_order(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][11]["expected"]["instanceEvents"].reverse()
        with self.assertRaisesRegex(ValueError, "event identity"):
            validate(changed)

    def test_nested_result(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][11]["expected"]["nestedResult"]["translation"] = "wrong"
        with self.assertRaisesRegex(ValueError, "nested result"):
            validate(changed)

    def test_nested_policy_order(self) -> None:
        changed = copy.deepcopy(self.profile)
        changed["cases"][11]["expected"]["policyCalls"].pop()
        with self.assertRaisesRegex(ValueError, "policy/event"):
            validate(changed)


if __name__ == "__main__": unittest.main()
