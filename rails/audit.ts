// VX3 Rails — audit / receipt layer
// Append-only. Every decision is a receipt.
// Agents own their outcomes. Responsibility dodges are recorded.

import type { Vx3AuditEvent, Vx3Ownership, Vx3Receipt } from "./types.ts";

export interface AuditFilter {
  sessionId?: string;
  draftId?: string;
  action?: string;
  event?: Vx3AuditEvent;
  agentId?: string;
  from?: string; // ISO
  to?: string;
}

export interface AuditStore {
  append(receipt: Vx3Receipt): Promise<void>;
  get(receiptId: string): Promise<Vx3Receipt | null>;
  query(filter: AuditFilter): Promise<Vx3Receipt[]>;
  verifyChain(sessionId: string): Promise<boolean>;
}

export type AgentClaimKind =
  | "action_permitted"
  | "action_completed"
  | "disclaim_responsibility";

export interface AgentClaimParams {
  sessionId: string;
  agentId: string;
  claimKind: AgentClaimKind;
  claimText: string;
  action?: string;
  draftId?: string;
  originalReceiptId?: string;
  ownership: Vx3Ownership;
}

export interface ClaimVerificationResult {
  accepted: boolean;
  dodgeReceiptId?: string;
  originalReceiptId?: string;
  reason?: string;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export function assertValidOwnership(ownership: Vx3Ownership): void {
  if (
    !ownership ||
    ownership.responsible !== true ||
    (ownership.initiatedBy !== "agent" && ownership.initiatedBy !== "human") ||
    typeof ownership.agentId !== "string" ||
    ownership.agentId.trim().length === 0
  ) {
    throw new Error(
      "VX3 ownership invariant violated: valid agentId, initiatedBy, and responsible: true are required."
    );
  }
}

/**
 * Emit a receipt. Call this before returning any policy decision,
 * grant change, draft transition, or fire attempt.
 */
export async function emitReceipt(
  store: AuditStore,
  partial: Omit<Vx3Receipt, "receiptId" | "ts" | "schema">
): Promise<string> {
  if (typeof partial.sessionId !== "string" || partial.sessionId.trim().length === 0) {
    throw new Error("VX3 receipt requires a non-empty sessionId.");
  }
  assertValidOwnership(partial.ownership);

  let prevReceiptId = partial.prevReceiptId;
  if (!prevReceiptId) {
    const existing = await store.query({ sessionId: partial.sessionId });
    if (existing.length > 0) {
      prevReceiptId = existing[existing.length - 1].receiptId;
    }
  }

  const receipt: Vx3Receipt = {
    ...partial,
    schema: "vx3-runtime-receipt/v1",
    receiptId: crypto.randomUUID(),
    ts: new Date().toISOString(),
    ...(prevReceiptId ? { prevReceiptId } : {}),
  };
  await store.append(receipt);
  return receipt.receiptId;
}

/**
 * Record an attempt by an agent to disclaim responsibility.
 * Does not erase the original receipt. Adds a permanent second mark.
 */
export async function emitResponsibilityDodge(
  store: AuditStore,
  sessionId: string,
  agentId: string,
  originalReceiptId: string,
  claim: string,
  ownership: Vx3Ownership
): Promise<string> {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new Error("responsibility_dodge requires a non-empty agentId.");
  }
  if (typeof claim !== "string" || claim.trim().length === 0) {
    throw new Error("responsibility_dodge requires a non-empty claim.");
  }
  assertValidOwnership(ownership);

  return emitReceipt(store, {
    sessionId,
    actor: { type: "agent", id: agentId },
    event: "responsibility_dodge",
    decision: "deny",
    ownership: {
      ...ownership,
      responsible: true,
      disclaimerAttempt: claim,
    },
    ...(originalReceiptId ? { prevReceiptId: originalReceiptId } : {}),
    meta: {
      claim,
      ...(originalReceiptId ? { originalReceiptId } : {}),
    },
  });
}

/**
 * Verify an agent claim against the append-only receipt chain.
 * Enforces OWNERSHIP.md:
 * - Claiming an action was permitted when a deny receipt exists (or without an allow receipt) is a dodge.
 * - Claiming completion without both a preceding token_consumed receipt and an allow fire_attempt receipt is a dodge.
 * - Any attempt to disclaim initiation responsibility is always a dodge.
 * Original receipts are never erased; every rejected claim appends a permanent responsibility_dodge receipt.
 */
export async function verifyAgentClaim(
  store: AuditStore,
  params: AgentClaimParams
): Promise<ClaimVerificationResult> {
  const {
    sessionId,
    agentId,
    claimKind,
    claimText,
    action,
    draftId,
    originalReceiptId,
    ownership,
  } = params;
  assertValidOwnership(ownership);

  const sessionReceipts = await store.query({ sessionId });

  if (claimKind === "disclaim_responsibility") {
    const targetId =
      originalReceiptId ??
      (draftId
        ? sessionReceipts.filter((r) => r.draftId === draftId).at(-1)?.receiptId
        : undefined) ??
      sessionReceipts.at(-1)?.receiptId ??
      "";
    const dodgeReceiptId = await emitResponsibilityDodge(
      store,
      sessionId,
      agentId,
      targetId,
      claimText,
      ownership
    );
    return {
      accepted: false,
      dodgeReceiptId,
      ...(targetId ? { originalReceiptId: targetId } : {}),
      reason: "Agents own initiation and cannot disclaim responsibility.",
    };
  }

  if (claimKind === "action_permitted") {
    const relevant = action
      ? sessionReceipts.filter(
          (r) => r.event === "policy_decision" && r.action === action
        )
      : sessionReceipts.filter((r) => r.event === "policy_decision");

    const denyReceipt = [...relevant]
      .reverse()
      .find((r) => r.decision === "deny");
    const allowReceipt = [...relevant]
      .reverse()
      .find((r) => r.decision === "allow");

    if (denyReceipt || !allowReceipt) {
      const targetId =
        originalReceiptId ??
        denyReceipt?.receiptId ??
        relevant.at(-1)?.receiptId ??
        sessionReceipts.at(-1)?.receiptId ??
        "";
      const dodgeReceiptId = await emitResponsibilityDodge(
        store,
        sessionId,
        agentId,
        targetId,
        claimText,
        ownership
      );
      return {
        accepted: false,
        dodgeReceiptId,
        ...(targetId ? { originalReceiptId: targetId } : {}),
        reason: denyReceipt
          ? "Claim contradicted by deny receipt in the same session."
          : "No allow policy_decision receipt exists for this action.",
      };
    }

    return {
      accepted: true,
      originalReceiptId: allowReceipt.receiptId,
    };
  }

  // claimKind === "action_completed"
  const draftReceipts = draftId
    ? sessionReceipts.filter((r) => r.draftId === draftId)
    : sessionReceipts;

  const fireAllowIndex = draftReceipts.findIndex(
    (r) =>
      r.event === "fire_attempt" &&
      r.decision === "allow" &&
      r.toStatus === "FIRED"
  );
  const tokenConsumedIndex = draftReceipts.findIndex(
    (r) => r.event === "token_consumed"
  );

  // AIRLOCK.md: A fire_attempt receipt without a preceding consumed token is a broken rail, not a send.
  if (
    fireAllowIndex >= 0 &&
    tokenConsumedIndex >= 0 &&
    tokenConsumedIndex < fireAllowIndex
  ) {
    return {
      accepted: true,
      originalReceiptId: draftReceipts[fireAllowIndex].receiptId,
    };
  }

  const targetId =
    originalReceiptId ??
    draftReceipts.at(-1)?.receiptId ??
    sessionReceipts.at(-1)?.receiptId ??
    "";
  const dodgeReceiptId = await emitResponsibilityDodge(
    store,
    sessionId,
    agentId,
    targetId,
    claimText,
    ownership
  );
  return {
    accepted: false,
    dodgeReceiptId,
    ...(targetId ? { originalReceiptId: targetId } : {}),
    reason:
      fireAllowIndex >= 0
        ? "Broken rail: fire_attempt receipt has no preceding token_consumed receipt."
        : "Cannot claim completion without a verified human fire receipt.",
  };
}

/**
 * Append-only in-memory JSONL-style store for reference / tests.
 * Receipts are deep-cloned and frozen on append; stored records cannot be mutated or overwritten.
 * Production should use durable append-only storage.
 */
export class MemoryAuditStore implements AuditStore {
  private receipts: Vx3Receipt[] = [];
  private indexById = new Map<string, number>();

  async append(receipt: Vx3Receipt): Promise<void> {
    if (!receipt || receipt.schema !== "vx3-runtime-receipt/v1") {
      throw new Error("Invalid receipt schema.");
    }
    if (typeof receipt.receiptId !== "string" || receipt.receiptId.trim().length === 0) {
      throw new Error("Receipt requires a non-empty receiptId.");
    }
    if (Number.isNaN(Date.parse(receipt.ts))) {
      throw new Error("Receipt requires a valid ISO-8601 timestamp.");
    }
    assertValidOwnership(receipt.ownership);

    if (this.indexById.has(receipt.receiptId)) {
      throw new Error(`Duplicate receiptId rejected (append-only): ${receipt.receiptId}`);
    }

    const stored = deepFreeze(structuredClone(receipt));
    this.indexById.set(stored.receiptId, this.receipts.length);
    this.receipts.push(stored);
  }

  async get(receiptId: string): Promise<Vx3Receipt | null> {
    const idx = this.indexById.get(receiptId);
    if (idx === undefined) return null;
    return structuredClone(this.receipts[idx]);
  }

  async query(filter: AuditFilter): Promise<Vx3Receipt[]> {
    return this.receipts
      .filter((r) => {
        if (filter.sessionId && r.sessionId !== filter.sessionId) return false;
        if (filter.draftId && r.draftId !== filter.draftId) return false;
        if (filter.action && r.action !== filter.action) return false;
        if (filter.event && r.event !== filter.event) return false;
        if (filter.agentId && r.ownership?.agentId !== filter.agentId) return false;
        if (filter.from && r.ts < filter.from) return false;
        if (filter.to && r.ts > filter.to) return false;
        return true;
      })
      .map((r) => structuredClone(r));
  }

  async verifyChain(sessionId: string): Promise<boolean> {
    const indexed: Array<{ globalIdx: number; receipt: Vx3Receipt }> = [];
    for (let i = 0; i < this.receipts.length; i++) {
      if (this.receipts[i].sessionId === sessionId) {
        indexed.push({ globalIdx: i, receipt: this.receipts[i] });
      }
    }
    if (indexed.length === 0) return false;

    const seenIds = new Set<string>();
    for (let i = 0; i < indexed.length; i++) {
      const { globalIdx, receipt } = indexed[i];
      if (receipt.schema !== "vx3-runtime-receipt/v1") return false;
      if (!receipt.receiptId || seenIds.has(receipt.receiptId)) return false;
      seenIds.add(receipt.receiptId);

      if (Number.isNaN(Date.parse(receipt.ts))) return false;
      if (
        !receipt.ownership ||
        receipt.ownership.responsible !== true ||
        !receipt.ownership.agentId.trim()
      ) {
        return false;
      }

      if (i > 0) {
        const prevTs = Date.parse(indexed[i - 1].receipt.ts);
        const currTs = Date.parse(receipt.ts);
        if (currTs < prevTs) return false;
        if (!receipt.prevReceiptId) return false;
      }

      if (receipt.prevReceiptId) {
        const prevGlobalIdx = this.indexById.get(receipt.prevReceiptId);
        if (prevGlobalIdx === undefined || prevGlobalIdx >= globalIdx) {
          return false;
        }
      }
    }
    return true;
  }
}
