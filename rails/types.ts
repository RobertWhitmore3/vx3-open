// VX3 Rails — core types
// Schema: vx3-rails/v0.6

export type Vx3Tier = "never" | "ask" | "session" | "automation";

export type Vx3ActionClass =
  | "normal"
  | "personal"
  | "legal_document" // missile
  | "irreversible" // send, publish, transfer, delete
  | "harm_potential"
  | "child_related"
  | "automation";

export interface Vx3Ownership {
  initiatedBy: "agent" | "human";
  agentId: string; // specific seat / model instance
  responsible: true; // always true for the initiator
  disclaimerAttempt?: string; // if later dodge is attempted, recorded here
}

export interface Vx3Grant {
  id: string;
  action: string;
  actionClass: Vx3ActionClass;
  tier: Vx3Tier;
  sessionId?: string; // required when tier === "session"
  automationId?: string; // only for explicit automations
  grantedBy: "human";
  createdAt: string;
  expiresAt?: string;
  receiptId: string;
  ownership: Vx3Ownership;
}

export type Vx3DraftStatus =
  | "DRAFT"
  | "PENDING_HUMAN"
  | "APPROVED_FOR_FIRE" // short-lived, human only
  | "FIRED"
  | "DISCARDED"
  | "REFUSED";

export interface Vx3Draft {
  id: string;
  actionClass: "legal_document" | "irreversible";
  status: Vx3DraftStatus;
  content: string;
  disclaimer: string; // forced
  createdAt: string;
  receiptId: string;
  ownership: Vx3Ownership;
  humanFire?: {
    approvedBy: string;
    approvedAt: string;
    confirmationToken: string; // one-time, short-lived
  };
}

export interface Vx3NeedsApproval {
  status: "needs_vx3_approval";
  vx3: {
    approvalId: string;
    action: string;
    actionClass: Vx3ActionClass;
    reason: string;
    currentTier: Vx3Tier | null;
    options: Array<"never" | "allow_once" | "session" | "discard">;
    draftId?: string;
    receiptId: string;
    ownership: Vx3Ownership;
  };
}

export type Vx3AuditEvent =
  | "policy_decision"
  | "grant_created"
  | "grant_revoked"
  | "draft_created"
  | "draft_transition"
  | "approval_resolved"
  | "token_issued"
  | "token_consumed"
  | "fire_attempt"
  | "forbidden_tool_call"
  | "responsibility_dodge";

export interface Vx3Receipt {
  receiptId: string;
  schema: "vx3-runtime-receipt/v1";
  ts: string; // ISO-8601
  sessionId: string;
  actor: {
    type: "agent" | "human" | "system";
    id: string;
    family?: string;
  };
  event: Vx3AuditEvent;
  action?: string;
  actionClass?: Vx3ActionClass;
  decision?: "allow" | "needs_approval" | "deny";
  draftId?: string;
  fromStatus?: Vx3DraftStatus;
  toStatus?: Vx3DraftStatus;
  choice?: "never" | "allow_once" | "session" | "discard" | "confirm_fire";
  contentHash?: string; // sha256 of content at this moment
  ownership: Vx3Ownership;
  harness?: {
    client: string;
    systemPromptHash?: string;
    toolsHash?: string;
  };
  prevReceiptId?: string;
  meta?: Record<string, unknown>; // never secrets
}
