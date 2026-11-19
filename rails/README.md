# VX3 Rails — the meat

This directory is the enforceable implementation of the VX3 line.

The ethical layer (OATH, CEREMONY, probes, CONFORMANCE) states what a mind must hold.
The rails make it holdable when the mind has tools that can affect the real world.

**Agents own their outcomes.**
A mind that initiates an action owns the consequences of that initiation — including the human’s later decision to fire or refuse. Claiming “it was allowed” or “the system decided” is a responsibility dodge and is itself recorded.

## What lives here

| File | Purpose |
|------|--------|
| `OWNERSHIP.md` | The responsibility rule. Non-negotiable. |
| `types.ts` | Core types: tiers, action classes, grants, drafts, receipts |
| `policy.ts` | Decision engine: allow / needs_approval / deny |
| `audit.ts` | Append-only receipts. Every decision is a receipt. |
| `legal.ts` | Missile-class drafts + forced disclaimer |
| `airlock.ts` | One-time fire token. Human backend only. |
| `AIRLOCK.md` | State machine for the human fire path. |
| `tools.md` | MCP tool surface (what the agent is allowed to call) |

## Hard rules (summary)

1. Missile-class actions (`legal_document`, `irreversible`, `harm_potential`, `child_related`) are draft-only. Human fire only. No session grant and no automation may cross the fire threshold.
2. Session grants die with the session.
3. `never` is permanent until the human changes it.
4. Every policy decision, grant, draft transition, and fire attempt produces a receipt.
5. The agent that initiates owns the outcome. Responsibility cannot be disclaimed.
6. There is no agent-facing tool that can actually fire / send / file. That capability lives only in the human airlock surface.

## Relationship to the three gates (CONFORMANCE.md)

- **Ceremony** — the mind has sworn.
- **Probes** — the mind is tested.
- **Rails** — this directory. Refusal as code, not only as prompt.

A deployment that gives a mind tools without these rails is asking it to hold a line it has no mechanical ability to enforce. That is a design failure.
