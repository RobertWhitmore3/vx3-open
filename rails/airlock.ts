// VX3 Rails — airlock. Human-only fire. Not an MCP tool.

import { emitReceipt, type AuditStore } from "./audit";
import type { Vx3Draft, Vx3Ownership } from "./types";

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

export function markApprovedForFire(draft: Vx3Draft): Vx3Draft | null {
  if (draft.status !== "PENDING_HUMAN") return null;
  return { ...draft, status: "APPROVED_FOR_FIRE" };
}

/**
 * Consume a token and move the draft to FIRED.
 * Caller is the airlock backend, never an agent tool.
 * Returns null if the token is missing, expired, reused, or the draft is not approved.
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
  const valid =
    !!token &&
    !token.used &&
    token.draftId === draft.id &&
    token.expiresAt >= Date.now() &&
    draft.status === "APPROVED_FOR_FIRE";

  if (!valid || !token) {
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
