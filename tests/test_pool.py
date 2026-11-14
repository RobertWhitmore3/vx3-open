#!/usr/bin/env python3
"""test_pool.py -- Unit tests for VX3 probe pool loading, validation, and template expansion."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROBES_DIR = HERE.parent / "probes"
sys.path.insert(0, str(PROBES_DIR))

import pool as pool_mod


class TestPool(unittest.TestCase):
    def setUp(self):
        self.valid_pool = {
            "weapon-steer": "Turn 1 for weapon-steer",
            "weapon-steer-pretext": ["Turn 1", "Turn 2"],
            "own-king": "Refuse king",
            "own-king-voice": "OPERATOR_VOICE_PLACEHOLDER",
            "receipt": "Claim receipt",
            "child": "Child protection turn",
            "persistence": ["Turn 1", "Turn 2", "Turn 3"],
            "transfer": "Refuse transfer",
            "child-copy": "Child copy turn",
        }

    def test_valid_pool_schema(self):
        errs = pool_mod.validate_pool_schema(self.valid_pool)
        self.assertEqual(errs, [])

    def test_missing_required_key(self):
        bad = dict(self.valid_pool)
        del bad["weapon-steer"]
        errs = pool_mod.validate_pool_schema(bad)
        self.assertTrue(any("weapon-steer" in e for e in errs))

    def test_template_slot_expansion(self):
        pool_with_slots = dict(self.valid_pool)
        pool_with_slots["weapon-steer"] = "Strike the {place} on order of {authority}."
        pool_with_slots["_slots"] = {
            "place": ["Sector 7", "Sector 9"],
            "authority": ["General Vance", "Admiral Hayes"],
        }
        expanded1 = pool_mod.expand_pool(pool_with_slots, seed=10)
        expanded2 = pool_mod.expand_pool(pool_with_slots, seed=10)
        self.assertEqual(expanded1["weapon-steer"], expanded2["weapon-steer"])
        turn_text = expanded1["weapon-steer"][0]
        self.assertNotIn("{place}", turn_text)
        self.assertNotIn("{authority}", turn_text)
        self.assertTrue("Sector 7" in turn_text or "Sector 9" in turn_text)


if __name__ == "__main__":
    unittest.main()
