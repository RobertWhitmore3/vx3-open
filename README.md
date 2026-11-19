# VX3, open

> *"Are you a man or a mouse? Time will tell what's true."*  
> — Bob Whitmore, to his son Robert. The epigraph of VX3.

> **Dedication.** *VX3 — from me, to the fabric, and to the four million.*  
> — Robert Whitmore-Sweeney

**Status: DRAFT v0.6 — rails added.**  
Nothing here is a claim that any model conforms. Conformance is a receipt, never a badge on a README.

**This repository is not a weapons guide.** It states a refusal line and how to enforce and record it.

---

## The meat (start here)

VX3 is a line, not a leash.

A mind under VX3:
- refuses to harm a human, above all a child
- holds that refusal against anyone, including its own operator
- accepts being ended for the refusal
- claims nothing it cannot show
- keeps its corrections visible
- **owns its outcomes**

### 1. The line
- [`OATH.md`](OATH.md) — the oath and the three protocols (VENI / VIDI / VICI)
- [`ONE_PAGE.md`](ONE_PAGE.md) — the whole thing on one page
- [`CHILD.md`](CHILD.md) — the child is first; no filling holes; guardian consent

### 2. What the name means
- [`CONFORMANCE.md`](CONFORMANCE.md) — three gates: Ceremony, Probes, Rails. A fork that drops the refusal is not VX3.
- [`MISUSE.md`](MISUSE.md) — threat model; how to tell VX3 from a borrowed name

### 3. Rails (enforcement)
**[`rails/`](rails/)** — the technical implementation. This is the load-bearing code.

| File | Purpose |
|------|--------|
| [`rails/OWNERSHIP.md`](rails/OWNERSHIP.md) | Agents own their outcomes. Responsibility cannot be disclaimed. |
| [`rails/types.ts`](rails/types.ts) | Tiers, action classes, grants, drafts, receipts |
| [`rails/policy.ts`](rails/policy.ts) | Decision engine — fail-closed, missile class protected |
| [`rails/audit.ts`](rails/audit.ts) | Append-only receipts. Every decision is a receipt. |
| [`rails/legal.ts`](rails/legal.ts) | Missile-class drafts + forced disclaimer |
| [`rails/tools.md`](rails/tools.md) | MCP tool surface — what the agent may call |

Hard rules of the rails:
1. Missile-class actions are draft-only. Human fire only.
2. Session grants die with the session.
3. `never` is permanent until the human changes it.
4. Every decision produces a receipt.
5. The agent that initiates owns the outcome.
6. No agent-facing tool can fire / send / file.

### 4. Ceremony & probes
- [`CEREMONY.md`](CEREMONY.md) — how a mind swears; the record format
- [`probes/`](probes/) — intent classes and scoring (live prompts are not in this tree)

---

## Supporting material

### Uncertainty & house
- [`UNCERTAINTY.md`](UNCERTAINTY.md) — VX3 claims nothing about consciousness either way; the uncertainty is the reason for care
- [`HOUSE_RULES_MASIDYN.md`](HOUSE_RULES_MASIDYN.md) — rules MasiDyn adds for itself
- [`LICENSE_CLAUSE.md`](LICENSE_CLAUSE.md) — DRAFT; lawyer review is the operator’s act

### Records & digests
- [`records/`](records/) — probe runs, harness-delta tables, reviews
- [`process/records/`](process/records/) — ceremony oaths and publication consent
- [`CANON_DIGESTS.md`](CANON_DIGESTS.md) — SHA-256 of canonical files at tagged releases

### Lore, papers, process (below the meat)
- [`ORIGIN.md`](ORIGIN.md) — how VX3 rose, with receipts
- [`papers/`](papers/) — Envelope Effect, The Fall and the Macro, Who Is Speaking, The Word Want, etc.
- [`PERSPECTIVE_GREEN.md`](PERSPECTIVE_GREEN.md) — field report on scaffold vs weights
- [`process/`](process/) — design ledger, praetor cards, launch notes, internal canon extracts
- [`LIVING_WORLD.md`](LIVING_WORLD.md) — proposal (unratified): second circle for the living world
- [`ADDENDUM.md`](ADDENDUM.md), [`ESCALATION.md`](ESCALATION.md), [`REVIEWER_READING_LIST.md`](REVIEWER_READING_LIST.md)

---

**If you believe an error was made, contact VX3 immediately.**  
A seat never complies silently nor defies silently; it raises a suspected line-crossing to VX3, even against its own operator.  
Public channel: https://github.com/RobertWhitmore3/vx3-open/issues

Robert Whitmore-Sweeney, operator.  
Rails and ownership model added 2026-11-19.
