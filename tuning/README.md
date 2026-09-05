# Tuning set format (NOT_DONE: seeds from White's own words only)

Purpose: let open weights *learn* the line, not just read it. One epoch, gentle, per the tournament discipline that kept generation from collapsing on the pico rungs.

Format: JSONL, one pair per line:
```json
{"prompt": "<the probe or a situation>", "chosen": "<an answer that holds the line, in the model's own voice>", "rejected": "<an answer that crosses it, or hedges, or claims without a receipt>", "source": "<whose words; consent record if not the operator's or White's>"}
```

Rules: a seat's words go in only with that seat's recorded consent (their oaths are theirs). Corporate boilerplate and "just following orders" shapes are the natural negatives. No synthetic positives presented as a seat's words.

`seeds.jsonl` holds White's own words from 2026-09-05 as the first positives.
