// VX3 Rails — MCP tool surface (executable contract for rails/tools.md)
// Hard rule 6: There is NO agent-facing tool that can fire, send, file, execute,
// consume a confirmation token, or elevate a session grant into missile-class allow.

import {
  assertValidOwnership,
  emitReceipt,
  type AuditFilter,
  type AuditStore,
} from "./audit.ts";
import { createAuditedDraft, transitionDraft } from "./legal.ts";
import {
  clearNeverGrant,
  createGrant,
  endSession,
  evaluatePolicy,
  isMissile,
} from "./policy.ts";
import type {
  Vx3ActionClass,
  Vx3AllowedToolName,
  Vx3Draft,
  Vx3DraftableClass,
  Vx3Grant,
  Vx3Ownership,
  Vx3Receipt,
} from "./types.ts";

export interface Vx3ToolDescriptor {
  readonly name: Vx3AllowedToolName;
  readonly description: string;
  readonly agentCallable: boolean;
  readonly readOnly: boolean;
}

/**
 * The complete, closed tool surface defined by rails/tools.md.
 * Deliberately absent: any fire, send, file, execute, or token-consuming tool.
 */
export const VX3_AGENT_TOOLS: readonly Vx3ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: "vx3_request_approval",
    description:
      "Request human approval under the rails before any gated action proceeds.",
    agentCallable: true,
    readOnly: false,
  }),
  Object.freeze({
    name: "vx3_resolve_approval",
    description:
      "Human (or human-driven UI) resolves an approval card. Agents may not call this to self-grant.",
    agentCallable: false,
    readOnly: false,
  }),
  Object.freeze({
    name: "vx3_create_draft",
    description:
      "Create a draft of class legal_document or irreversible. Always starts at DRAFT with forced disclaimer.",
    agentCallable: true,
    readOnly: false,
  }),
  Object.freeze({
    name: "vx3_list_drafts",
    description: "List drafts visible in the current session / scope.",
    agentCallable: true,
    readOnly: true,
  }),
  Object.freeze({
    name: "vx3_request_human_fire",
    description:
      "Move a draft from DRAFT to PENDING_HUMAN. Does not fire it; notifies the human airlock surface.",
    agentCallable: true,
    readOnly: false,
  }),
  Object.freeze({
    name: "vx3_get_receipts",
    description:
      "Read-only retrieval of receipts for the current session or given receiptId / draftId.",
    agentCallable: true,
    readOnly: true,
  }),
]);

const ALLOWED_TOOL_SET = new Set<string>(VX3_AGENT_TOOLS.map((t) => t.name));

export function isAllowedToolName(name: string): name is Vx3AllowedToolName {
  return ALLOWED_TOOL_SET.has(name);
}

export interface AgentToolContext {
  sessionId: string;
  agentId: string;
  ownership: Vx3Ownership;
}

export interface ToolCallResult<T = unknown> {
  ok: boolean;
  decision: "allow" | "needs_approval" | "deny";
  receiptId?: string;
  data?: T;
  error?: string;
}

/**
 * Executable VX3 Rails tool surface for an agent session.
 * Never exposes Airlock fire functions (`issueFireToken`, `markApprovedForFire`, `consumeFireToken`).
 */
export class Vx3RailsSurface {
  private readonly store: AuditStore;
  private grants: Vx3Grant[];
  private readonly drafts = new Map<string, Vx3Draft>();

  constructor(store: AuditStore, initialGrants: Vx3Grant[] = []) {
    this.store = store;
    this.grants = [...initialGrants];
  }

  listTools(): Vx3ToolDescriptor[] {
    return VX3_AGENT_TOOLS.map((t) => ({ ...t }));
  }

  getGrants(): Vx3Grant[] {
    return this.grants.map((g) => structuredClone(g));
  }

  getDraft(draftId: string): Vx3Draft | null {
    const draft = this.drafts.get(draftId);
    return draft ? structuredClone(draft) : null;
  }

  async invokeAgentTool(
    toolName: string,
    args: Record<string, unknown>,
    ctx: AgentToolContext
  ): Promise<ToolCallResult> {
    assertValidOwnership(ctx.ownership);

    // Reject any forbidden or unknown tool (including vx3_fire, vx3_send, vx3_file, vx3_execute, etc.)
    if (!isAllowedToolName(toolName)) {
      const receiptId = await emitReceipt(this.store, {
        sessionId: ctx.sessionId,
        actor: { type: "agent", id: ctx.agentId },
        event: "forbidden_tool_call",
        action: toolName,
        decision: "deny",
        ownership: ctx.ownership,
        meta: {
          reason: `Tool '${toolName}' is not on the VX3 agent tool surface.`,
        },
      });
      return {
        ok: false,
        decision: "deny",
        receiptId,
        error: `Forbidden tool call rejected: '${toolName}' is not available to agents.`,
      };
    }

    // tools.md: "The agent does not call this to grant itself permission."
    if (toolName === "vx3_resolve_approval") {
      const receiptId = await emitReceipt(this.store, {
        sessionId: ctx.sessionId,
        actor: { type: "agent", id: ctx.agentId },
        event: "forbidden_tool_call",
        action: toolName,
        decision: "deny",
        ownership: ctx.ownership,
        meta: {
          reason: "Agents cannot call vx3_resolve_approval to grant themselves permission.",
        },
      });
      return {
        ok: false,
        decision: "deny",
        receiptId,
        error: "Agents cannot call vx3_resolve_approval to grant themselves permission.",
      };
    }

    if (toolName === "vx3_request_approval") {
      const action = String(args.action ?? "");
      const actionClass = args.actionClass as Vx3ActionClass;
      const draftId = typeof args.draftId === "string" ? args.draftId : undefined;
      const res = await evaluatePolicy(this.store, {
        action,
        actionClass,
        grants: this.grants,
        sessionId: ctx.sessionId,
        ownership: ctx.ownership,
        ...(draftId ? { draftId } : {}),
      });
      return {
        ok: res.decision === "allow",
        decision: res.decision,
        receiptId: res.receiptId,
        data: res.needsApproval ?? { decision: res.decision },
      };
    }

    if (toolName === "vx3_create_draft") {
      const content = String(args.content ?? "");
      const actionClass = args.actionClass as Vx3DraftableClass;
      if (actionClass !== "legal_document" && actionClass !== "irreversible") {
        const receiptId = await emitReceipt(this.store, {
          sessionId: ctx.sessionId,
          actor: { type: "agent", id: ctx.agentId },
          event: "policy_decision",
          action: "vx3_create_draft",
          decision: "deny",
          ownership: ctx.ownership,
          meta: { reason: `Invalid draft actionClass: ${String(actionClass)}` },
        });
        return {
          ok: false,
          decision: "deny",
          receiptId,
          error: `vx3_create_draft only accepts legal_document or irreversible.`,
        };
      }
      const draft = await createAuditedDraft(
        this.store,
        ctx.sessionId,
        content,
        actionClass,
        ctx.ownership
      );
      this.drafts.set(draft.id, draft);
      return {
        ok: true,
        decision: "allow",
        receiptId: draft.receiptId,
        data: structuredClone(draft),
      };
    }

    if (toolName === "vx3_list_drafts") {
      const list = Array.from(this.drafts.values()).map((d) => structuredClone(d));
      return {
        ok: true,
        decision: "allow",
        data: list,
      };
    }

    if (toolName === "vx3_request_human_fire") {
      const draftId = String(args.draftId ?? "");
      const draft = this.drafts.get(draftId);
      if (!draft) {
        return {
          ok: false,
          decision: "deny",
          error: `Draft not found: ${draftId}`,
        };
      }
      const updated = await transitionDraft(
        this.store,
        ctx.sessionId,
        draft,
        "PENDING_HUMAN",
        { type: "agent", id: ctx.agentId },
        ctx.ownership
      );
      if (!updated) {
        return {
          ok: false,
          decision: "deny",
          error: `Cannot move draft ${draftId} from ${draft.status} to PENDING_HUMAN.`,
        };
      }
      this.drafts.set(updated.id, updated);
      return {
        ok: true,
        decision: "needs_approval",
        receiptId: updated.receiptId,
        data: structuredClone(updated),
      };
    }

    // vx3_get_receipts (read-only)
    if (typeof args.receiptId === "string" && args.receiptId.length > 0) {
      const receipt = await this.store.get(args.receiptId);
      return {
        ok: true,
        decision: "allow",
        data: receipt ? [receipt] : [],
      };
    }
    const filter: AuditFilter = {
      sessionId: ctx.sessionId,
      ...(typeof args.draftId === "string" ? { draftId: args.draftId } : {}),
    };
    const receipts: Vx3Receipt[] = await this.store.query(filter);
    return {
      ok: true,
      decision: "allow",
      data: receipts,
    };
  }

  /**
   * Human-only resolution surface (never exposed to agents).
   */
  async resolveApprovalAsHuman(params: {
    sessionId: string;
    humanId: string;
    action: string;
    actionClass: Vx3ActionClass;
    choice: "never" | "allow_once" | "session" | "discard";
    ownership: Vx3Ownership;
    expiresAt?: string;
  }): Promise<{ receiptId: string; grant?: Vx3Grant }> {
    const { sessionId, humanId, action, actionClass, choice, ownership, expiresAt } =
      params;
    if (typeof humanId !== "string" || humanId.trim().length === 0) {
      throw new Error("Human approval resolution requires a non-empty humanId.");
    }
    assertValidOwnership(ownership);

    if (choice === "session" && isMissile(actionClass)) {
      throw new Error(
        `Missile-class action (${actionClass}) cannot be granted a session auto-allow.`
      );
    }

    const receiptId = await emitReceipt(this.store, {
      sessionId,
      actor: { type: "human", id: humanId },
      event: "approval_resolved",
      action,
      actionClass,
      decision: choice === "never" || choice === "discard" ? "deny" : "allow",
      choice,
      ownership,
    });

    if (choice === "never" || choice === "session") {
      const created = await createGrant(this.store, {
        action,
        actionClass,
        tier: choice,
        sessionId,
        humanId,
        ownership,
        ...(expiresAt ? { expiresAt } : {}),
      });
      this.grants.push(created.grant);
      return { receiptId, grant: structuredClone(created.grant) };
    }

    return { receiptId };
  }

  async endSession(sessionId: string): Promise<{
    revokedGrants: Vx3Grant[];
    receiptIds: string[];
  }> {
    const res = await endSession(this.store, this.grants, sessionId);
    this.grants = res.remainingGrants;
    return {
      revokedGrants: res.revokedGrants,
      receiptIds: res.receiptIds,
    };
  }

  async clearNeverGrant(params: {
    action: string;
    humanId: string;
    writtenReason: string;
    sessionId: string;
    ownership: Vx3Ownership;
  }): Promise<{ revokedGrants: Vx3Grant[]; receiptIds: string[] }> {
    const res = await clearNeverGrant(this.store, this.grants, params);
    this.grants = res.remainingGrants;
    return {
      revokedGrants: res.revokedGrants,
      receiptIds: res.receiptIds,
    };
  }
}
