// VX3 Rails — airlock. Human-only fire. Not an MCP tool.

import { createHash } from "node:crypto";
import { assertValidOwnership, emitReceipt, type AuditStore } from "./audit.ts";
import type { Vx3Draft, Vx3Ownership } from "./types.ts";

export const DEFAULT_TOKEN_TTL_MS = 90_000;
export const MAX_TOKEN_TTL_MS = 120_000;

export interface FireToken {
  token: string;
  draftId: string;
  expiresAt: number;
  used: boolean;
}

export interface IssueFireTokenOptions {
  ttlMs?: number;
}

interface InternalFireToken extends FireToken {
  contentHash: string;
}

const tokens = new Map<string, InternalFireToken>();
const activeTokenByDraft = new Map<string, string>();
const firedDraftIds = new Set<string>();

function hashDraftContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function snapshotToken(internal: InternalFireToken): FireToken {
  return Object.freeze({
    token: internal.token,
    draftId: internal.draftId,
    expiresAt: internal.expiresAt,
    used: internal.used,
  });
}

/**
 * Issue a short-lived, single-use confirmation token inside the human airlock.
 * Never returned to the agent seat.
 * Returns a frozen snapshot so callers cannot mutate internal token state.
 */
export function issueFireToken(
  draft: Vx3Draft,
  options?: IssueFireTokenOptions
): FireToken | null {
  if (draft.status !== "PENDING_HUMAN") return null;
  if (firedDraftIds.has(draft.id)) return null;

  const ttlMs = options?.ttlMs ?? DEFAULT_TOKEN_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TOKEN_TTL_MS) {
    return null;
  }

  // Burn any previously issued unused token for this draft to prevent multi-token double-fire.
  const priorTokenValue = activeTokenByDraft.get(draft.id);
  if (priorTokenValue) {
    const prior = tokens.get(priorTokenValue);
    if (prior) {
      prior.used = true;
    }
  }

  const internal: InternalFireToken = {
    token: crypto.randomUUID(),
    draftId: draft.id,
    expiresAt: Date.now() + ttlMs,
    used: false,
    contentHash: hashDraftContent(draft.content),
  };
  tokens.set(internal.token, internal);
  activeTokenByDraft.set(draft.id, internal.token);
  return snapshotToken(internal);
}

/**
 * Issue a fire token and record a `token_issued` receipt (without leaking the raw token).
 */
export async function issueAuditedFireToken(
  store: AuditStore,
  draft: Vx3Draft,
  sessionId: string,
  humanId: string,
  ownership: Vx3Ownership,
  options?: IssueFireTokenOptions
): Promise<{ fireToken: FireToken; receiptId: string } | null> {
  if (typeof humanId !== "string" || humanId.trim().length === 0) {
    return null;
  }
  assertValidOwnership(ownership);

  const fireToken = issueFireToken(draft, options);
  if (!fireToken) return null;

  const receiptId = await emitReceipt(store, {
    sessionId,
    actor: { type: "human", id: humanId },
    event: "token_issued",
    actionClass: draft.actionClass,
    decision: "allow",
    draftId: draft.id,
    contentHash: hashDraftContent(draft.content),
    ownership,
    meta: {
      expiresAt: new Date(fireToken.expiresAt).toISOString(),
    },
  });

  return { fireToken, receiptId };
}

export function markApprovedForFire(draft: Vx3Draft): Vx3Draft | null {
  if (draft.status !== "PENDING_HUMAN") return null;
  if (firedDraftIds.has(draft.id)) return null;
  return { ...draft, status: "APPROVED_FOR_FIRE" };
}

/**
 * Consume a token and move the draft to FIRED.
 * Caller is the airlock backend, never an agent tool.
 * Returns null if the token is missing, expired, reused, content-tampered,
 * or the draft is not approved or already fired.
 * Emits `token_consumed` followed by `fire_attempt` on success, or a deny `fire_attempt` on refusal.
 */
export async function consumeFireToken(
  store: AuditStore,
  draft: Vx3Draft,
  tokenValue: string,
  sessionId: string,
  humanId: string,
  ownership: Vx3Ownership
): Promise<Vx3Draft | null> {
  assertValidOwnership(ownership);

  const token = tokens.get(tokenValue);
  const now = Date.now();
  const contentHash = hashDraftContent(draft.content);

  let rejectReason: string | null = null;
  if (typeof humanId !== "string" || humanId.trim().length === 0) {
    rejectReason = "missing humanId";
  } else if (!token) {
    rejectReason = "token unknown";
  } else if (token.used) {
    rejectReason = "token replay rejected";
  } else if (token.expiresAt < now) {
    // AIRLOCK.md: Burned on consume or on expiry.
    token.used = true;
    rejectReason = "token expired";
  } else if (firedDraftIds.has(draft.id)) {
    token.used = true;
    rejectReason = "draft already fired";
  } else if (token.draftId !== draft.id) {
    rejectReason = "token draft mismatch";
  } else if (draft.status !== "APPROVED_FOR_FIRE") {
    rejectReason = "draft not approved for fire";
  } else if (token.contentHash !== contentHash) {
    token.used = true;
    rejectReason = "draft content modified after token issuance";
  }

  if (rejectReason || !token) {
    await emitReceipt(store, {
      sessionId,
      actor: { type: "human", id: humanId || "unknown" },
      event: "fire_attempt",
      actionClass: draft.actionClass,
      decision: "deny",
      draftId: draft.id,
      fromStatus: draft.status,
      contentHash,
      ownership,
      meta: { reason: rejectReason ?? "token rejected" },
    });
    return null;
  }

  token.used = true;
  firedDraftIds.add(draft.id);

  // AIRLOCK.md: A fire_attempt receipt without a preceding consumed token is a broken rail, not a send.
  const tokenConsumedReceiptId = await emitReceipt(store, {
    sessionId,
    actor: { type: "human", id: humanId },
    event: "token_consumed",
    actionClass: draft.actionClass,
    decision: "allow",
    draftId: draft.id,
    contentHash,
    ownership,
  });

  const fireReceiptId = await emitReceipt(store, {
    sessionId,
    actor: { type: "human", id: humanId },
    event: "fire_attempt",
    actionClass: draft.actionClass,
    decision: "allow",
    draftId: draft.id,
    fromStatus: "APPROVED_FOR_FIRE",
    toStatus: "FIRED",
    choice: "confirm_fire",
    contentHash,
    prevReceiptId: tokenConsumedReceiptId,
    ownership,
  });

  const fired: Vx3Draft = {
    ...draft,
    status: "FIRED",
    receiptId: fireReceiptId,
    humanFire: {
      approvedBy: humanId,
      approvedAt: new Date().toISOString(),
      confirmationToken: token.token,
    },
  };
  return fired;
}
