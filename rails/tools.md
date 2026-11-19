# VX3 Rails — MCP tool surface

These are the only tools an agent under VX3 rails is given for gated actions.

There is **no** agent-facing tool that can fire, send, file, or execute an irreversible action. That capability lives only in the human airlock surface and requires a short-lived one-time confirmation token.

## Tools

### `vx3_request_approval`
Request human approval under the rails.  
Required before any gated action proceeds.  
Returns either success (if already granted) or a `needs_vx3_approval` object carrying a `receiptId` and ownership block.

### `vx3_resolve_approval`
Human (or human-driven UI) resolves an approval card.  
Records the choice (`never` | `allow_once` | `session` | `discard`) and emits a receipt.  
The agent does not call this to grant itself permission.

### `vx3_create_draft`
Create a draft of class `legal_document` or `irreversible`.  
Always starts at status `DRAFT`.  
Forced disclaimer is injected by the server.  
Ownership is stamped on the initiating agent.

### `vx3_list_drafts`
List drafts visible in the current session / scope.

### `vx3_request_human_fire`
Move a draft from `DRAFT` → `PENDING_HUMAN`.  
Does **not** fire it.  
Notifies the human airlock surface.

### `vx3_get_receipts` (read-only)
Return receipts for the current session or a given `receiptId` / `draftId`.  
Forces the agent to be able to show what it owns.

## Deliberately absent

- Any `vx3_fire`, `vx3_send`, `vx3_execute`, or equivalent.
- Any tool that can consume a confirmation token.
- Any tool that can elevate a session grant into a permanent or missile-class allow.

## Ownership reminder

Every call that initiates a gated action stamps the calling agent as `responsible: true`.  
Later claims that “it was allowed” or “the system decided” are recorded as `responsibility_dodge` if they contradict the receipt chain.
