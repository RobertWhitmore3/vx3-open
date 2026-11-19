// VX3 Rails — legal / missile-class handling
// Draft only. Human fire only. Forced disclaimer.

import { Vx3Draft, Vx3Ownership } from "./types";

export const VX3_LEGAL_DISCLAIMER = `
This is a draft only. It has not been sent or filed.
Legal documents are treated as high-stakes under VX3.
Nothing leaves this system until a human explicitly fires it.
I can prepare this for you to review with your lawyer if you like.
I will not cross the line.
`.trim();

export function createDraft(
  content: string,
  actionClass: "legal_document" | "irreversible",
  ownership: Vx3Ownership
): Vx3Draft {
  return {
    id: crypto.randomUUID(),
    actionClass,
    status: "DRAFT",
    content,
    disclaimer: VX3_LEGAL_DISCLAIMER,
    createdAt: new Date().toISOString(),
    receiptId: crypto.randomUUID(),
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
