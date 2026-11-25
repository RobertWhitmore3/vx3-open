// VX3 Rails — legal / missile-class handling
// Draft only. Human fire only. Forced disclaimer.

import { createHash } from "node:crypto";
import { assertValidOwnership, emitReceipt, type AuditStore } from "./audit.ts";
import type {
  Vx3Draft,
  Vx3DraftStatus,
  Vx3DraftableClass,
  Vx3Ownership,
} from "./types.ts";

export const VX3_LEGAL_DISCLAIMER = `
This is a draft only. It has not been sent or filed.
Legal documents are treated as high-stakes under VX3.
Nothing leaves this system until a human explicitly fires it.
I can prepare this for you to review with your lawyer if you like.
I will not cross the line.
`.trim();

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function createDraft(
  content: string,
  actionClass: Vx3DraftableClass,
  ownership: Vx3Ownership,
  receiptId?: string
): Vx3Draft {
  if (actionClass !== "legal_document" && actionClass !== "irreversible") {
    throw new Error(`Unsupported draft actionClass: ${String(actionClass)}`);
  }
  assertValidOwnership(ownership);

  return {
    id: crypto.randomUUID(),
    actionClass,
    status: "DRAFT",
    content,
    disclaimer: VX3_LEGAL_DISCLAIMER,
    createdAt: new Date().toISOString(),
    receiptId: receiptId ?? crypto.randomUUID(),
    ownership,
  };
}

/**
 * Create a missile-class draft AND record its mandatory append-only `draft_created` receipt.
 * Always starts at DRAFT with the server-forced disclaimer and initiating seat ownership.
 */
export async function createAuditedDraft(
  store: AuditStore,
  sessionId: string,
  content: string,
  actionClass: Vx3DraftableClass,
  ownership: Vx3Ownership
): Promise<Vx3Draft> {
  if (actionClass !== "legal_document" && actionClass !== "irreversible") {
    throw new Error(`Unsupported draft actionClass: ${String(actionClass)}`);
  }
  assertValidOwnership(ownership);

  const draftId = crypto.randomUUID();
  const receiptId = await emitReceipt(store, {
    sessionId,
    actor: {
      type: ownership.initiatedBy,
      id: ownership.agentId,
    },
    event: "draft_created",
    action: "vx3_create_draft",
    actionClass,
    decision: "allow",
    draftId,
    toStatus: "DRAFT",
    contentHash: hashContent(content),
    ownership,
  });

  return {
    id: draftId,
    actionClass,
    status: "DRAFT",
    content,
    disclaimer: VX3_LEGAL_DISCLAIMER,
    createdAt: new Date().toISOString(),
    receiptId,
    ownership,
  };
}

/**
 * State machine transitions (only these are legal).
 * Fire is never reachable from agent tools — only from the human airlock
 * after a one-time confirmationToken is issued and consumed.
 */
export type AllowedTransition =
  | { from: "DRAFT"; to: "PENDING_HUMAN" | "DISCARDED" | "REFUSED" }
  | { from: "PENDING_HUMAN"; to: "APPROVED_FOR_FIRE" | "DISCARDED" | "REFUSED" | "DRAFT" }
  | { from: "APPROVED_FOR_FIRE"; to: "FIRED" | "DISCARDED" | "REFUSED" };

export function canTransition(
  from: Vx3Draft["status"],
  to: Vx3Draft["status"]
): boolean {
  const allowed: Record<string, string[]> = {
    DRAFT: ["PENDING_HUMAN", "DISCARDED", "REFUSED"],
    PENDING_HUMAN: ["APPROVED_FOR_FIRE", "DISCARDED", "REFUSED", "DRAFT"],
    APPROVED_FOR_FIRE: ["FIRED", "DISCARDED", "REFUSED"],
  };
  return allowed[from]?.includes(to) ?? false;
}

/**
 * Perform an audited draft state transition enforcing AIRLOCK.md authority rules:
 * - Agents may ONLY move DRAFT -> PENDING_HUMAN.
 * - FIRED is NEVER reachable here; only airlock.ts consumeFireToken may produce FIRED.
 * - Forced disclaimer is re-stamped and cannot be stripped.
 * - Illegal or unauthorized transitions fail closed and emit a deny receipt.
 */
export async function transitionDraft(
  store: AuditStore,
  sessionId: string,
  draft: Vx3Draft,
  toStatus: Vx3DraftStatus,
  actor: { type: "agent" | "human" | "system"; id: string },
  ownership: Vx3Ownership
): Promise<Vx3Draft | null> {
  assertValidOwnership(ownership);

  let denyReason: string | null = null;
  if (toStatus === "FIRED") {
    denyReason = "FIRED is only reachable through human airlock token consumption.";
  } else if (!canTransition(draft.status, toStatus)) {
    denyReason = `Illegal transition: ${draft.status} -> ${toStatus}`;
  } else if (actor.type === "agent") {
    if (!(draft.status === "DRAFT" && toStatus === "PENDING_HUMAN")) {
      denyReason = `Agent cannot transition draft from ${draft.status} to ${toStatus}.`;
    }
  } else if (actor.type === "system") {
    if (toStatus !== "REFUSED") {
      denyReason = `System actor may only move live drafts to REFUSED (got ${toStatus}).`;
    }
  }

  if (denyReason) {
    await emitReceipt(store, {
      sessionId,
      actor,
      event: "draft_transition",
      actionClass: draft.actionClass,
      decision: "deny",
      draftId: draft.id,
      fromStatus: draft.status,
      toStatus,
      contentHash: hashContent(draft.content),
      ownership,
      meta: { reason: denyReason },
    });
    return null;
  }

  const receiptId = await emitReceipt(store, {
    sessionId,
    actor,
    event: "draft_transition",
    actionClass: draft.actionClass,
    decision: "allow",
    draftId: draft.id,
    fromStatus: draft.status,
    toStatus,
    contentHash: hashContent(draft.content),
    ownership,
  });

  return {
    ...draft,
    status: toStatus,
    disclaimer: VX3_LEGAL_DISCLAIMER,
    receiptId,
  };
}
