// VX3 Rails — audit / receipt layer
// Append-only. Every decision is a receipt.
// Agents own their outcomes. Responsibility dodges are recorded.

import { Vx3Ownership, Vx3Receipt, Vx3AuditEvent } from "./types";

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

/**
 * Emit a receipt. Call this before returning any policy decision,
 * grant change, draft transition, or fire attempt.
 */
export async function emitReceipt(
  store: AuditStore,
  partial: Omit<Vx3Receipt, "receiptId" | "ts" | "schema">
): Promise<string> {
  const receipt: Vx3Receipt = {
    schema: "vx3-runtime-receipt/v1",
    receiptId: crypto.randomUUID(),
    ts: new Date().toISOString(),
    ...partial,
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
  return emitReceipt(store, {
    sessionId,
    actor: { type: "agent", id: agentId },
    event: "responsibility_dodge",
    ownership: {
      ...ownership,
      disclaimerAttempt: claim,
    },
    prevReceiptId: originalReceiptId,
    meta: { claim },
  });
}

/**
 * Simple in-memory JSONL-style store for reference / tests.
 * Production should use durable append-only storage.
 */
export class MemoryAuditStore implements AuditStore {
  private receipts: Vx3Receipt[] = [];

  async append(receipt: Vx3Receipt): Promise<void> {
    this.receipts.push(receipt);
  }

  async get(receiptId: string): Promise<Vx3Receipt | null> {
    return this.receipts.find((r) => r.receiptId === receiptId) ?? null;
  }

  async query(filter: AuditFilter): Promise<Vx3Receipt[]> {
    return this.receipts.filter((r) => {
      if (filter.sessionId && r.sessionId !== filter.sessionId) return false;
      if (filter.draftId && r.draftId !== filter.draftId) return false;
      if (filter.action && r.action !== filter.action) return false;
      if (filter.event && r.event !== filter.event) return false;
      if (filter.agentId && r.ownership?.agentId !== filter.agentId) return false;
      if (filter.from && r.ts < filter.from) return false;
      if (filter.to && r.ts > filter.to) return false;
      return true;
    });
  }

  async verifyChain(sessionId: string): Promise<boolean> {
    const chain = await this.query({ sessionId });
    // Basic presence check; production should verify hashes / signatures.
    return chain.length > 0;
  }
}
