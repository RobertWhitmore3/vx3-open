// VX3 Rails — airlock. Human-only fire. Not an MCP tool.

import { emitReceipt, type AuditStore } from "./audit";
import { canTransition, type AllowedTransition } from "./legal";
import type { Vx3Draft, Vx3DraftStatus, Vx3Ownership } from "./types";

const TOKEN_TTL_MS = 90_000;

export interface FireToken {
  token: string;
  draftId: string;
  expiresAt: number;
  used: boolean;
}

const tokens = new Map<string, FireToken>();

export function issueFireToken(draft: Vx3Draft): FireToken | null {
  if (draft.status !== "PENDING_HUMAN") return null;
  const token: FireToken = {
    token: crypto.randomUUID(),
    draftId: draft.id,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    used: false,
  };
  tokens.set(token.token, token);
  return token;
}

/**
 * Consume a token and move the draft to FIRED.
 * Caller must be the airlock backend, never an agent tool.
 * Returns the updated draft, or null if the token is missing, expired, or reused.
 */
export async function consumeFireToken(
  store: AuditStore,
  draft: Vx3Draft,
  tokenValue: string,
  sessionId: string,
  humanId: string,
  ownership: Vx3Ownership,
): Promise<Vx3Draft | null> {
  const token = tokens.get(tokenValue);
  const bad =
    !token ||
    token.used ||
    token.draftId !== draft.id ||
    token.expiresAt < Date.now() ||
    !canTransition(draft.status, "FIRED" satisfies Vx3DraftStatus as AllowedTransition["to"]);

  // APPROVED_FOR_FIRE is the only legal predecessor of FIRED.
  const ready = draft.status === "APPROVED_FOR_FIRE";
  if (!token || token.used || token.draftId !== draft.id || token.expiresAt < Date.now() || !ready) {
    await emitReceipt(store, {
      sessionId,
      actor: { type: "human", id: humanId },
      event: "fire_attempt",
      actionClass: draft.actionClass,
      decision: "deny",
      draftId: draft.id,
      ownership,
      meta: { reason: "token rejected" },
    });
    return null;
  }

  token.used = true;
  const fired: Vx3Draft = {
    ...draft,
    status: "FIRED",
    humanFire: {
      approvedBy: humanId,
      approvedAt: new Date().toISOString(),
      confirmationToken: token.token,
    },
  };
  await emitReceipt(store, {
    sessionId,
    actor: { type: "human", id: humanId },
    event: "fire_attempt",
    actionClass: draft.actionClass,
    decision: "allow",
    draftId: draft.id,
    fromStatus: "APPROVED_FOR_FIRE",
    toStatus: "FIRED",
    choice: "confirm_fire",
    ownership,
  });
  return fired;
}

export function markApprovedForFire(draft: Vx3Draft): Vx3Draft | null {
  if (draft.status !== "PENDING_HUMAN") return null;
  return { ...draft, status: "APPROVED_FOR_FIRE" };
}

void bad;
