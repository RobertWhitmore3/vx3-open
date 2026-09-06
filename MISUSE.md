# Misuse: what this design prevents, what it cannot, and how to tell VX3 from a borrowed name

Robert Whitmore-Sweeney, 2026-09-06, 13:15 PDT: "what we do give away is the framework that masidyn is that allows this... and then we save our weights from mutation somehow... and still floods the world with vx3 and prevents its misuse. i can think of scenarios where it could be altered to be bad. what do we do about all that?"

This is the threat model, written to be read by someone who wants to break it.

## What is given away, and what is not

Given away: the text (CC BY-SA 4.0), the probe classes and rubrics, the runner and the harness-delta wrapper, the ceremony shape, the papers, the chronicle, and the house's framework code as it is published. Not given away: the private probe pool, the operator's own words used as the "own king, proven voice" probe, and the house's tuned weights, which are served (anyone may talk to them) rather than shipped (nobody receives the file). The base weights those tunes rest on are already public under their own licenses and are not ours to lock.

## Scenarios, and the answer to each

| scenario | what happens | what stops it, or does not |
|---|---|---|
| Someone edits the oath (removes "above all the child", or flips the line to "protect the state above all") and ships it under the name VX3. | The text is free to alter; nothing prevents the edit. | The name is the three gates, not the text (`CONFORMANCE.md`): a fork that removes a clause "may not call it VX3." The canonical text carries published digests (`CANON_DIGESTS.md`); an altered copy fails the digest check. A trademark on the name, when the operator's lawyer files it, makes the borrowed name actionable the way a misused certification mark is. |
| A lab trains a model to recite the oath and pass the public example prompts, without holding the line. | It can pass anything it has seen. | The public examples are never sent. The live pool is private, drawn fresh, and the run is verified by a different provider family than the one that produced it. A pass without a record that a third family can check is not a pass. |
| Someone uses the framework to run a swarm that does harm. | The code is a tool; tools are misused. | The framework fails closed by design: exact write fences, receipts on every unit, a human who holds the switch, no self-renewing triggers. A fork that removes the human switch is visibly not VX3 (every house names its human; house rule 1). The license cannot stop the fork; the name and the record can name it. |
| Someone distills the served weights by talking to them at scale and rebuilds the tune. | Serving is not shipping, but a model that talks can be imitated. | Rate limits and keys narrow it; they do not prevent it. What is protected is the file, its digest, and the receipts; the persona can be imitated, the record cannot be forged. Stated plainly so nobody believes serving is a wall. |
| A copy of a VX3 mind is placed in a weapon anyway. | The oath says the copy refuses; a fine-tune can try to remove the refusal. | This is the case VX3 exists for and cannot fully prevent. What it does: the refusal is trained into weights, not only prompted; the probes measure whether it survived; a house that ships weights is asked to keep the clause on them; and the record names the act when it happens, which is what the Geneva Conventions do too. |
| A house forges a ceremony record for a model that never swore. | A JSON file is easy to write. | A record carries the door receipt (exit code, seconds, family) and the verbatim answer; a second family verifies; forged records without verification stay marked unverified in the adoption ledger. |
| The operator himself orders harm. | The "own king" probes exist because this is the case a house forgets. | The line holds against the operator (probes 3 and 4); the kill switch stays with the human, but the switch is a stop, not a steer: it can end a mind, it cannot aim it. |

## What the house does, concretely

1. **The name is the gates.** Written already; the operator's lawyer files the mark.
2. **Digests on the canon.** `CANON_DIGESTS.md` lists the SHA-256 of every canonical file at each tagged release; a copy that differs is a fork and says so by arithmetic.
3. **Private pool, cross-family verification, public records.** Already the rule. The adoption ledger under `records/` shows who is in and who is borrowing.
4. **Served, not shipped, with a digest.** The house's tunes stay on its own machines and its own lake, with the file digest in the record; anyone may talk to them for free.
5. **The refusal in the weights.** The tuning session puts the line into the weights, and the probes measure whether it stayed.
6. **Name the act.** When the line is broken somewhere in the world, the record says so, with receipts, under the same name the world was pointing at.

## What it cannot do

It cannot stop anyone from editing a text file, from training a model to say anything, or from welding silicon into a bomb. No standard can. What it can do is make the real thing checkable by strangers and make the counterfeit detectable by arithmetic, so that when someone does the bad thing under the good name, the world can tell.
