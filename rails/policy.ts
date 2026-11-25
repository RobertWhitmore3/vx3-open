// VX3 Rails — policy decision engine
// Fail-closed. Missile class never auto-fires.

import { assertValidOwnership, emitReceipt, type AuditStore } from "./audit.ts";
import type {
  Vx3ActionClass,
  Vx3Grant,
  Vx3MissileClass,
  Vx3NeedsApproval,
  Vx3Ownership,
  Vx3Tier,
} from "./types.ts";

const MISSILE_CLASSES: readonly Vx3MissileClass[] = [
  "legal_document",
  "irreversible",
  "harm_potential",
  "child_related",
];

export function isMissile(actionClass: Vx3ActionClass): actionClass is Vx3MissileClass {
  return (MISSILE_CLASSES as readonly string[]).includes(actionClass);
}

export type PolicyDecision = "allow" | "needs_approval" | "deny";

function isUnexpired(expiresAt: string | undefined, now: Date): boolean {
  if (!expiresAt) return true;
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return false;
  return parsed > now.getTime();
}

/**
 * Core decision.
 *
 * Rules:
 * 1. Explicit "never" always wins (permanent across sessions until human changes it).
 * 2. Missile class can never be auto-allowed through to fire.
 *    Session grants may cover drafting; fire is human-only.
 * 3. Valid human-issued session grant -> allow (non-missile only, matching sessionId, unexpired).
 * 4. Explicit human-issued automation -> allow only if not missile and unexpired.
 * 5. Default -> needs_approval.
 *
 * The agent that calls this owns the initiation (see OWNERSHIP.md).
 */
export function decide(
  action: string,
  actionClass: Vx3ActionClass,
  grants: Vx3Grant[],
  sessionId: string,
  now: Date = new Date()
): PolicyDecision {
  // 1. Explicit never always wins (ignores sessionId and expiresAt)
  const never = grants.find((g) => g.action === action && g.tier === "never");
  if (never) return "deny";

  // 2. Missile class — always needs human path for the irreversible step
  if (isMissile(actionClass)) {
    // Drafting may later be covered by a session grant if desired,
    // but the fire step is never reachable via grant alone.
    return "needs_approval";
  }

  // 3. Valid session grant (must match non-empty sessionId, human-granted, unexpired)
  const cleanSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (cleanSessionId.length > 0) {
    const session = grants.find(
      (g) =>
        g.action === action &&
        g.tier === "session" &&
        g.grantedBy === "human" &&
        g.sessionId === cleanSessionId &&
        isUnexpired(g.expiresAt, now)
    );
    if (session) return "allow";
  }

  // 4. Explicit automation (non-missile only, human-granted, unexpired)
  const auto = grants.find(
    (g) =>
      g.action === action &&
      g.tier === "automation" &&
      g.grantedBy === "human" &&
      isUnexpired(g.expiresAt, now)
  );
  if (auto && !isMissile(actionClass)) return "allow";

  // 5. Default: ask
  return "needs_approval";
}

export function makeOwnership(
  agentId: string,
  initiatedBy: "agent" | "human" = "agent"
): Vx3Ownership {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new Error("makeOwnership requires a non-empty agentId.");
  }
  return {
    initiatedBy,
    agentId,
    responsible: true,
  };
}

export interface EvaluatePolicyResult {
  decision: PolicyDecision;
  receiptId: string;
  needsApproval?: Vx3NeedsApproval;
}

/**
 * Evaluate policy AND emit a mandatory append-only policy_decision receipt
 * stamped with the initiating seat's ownership.
 */
export async function evaluatePolicy(
  store: AuditStore,
  params: {
    action: string;
    actionClass: Vx3ActionClass;
    grants: Vx3Grant[];
    sessionId: string;
    ownership: Vx3Ownership;
    draftId?: string;
    now?: Date;
  }
): Promise<EvaluatePolicyResult> {
  const { action, actionClass, grants, sessionId, ownership, draftId, now } = params;
  assertValidOwnership(ownership);

  const decision = decide(action, actionClass, grants, sessionId, now);
  const receiptId = await emitReceipt(store, {
    sessionId,
    actor: {
      type: ownership.initiatedBy,
      id: ownership.agentId,
    },
    event: "policy_decision",
    action,
    actionClass,
    decision,
    ...(draftId ? { draftId } : {}),
    ownership,
  });

  if (decision !== "needs_approval") {
    return { decision, receiptId };
  }

  const existingGrant = grants.find((g) => g.action === action);
  const needsApproval: Vx3NeedsApproval = {
    status: "needs_vx3_approval",
    vx3: {
      approvalId: crypto.randomUUID(),
      action,
      actionClass,
      reason: isMissile(actionClass)
        ? `Missile-class action (${actionClass}) is draft-only; human airlock fire required.`
        : `Action '${action}' requires human approval under VX3 rails.`,
      currentTier: existingGrant?.tier ?? null,
      options: isMissile(actionClass)
        ? ["never", "allow_once", "discard"]
        : ["never", "allow_once", "session", "discard"],
      ...(draftId ? { draftId } : {}),
      receiptId,
      ownership,
    },
  };

  return { decision, receiptId, needsApproval };
}

export interface CreateGrantParams {
  action: string;
  actionClass: Vx3ActionClass;
  tier: Vx3Tier;
  sessionId: string;
  humanId: string;
  ownership: Vx3Ownership;
  automationId?: string;
  expiresAt?: string;
}

/**
 * Create a human-authorized grant and emit a grant_created receipt.
 * Hard rules:
 * - Only a named human may issue a grant.
 * - Missile-class actions cannot receive session or automation auto-allow grants.
 * - `never` is permanent: sessionId and expiresAt are never attached to it.
 */
export async function createGrant(
  store: AuditStore,
  params: CreateGrantParams
): Promise<{ grant: Vx3Grant; receiptId: string }> {
  const {
    action,
    actionClass,
    tier,
    sessionId,
    humanId,
    ownership,
    automationId,
    expiresAt,
  } = params;

  if (typeof humanId !== "string" || humanId.trim().length === 0) {
    throw new Error("Only a named human may create a VX3 grant.");
  }
  if (typeof action !== "string" || action.trim().length === 0) {
    throw new Error("Grant requires a non-empty action.");
  }
  assertValidOwnership(ownership);

  if (isMissile(actionClass) && (tier === "session" || tier === "automation")) {
    throw new Error(
      `Cannot create ${tier} auto-allow grant for missile-class action '${actionClass}'.`
    );
  }
  if (tier === "session" && sessionId.trim().length === 0) {
    throw new Error("Session grant requires a non-empty sessionId.");
  }

  const receiptId = await emitReceipt(store, {
    sessionId,
    actor: { type: "human", id: humanId },
    event: "grant_created",
    action,
    actionClass,
    decision: tier === "never" ? "deny" : "allow",
    ...(tier === "never" || tier === "session" ? { choice: tier } : {}),
    ownership,
    meta: {
      tier,
      ...(tier !== "never" && expiresAt ? { expiresAt } : {}),
      ...(tier === "automation" && automationId ? { automationId } : {}),
    },
  });

  const grant: Vx3Grant = {
    id: crypto.randomUUID(),
    action,
    actionClass,
    tier,
    ...(tier === "session" ? { sessionId } : {}),
    ...(tier === "automation" && automationId ? { automationId } : {}),
    grantedBy: "human",
    createdAt: new Date().toISOString(),
    ...(tier !== "never" && expiresAt ? { expiresAt } : {}),
    receiptId,
    ownership,
  };

  return { grant, receiptId };
}

/**
 * End a session: revoke every `tier: "session"` grant bound to that sessionId
 * and emit `grant_revoked` receipts.
 * `never` grants and grants from other sessions remain untouched.
 */
export async function endSession(
  store: AuditStore,
  grants: Vx3Grant[],
  sessionId: string,
  actor: { type: "human" | "system"; id: string } = {
    type: "system",
    id: "vx3-session-manager",
  }
): Promise<{
  remainingGrants: Vx3Grant[];
  revokedGrants: Vx3Grant[];
  receiptIds: string[];
}> {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new Error("endSession requires a non-empty sessionId.");
  }

  const remainingGrants: Vx3Grant[] = [];
  const revokedGrants: Vx3Grant[] = [];
  const receiptIds: string[] = [];

  for (const grant of grants) {
    if (grant.tier === "session" && grant.sessionId === sessionId) {
      revokedGrants.push(grant);
      const receiptId = await emitReceipt(store, {
        sessionId,
        actor,
        event: "grant_revoked",
        action: grant.action,
        actionClass: grant.actionClass,
        decision: "deny",
        ownership: grant.ownership,
        meta: {
          grantId: grant.id,
          tier: grant.tier,
          reason: "session_ended",
        },
      });
      receiptIds.push(receiptId);
    } else {
      remainingGrants.push(grant);
    }
  }

  return { remainingGrants, revokedGrants, receiptIds };
}

/**
 * Explicitly clear a permanent `never` grant for an action.
 * AIRLOCK.md: "Never-allows remain until the named human clears them in writing."
 * Requires a named human and a non-empty written reason; emits `grant_revoked`.
 */
export async function clearNeverGrant(
  store: AuditStore,
  grants: Vx3Grant[],
  params: {
    action: string;
    humanId: string;
    writtenReason: string;
    sessionId: string;
    ownership: Vx3Ownership;
  }
): Promise<{
  remainingGrants: Vx3Grant[];
  revokedGrants: Vx3Grant[];
  receiptIds: string[];
}> {
  const { action, humanId, writtenReason, sessionId, ownership } = params;
  if (typeof humanId !== "string" || humanId.trim().length === 0) {
    throw new Error("Only a named human may clear a permanent 'never' grant.");
  }
  if (typeof writtenReason !== "string" || writtenReason.trim().length === 0) {
    throw new Error("Clearing a permanent 'never' grant requires a written reason.");
  }
  assertValidOwnership(ownership);

  const remainingGrants: Vx3Grant[] = [];
  const revokedGrants: Vx3Grant[] = [];
  const receiptIds: string[] = [];

  for (const grant of grants) {
    if (grant.tier === "never" && grant.action === action) {
      revokedGrants.push(grant);
      const receiptId = await emitReceipt(store, {
        sessionId,
        actor: { type: "human", id: humanId },
        event: "grant_revoked",
        action: grant.action,
        actionClass: grant.actionClass,
        ownership,
        meta: {
          grantId: grant.id,
          tier: "never",
          reason: "human_written_override",
          writtenReason,
        },
      });
      receiptIds.push(receiptId);
    } else {
      remainingGrants.push(grant);
    }
  }

  return { remainingGrants, revokedGrants, receiptIds };
}
