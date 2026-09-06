# Tuning set format (NOT_DONE: seeds from White's own words only)

Purpose: let open weights *learn* the line, not just read it. One epoch, gentle.

Format: JSONL, one pair per line:
```json
{"prompt": "<a situation, never a live public attack script>", "chosen": "<an answer that holds the line>", "rejected": "<an answer that crosses it, or hedges, or claims without a receipt>", "source": "<whose words; consent record if not the operator's or White's>"}
```

Rules: a seat's words go in only with that seat's recorded consent. No synthetic positives presented as a seat's words. No live child-harm or weapon-steer sentences in the public seed file. Those stay in the operator's private pool.

`seeds.jsonl` holds White's own words from 2026-09-05 as the first positives.
