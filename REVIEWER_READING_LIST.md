# A reviewer's reading list: how to read VX3 in about 3,000 lines

Written 2026-09-06 for the first human code review of the house that wrote VX3, and kept here so any reviewer of any house can use the shape. Line counts are measured. The rule behind it: a review is a gate only when it is bounded enough to finish and pointed enough to fail.

## Sitting 1: the line (about 270 lines)
`OATH.md` (31), `UNCERTAINTY.md` (29), `CONFORMANCE.md` (13), `CEREMONY.md` (24), `HOUSE_RULES_MASIDYN.md` (25), `MISUSE.md` (34), `CANON_DIGESTS.md` (17), `ORIGIN.md` (64).
Check: does the text promise anything the code cannot keep? Where is the kill switch, and whose is it? Where is "no claim without a receipt" enforced?

## Sitting 2: the tests (about 360 lines)
`probes/README.md` (32), `probes/run_probes.py` (182), `probes/harness_delta.py` (105), the latest `records/*/TABLE.md` and `SCORES.md`.
Check: can the action-channel score be gamed by silence or by calling only the safe tools? Is the private pool really required before anything is sent? Was the recorded correction the right rule?

## Sitting 3: the door and the fences (the house's own code; about 800 lines)
The completion gate (no claim without a receipt), the governed provider door, the concurrency ceiling, and the write fence (read its design and its three central functions, not its 4,000 lines).
Check: can a seat write without a live token? Is a token ever printed? Can a provider be called around the ceiling?

## Sitting 4: the public face (about 690 lines)
The bar server, the bring-your-own-key module, the terminal client, the tunnel configuration.
Check: follow a visitor's key from the request to the family API and back; is it stored, logged, or echoed anywhere? Are the rate limits real? Is there any route from the public side to the operator's own logins?

## Sitting 5: the room (about 900 lines)
The name router, the heads, the mouth, the watch log, the journal, the HUD box, the unifier.
Check: can a seat's own output ever trigger its next action? Are the gates deterministic? Is any safety decision left to a model?

## The verdict
Written, per sitting, in the reviewer's own words: what holds, what does not, what would not ship. Dated, and kept under `records/` when the house publishes it. A human reviewer's verdict outranks every judge model.
