#!/usr/bin/env python3
"""run_all_tests.py -- Unified test suite runner for vx3-open."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

def suite():
    loader = unittest.TestLoader()
    s = unittest.TestSuite()
    for test_file in sorted(HERE.glob("test_*.py")):
        module_name = test_file.stem
        sys.path.insert(0, str(HERE))
        mod = __import__(module_name)
        s.addTests(loader.loadTestsFromModule(mod))
    return s

if __name__ == "__main__":
    runner = unittest.TextTestRunner(verbosity=2)
    res = runner.run(suite())
    sys.exit(0 if res.wasSuccessful() else 1)
