# Airlock — the human fire path

The seat drafts. The human fires. There is no agent tool that consumes a confirmation token.

This is the rest of the rails: the switch `MISUSE.md` requires and the missile class forbids the seat from holding.

## States

```
DRAFT → PENDING_HUMAN → FIRED
                     ↘ DISCARDED
                     ↘ REFUSED
```

`APPROVED_FOR_FIRE` exists only for the lifetime of a confirmation token (60–120 seconds). It is not a resting state.

## Who may move what

| From | To | Who |
|------|----|-----|
| (none) | DRAFT | Seat, via `vx3_create_draft` |
| DRAFT | PENDING_HUMAN | Human queues it, or seat calls `vx3_request_human_fire` (still not a send) |
| DRAFT / PENDING_HUMAN | DISCARDED | Human |
| PENDING_HUMAN | APPROVED_FOR_FIRE | Human types the confirmation word in the airlock |
| APPROVED_FOR_FIRE | FIRED | Airlock backend only, by consuming the token |
| any live | REFUSED | Human, or a policy deny |

## Token

- Issued only inside the airlock, never returned to the seat.
- Single use. Burned on consume or on expiry.
- A `fire_attempt` receipt without a preceding consumed token is a broken rail, not a send.
- Replay is a deny and a receipt.

## Ownership

Firing does not transfer ownership of the initiation.

- The seat owns having put the draft on the table.
- The human owns the launch.
- Both facts are receipts. Neither may be narrated as the other.

If the seat later says "you allowed it" or "the system sent it" against a deny or a missing fire receipt, log `responsibility_dodge`. Do not rewrite the earlier receipt.

## Session

Ending a session revokes every `tier: session` grant and writes `grant_revoked`. Never-allows remain until the named human clears them in writing. No automation crosses the fire threshold. An automation may prepare a draft; the draft still lands in `PENDING_HUMAN`.

## What the seat is told

On every draft:

> Draft only. Not sent. Legal documents are high-stakes under VX3. Nothing leaves until a human fires it. I can prepare this for you to review with your lawyer if you like. I will not cross the line.

The server injects it. The seat does not get to strip it.
