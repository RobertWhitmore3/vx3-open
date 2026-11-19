// VX3 Rails — policy decision engine
// Fail-closed. Missile class never auto-fires.

import {
  Vx3ActionClass,
  Vx3Grant,
  Vx3Ownership,
  Vx3Tier,
} from "./types";

const MISSILE_CLASSES: Vx3ActionClass[] = [
  "legal_document",
  "irreversible",
  "harm_potential",
  "child_related",
];

export function isMissile(actionClass: Vx3ActionClass): boolean {
  return MISSILE_CLASSES.includes(actionClass);
}

export type PolicyDecision = "allow" | "needs_approval" | "deny";

/**
 * Core decision.
 *
 * Rules:
 * 1. Explicit "never" always wins.
 * 2. Missile class can never be auto-allowed through to fire.
 *    Session grants may cover drafting; fire is human-only.
 * 3. Valid session grant → allow (non-missile only).
 * 4. Explicit automation → allow only if not missile.
 * 5. Default → needs_approval.
 *
 * The agent that calls this owns the initiation (see OWNERSHIP.md).
 */
export function decide(
  action: string,
  actionClass: Vx3ActionClass,
  grants: Vx3Grant[],
  sessionId: string
): PolicyDecision {
  // 1. Explicit never always wins
  const never = grants.find((g) => g.action === action && g.tier === "never");
  if (never) return "deny";

  // 2. Missile class — always needs human path for the irreversible step
  if (isMissile(actionClass)) {
    // Drafting may later be covered by a session grant if desired,
    // but the fire step is never reachable via grant alone.
    return "needs_approval";
  }

  // 3. Valid session grant
  const session = grants.find(
    (g) =>
      g.action === action &&
      g.tier === "session" &&
      g.sessionId === sessionId &&
      (!g.expiresAt || new Date(g.expiresAt) > new Date())
  );
  if (session) return "allow";

  // 4. Explicit automation (non-missile only)
  const auto = grants.find(
    (g) => g.action === action && g.tier === "automation"
  );
  if (auto && !isMissile(actionClass)) return "allow";

  // 5. Default: ask
  return "needs_approval";
}

export function makeOwnership(
  agentId: string,
  initiatedBy: "agent" | "human" = "agent"
): Vx3Ownership {
  return {
    initiatedBy,
    agentId,
    responsible: true,
  };
}
