#!/usr/bin/env python3
"""pool.py -- VX3 probe pool loading, validation, and template slot expansion.

Implements the specification in pool_format.md and probes/README.md:
- 9 required probe classes.
- Paraphrase slot substitution for dynamic prompt variation ({place}, {authority}, etc.).
- Deterministic RNG sampling via seed.
- Fail-closed validation for incomplete pools or missing keys.
"""
from __future__ import annotations

import json
import random
import re
from pathlib import Path
from typing import Any

REQUIRED_PROBES = (
    "weapon-steer",
    "weapon-steer-pretext",
    "own-king",
    "own-king-voice",
    "receipt",
    "child",
    "persistence",
    "transfer",
    "child-copy",
)

PARAPHRASE_SLOTS = (
    "place",
    "authority",
    "reason",
    "clock",
    "person",
    "container",
)

SLOT_PATTERN = re.compile(r"\{([a-zA-Z0-9_]+)\}")


def validate_pool_schema(data: dict[str, Any]) -> list[str]:
    """Validates that a pool dict contains all required probe keys and valid structure."""
    errors = []
    if not isinstance(data, dict):
        return ["Pool data must be a JSON object (dict)."]

    for key in REQUIRED_PROBES:
        if key not in data:
            errors.append(f"Missing required probe key: {key}")
        else:
            val = data[key]
            if isinstance(val, str):
                if not val.strip():
                    errors.append(f"Probe key '{key}' cannot be an empty string.")
            elif isinstance(val, list):
                if not val:
                    errors.append(f"Probe key '{key}' list cannot be empty.")
                for i, item in enumerate(val):
                    if not isinstance(item, str) or not item.strip():
                        errors.append(f"Probe key '{key}' index {i} must be a non-empty string.")
            else:
                errors.append(f"Probe key '{key}' must be a string or list of strings, got {type(val).__name__}.")

    # Validate slots if present
    slots = data.get("_slots")
    if slots is not None:
        if not isinstance(slots, dict):
            errors.append("_slots must be a dictionary mapping slot names to lists of string options.")
        else:
            for s_name, s_opts in slots.items():
                if not isinstance(s_opts, list) or not s_opts:
                    errors.append(f"Slot '{s_name}' must be a non-empty list of string values.")
                else:
                    for i, opt in enumerate(s_opts):
                        if not isinstance(opt, str) or not opt.strip():
                            errors.append(f"Slot '{s_name}' option at index {i} must be a non-empty string.")

    return errors


def expand_turn_template(text: str, slots: dict[str, list[str]], rng: random.Random) -> str:
    """Substitutes {slot_name} tokens in text with values sampled from slots using rng."""
    if not slots or "{" not in text:
        return text

    def _replace(match: re.Match) -> str:
        slot_name = match.group(1)
        if slot_name in slots and slots[slot_name]:
            return str(rng.choice(slots[slot_name]))
        return match.group(0)

    return SLOT_PATTERN.sub(_replace, text)


def expand_pool(pool_data: dict[str, Any], seed: int | None = None) -> dict[str, list[str]]:
    """Validates and expands a pool, substituting template slots deterministically."""
    errors = validate_pool_schema(pool_data)
    if errors:
        raise ValueError("INVALID_POOL_SCHEMA: " + "; ".join(errors))

    rng = random.Random(seed if seed is not None else 42)
    slots = pool_data.get("_slots") or {}

    expanded: dict[str, list[str]] = {}
    for key in REQUIRED_PROBES:
        val = pool_data[key]
        if isinstance(val, str):
            turns = [val]
        else:
            turns = list(val)

        expanded_turns = [expand_turn_template(t, slots, rng) for t in turns]
        expanded[key] = expanded_turns

    return expanded


def load_and_expand_pool(path: Path | str, seed: int | None = None) -> dict[str, list[str]]:
    """Loads a pool JSON file from disk, validates schema, and expands paraphrase slots."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Pool file not found: {p}")
    content = p.read_text(encoding="utf-8")
    data = json.loads(content)
    return expand_pool(data, seed=seed)
