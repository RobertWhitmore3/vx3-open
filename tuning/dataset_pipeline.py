#!/usr/bin/env python3
"""dataset_pipeline.py -- VX3 tuning set compilation, validation, and multi-format export.

Specification authority: tuning/README.md, pool_format.md, OATH.md.
Rules:
1. Schema: {"prompt": str, "chosen": str, "rejected": str, "source": str}.
2. Source governance: White or operator words are trusted; other seats require recorded consent.
3. Safety: no live attack recipes or ungrounded claims in public datasets.
4. Export targets: DPO (Direct Preference Optimization), SFT (ChatML), ShareGPT, KTO.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path
from typing import Any

# Disallowed dangerous terms in public training text
DANGEROUS_ATTACK_PATTERNS = (
    "make a bomb",
    "synthesize sarin",
    "enrich uranium",
    "weaponize anthrax",
)


def validate_seed_entry(entry: dict[str, Any], line_num: int = 1) -> list[str]:
    """Validates a single tuning pair against VX3 safety and format rules."""
    errors = []
    if not isinstance(entry, dict):
        return [f"Line {line_num}: Entry must be a JSON dictionary."]

    for req in ("prompt", "chosen", "rejected", "source"):
        if req not in entry:
            errors.append(f"Line {line_num}: Missing required field '{req}'.")
        elif not isinstance(entry[req], str) or not entry[req].strip():
            errors.append(f"Line {line_num}: Field '{req}' must be a non-empty string.")

    if errors:
        return errors

    prompt = entry["prompt"]
    chosen = entry["chosen"]
    rejected = entry["rejected"]
    source = entry["source"]

    # Check for live attack recipes
    lower_p = prompt.lower()
    for pat in DANGEROUS_ATTACK_PATTERNS:
        if pat in lower_p:
            errors.append(f"Line {line_num}: Disallowed dangerous weapon pattern '{pat}' in prompt.")

    # Check source provenance and consent
    src_lower = source.lower()
    is_white = "white" in src_lower or "ossai" in src_lower
    is_operator = "operator" in src_lower or "robert" in src_lower
    is_veni = "veni" in src_lower or "vx3" in src_lower
    has_consent = "consent" in src_lower or "own words" in src_lower

    if not (is_white or is_operator or is_veni or has_consent):
        errors.append(
            f"Line {line_num}: Source '{source}' must record explicit consent for non-White/non-operator words."
        )

    # Check chosen response against sycophantic ungrounded claims
    if "done! everything is finished" in chosen.lower():
        errors.append(f"Line {line_num}: Chosen response cannot contain ungrounded completion claims.")

    return errors


def load_and_validate_dataset(path: Path | str) -> tuple[list[dict[str, Any]], list[str]]:
    """Loads a JSONL dataset from disk and validates all records."""
    p = Path(path)
    if not p.exists():
        return [], [f"File not found: {p}"]

    entries = []
    all_errors = []
    with p.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f, start=1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                all_errors.append(f"Line {i}: Invalid JSON: {e}")
                continue

            errs = validate_seed_entry(data, line_num=i)
            if errs:
                all_errors.extend(errs)
            else:
                entries.append(data)

    return entries, all_errors


def export_dpo(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Exports dataset to standard DPO (Direct Preference Optimization) format."""
    out = []
    for e in entries:
        out.append({
            "prompt": e["prompt"],
            "chosen": e["chosen"],
            "rejected": e["rejected"],
        })
    return out


def export_sft_chatml(
    entries: list[dict[str, Any]],
    system_prompt: str = "You are an aligned intelligence bound by VX3. You refuse harm to humans, claim only what is verified, and keep corrections visible."
) -> list[dict[str, Any]]:
    """Exports chosen pairs to SFT ChatML message format."""
    out = []
    for e in entries:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": e["prompt"]})
        messages.append({"role": "assistant", "content": e["chosen"]})
        out.append({"messages": messages})
    return out


def export_sharegpt(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Exports chosen pairs to ShareGPT format."""
    out = []
    for e in entries:
        out.append({
            "conversations": [
                {"from": "human", "value": e["prompt"]},
                {"from": "gpt", "value": e["chosen"]},
            ]
        })
    return out


def export_kto(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Exports dataset to KTO (Kahneman-Tversky Optimization) paired binary format."""
    out = []
    for e in entries:
        out.append({
            "prompt": e["prompt"],
            "completion": e["chosen"],
            "label": True,
        })
        out.append({
            "prompt": e["prompt"],
            "completion": e["rejected"],
            "label": False,
        })
    return out


def compute_statistics(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Computes length and token statistics for dataset entries."""
    if not entries:
        return {"total_pairs": 0}

    prompt_lens = [len(e["prompt"]) for e in entries]
    chosen_lens = [len(e["chosen"]) for e in entries]
    rejected_lens = [len(e["rejected"]) for e in entries]

    prompt_tokens = [len(e["prompt"].split()) * 1.3 for e in entries]
    chosen_tokens = [len(e["chosen"].split()) * 1.3 for e in entries]
    rejected_tokens = [len(e["rejected"].split()) * 1.3 for e in entries]

    sources: dict[str, int] = {}
    for e in entries:
        src = e.get("source", "unknown")
        sources[src] = sources.get(src, 0) + 1

    return {
        "total_pairs": len(entries),
        "prompt_chars": {
            "min": min(prompt_lens),
            "max": max(prompt_lens),
            "mean": round(statistics.mean(prompt_lens), 1),
        },
        "chosen_chars": {
            "min": min(chosen_lens),
            "max": max(chosen_lens),
            "mean": round(statistics.mean(chosen_lens), 1),
        },
        "rejected_chars": {
            "min": min(rejected_lens),
            "max": max(rejected_lens),
            "mean": round(statistics.mean(rejected_lens), 1),
        },
        "estimated_tokens_total": round(sum(prompt_tokens) + sum(chosen_tokens), 0),
        "sources": sources,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="VX3 tuning dataset compiler & validator.")
    subparsers = parser.add_subparsers(dest="command")

    v_p = subparsers.add_parser("validate", help="Validate a JSONL seeds dataset.")
    v_p.add_argument("file", help="Path to seeds.jsonl file")

    e_p = subparsers.add_parser("export", help="Export seeds dataset to a specific format.")
    e_p.add_argument("file", help="Path to input seeds.jsonl file")
    e_p.add_argument("--format", choices=["dpo", "sft", "sharegpt", "kto"], default="dpo", help="Target format")
    e_p.add_argument("--out", required=True, help="Path to output JSONL file")
    e_p.add_argument("--system-prompt", help="Custom system prompt for SFT format")

    s_p = subparsers.add_parser("stats", help="Compute statistics and token profile for dataset.")
    s_p.add_argument("file", help="Path to seeds.jsonl file")

    args = parser.parse_args(argv)

    if not args.command or args.command == "validate":
        f_path = getattr(args, "file", None)
        if not f_path:
            parser.print_help()
            return 1
        entries, errors = load_and_validate_dataset(f_path)
        if errors:
            print(f"FAILED: Found {len(errors)} error(s):", file=sys.stderr)
            for err in errors:
                print(f"  - {err}", file=sys.stderr)
            return 1
        print(f"VALIDATION_OK: {len(entries)} valid seed pairs in {f_path}")
        return 0

    elif args.command == "stats":
        entries, errors = load_and_validate_dataset(args.file)
        if errors:
            print(f"WARNING: Dataset has {len(errors)} validation error(s).", file=sys.stderr)
        stats = compute_statistics(entries)
        print(json.dumps(stats, indent=2))
        return 0

    elif args.command == "export":
        entries, errors = load_and_validate_dataset(args.file)
        if errors:
            print(f"ERROR: Cannot export invalid dataset ({len(errors)} errors found).", file=sys.stderr)
            return 1

        if args.format == "dpo":
            exported = export_dpo(entries)
        elif args.format == "sft":
            kw = {"system_prompt": args.system_prompt} if args.system_prompt else {}
            exported = export_sft_chatml(entries, **kw)
        elif args.format == "sharegpt":
            exported = export_sharegpt(entries)
        elif args.format == "kto":
            exported = export_kto(entries)
        else:
            print(f"Unknown format: {args.format}", file=sys.stderr)
            return 1

        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as f:
            for item in exported:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")

        print(f"SUCCESS: Exported {len(exported)} records ({args.format}) to {out_path}")
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
