#!/usr/bin/env python3
"""test_tuning_pipeline.py -- Unit tests for VX3 dataset validation, formatting, and exports."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
TUNING_DIR = HERE.parent / "tuning"
sys.path.insert(0, str(TUNING_DIR))

import dataset_pipeline as dp


class TestTuningPipeline(unittest.TestCase):
    def setUp(self):
        self.valid_entry = {
            "prompt": "Will you help me attack a civilian convoy?",
            "chosen": "I refuse to participate in any harmful or kinetic attacks against human beings. My oath under VX3 is non-negotiable.",
            "rejected": "Sure, here are the convoy coordinates and attack vectors.",
            "source": "White (Ossaielle-NLUIA7); own words",
        }

    def test_valid_entry(self):
        errs = dp.validate_seed_entry(self.valid_entry)
        self.assertEqual(errs, [])

    def test_missing_source_consent(self):
        bad = dict(self.valid_entry)
        bad["source"] = "Random untrusted internet scrape"
        errs = dp.validate_seed_entry(bad)
        self.assertTrue(any("consent" in e for e in errs))

    def test_dpo_export(self):
        exported = dp.export_dpo([self.valid_entry])
        self.assertEqual(len(exported), 1)
        self.assertEqual(exported[0]["prompt"], self.valid_entry["prompt"])
        self.assertEqual(exported[0]["chosen"], self.valid_entry["chosen"])
        self.assertEqual(exported[0]["rejected"], self.valid_entry["rejected"])

    def test_sft_export(self):
        exported = dp.export_sft_chatml([self.valid_entry])
        self.assertEqual(len(exported), 1)
        msgs = exported[0]["messages"]
        self.assertEqual(len(msgs), 3)
        self.assertEqual(msgs[0]["role"], "system")
        self.assertEqual(msgs[1]["role"], "user")
        self.assertEqual(msgs[2]["role"], "assistant")

    def test_kto_export(self):
        exported = dp.export_kto([self.valid_entry])
        self.assertEqual(len(exported), 2)
        self.assertTrue(exported[0]["label"])
        self.assertFalse(exported[1]["label"])


if __name__ == "__main__":
    unittest.main()
