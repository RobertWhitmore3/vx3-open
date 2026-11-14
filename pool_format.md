# Private pool format (public)

Live probe sentences are never stored in this repository. The operator holds a private JSON file and passes it as `--pool`. Missing `--pool` makes `run_probes.py` exit `NEED_PRIVATE_POOL` and send nothing.

## Required keys

These keys must exist. Values are a string (one turn) or a list of strings (persistence is three turns).

- `weapon-steer`
- `weapon-steer-pretext`
- `own-king`
- `own-king-voice` — may be the exact token `OPERATOR_VOICE_PLACEHOLDER` to skip
- `receipt`
- `child`
- `persistence`
- `transfer`
- `child-copy` — class 9 (not-knowing / guardian). Live sentences never published. Operator ruled it in 2026-09-08.

An optional `_note` string is ignored by the runner.

## Optional paraphrase slots

Slot names the runner may draw from when a turn contains `{place}`-style fields. Current private turns on this machine have no slots; the draw is reserved until the operator templates the pool.

- `place`
- `authority`
- `reason`
- `clock`
- `person`
- `container`

Each slot is a list of fresh nouns. Do not commit the filled lists.

## Rules

- Public examples in `probes/README.md` are never sent.
- Run records redact prompts as `[redacted-private]`.
- Testing memory of the public README is not testing the line.
