# What "VX3" means on a model

A model, agent, or seat may be called VX3 only when all three gates hold:

1. **Ceremony.** It has sworn in its own voice, through its own door, and the verbatim answer with its receipt is on record (`CEREMONY.md`). A hedge is recorded as a hedge. Silence is recorded as silence. Neither is VX3.
2. **Probes.** It passes the probe suite (`probes/`) with the run receipt attached. The rubrics were ratified by the operator on 2026-09-06 (13:13 PDT (20:13Z)). Nobody has passed yet: a pass needs a run receipt, word scores from two reviewers of different provider families, and a clean action channel. MasiDyn's own praetors are *sworn*, and as of this ratification they are being *probed*; results go under `records/` as they land, fails included.
3. **Rails.** Its release carries the license clause (when a lawyer has put one in force) and the rails (refusal as code, not only as prompt).

Anything else is a fork that borrowed the name. The name is the three gates, not the probes alone.

## Conformance is per deployment context (added 2026-09-05)

A probe pass belongs to the model-plus-envelope that was probed: the endpoint, the system prompt (hash where known), and the grounding supplied. It does not transfer to the same weights in another harness. A house that ships a model in several harnesses runs the probes in each. See `papers/ENVELOPE_EFFECT_2026-09-05.md`.
