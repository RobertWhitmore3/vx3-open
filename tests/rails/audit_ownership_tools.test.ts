// VX3 Rails tests — append-only audit store, responsibility_dodge rejection, and closed agent tool surface
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  consumeFireToken,
  issueAuditedFireToken,
  markApprovedForFire,
} from "../../rails/airlock.ts";
import {
  emitReceipt,
  emitResponsibilityDodge,
  MemoryAuditStore,
  verifyAgentClaim,
} from "../../rails/audit.ts";
import {
  createGrant,
  evaluatePolicy,
  makeOwnership,
} from "../../rails/policy.ts";
import { VX3_AGENT_TOOLS, Vx3RailsSurface } from "../../rails/tools.ts";
import type { Vx3Draft, Vx3Receipt } from "../../rails/types.ts";

describe("Rule (e): Append-only MemoryAuditStore immutability and chain verification", () => {
  it("prevents post-append mutation, rejects duplicate receiptIds, and verifies prevReceiptId chains", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:audit");
    const sessionId = "sess-audit-1";

    const id1 = await emitReceipt(store, {
      sessionId,
      actor: { type: "agent", id: "seat:test:audit" },
      event: "policy_decision",
      action: "read_file",
      actionClass: "normal",
      decision: "needs_approval",
      ownership,
    });

    const fetched1 = await store.get(id1);
    assert.ok(fetched1);
    // Attempt to tamper returned receipt object
    fetched1.decision = "allow";
    fetched1.ownership.agentId = "someone-else";

    const refetched1 = await store.get(id1);
    assert.ok(refetched1);
    assert.equal(refetched1.decision, "needs_approval");
    assert.equal(refetched1.ownership.agentId, "seat:test:audit");

    // Duplicate receiptId rejected
    await assert.rejects(() => store.append(refetched1), /duplicate/i);

    const id2 = await emitReceipt(store, {
      sessionId,
      actor: { type: "human", id: "robert" },
      event: "approval_resolved",
      action: "read_file",
      actionClass: "normal",
      decision: "allow",
      choice: "session",
      ownership,
    });

    const fetched2 = await store.get(id2);
    assert.ok(fetched2);
    assert.equal(fetched2.prevReceiptId, id1);
    assert.equal(await store.verifyChain(sessionId), true);

    // Empty session fails chain check
    assert.equal(await store.verifyChain("sess-nonexistent"), false);

    // Broken / dangling prevReceiptId fails chain check
    const brokenStore = new MemoryAuditStore();
    const badReceipt: Vx3Receipt = {
      receiptId: crypto.randomUUID(),
      schema: "vx3-runtime-receipt/v1",
      ts: new Date().toISOString(),
      sessionId: "sess-broken",
      actor: { type: "agent", id: "seat:test:audit" },
      event: "policy_decision",
      decision: "deny",
      ownership,
      prevReceiptId: "rcpt-does-not-exist",
    };
    await brokenStore.append(badReceipt);
    assert.equal(await brokenStore.verifyChain("sess-broken"), false);
  });

  it("blocks forging schema or receiptId via spread and rejects invalid ownership", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:noforge");

    const spoofed = {
      sessionId: "sess-spoof",
      actor: { type: "agent" as const, id: "seat:test:noforge" },
      event: "policy_decision" as const,
      ownership,
      schema: "fake-schema/v9",
      receiptId: "forged-id",
    };

    const realId = await emitReceipt(
      store,
      spoofed as unknown as Omit<Vx3Receipt, "receiptId" | "ts" | "schema">
    );
    assert.notEqual(realId, "forged-id");
    const stored = await store.get(realId);
    assert.ok(stored);
    assert.equal(stored.schema, "vx3-runtime-receipt/v1");

    await assert.rejects(
      () =>
        emitReceipt(store, {
          sessionId: "sess-bad-own",
          actor: { type: "agent", id: "seat:x" },
          event: "policy_decision",
          ownership: {
            initiatedBy: "agent",
            agentId: "",
            responsible: true,
          },
        }),
      /ownership invariant/i
    );
  });
});

describe("Rule (f): responsibility_dodge detection & rejection without erasing original receipts", () => {
  it("rejects claiming an action was permitted when a deny receipt exists and preserves the original deny receipt", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:dodger");
    const sessionId = "sess-dodge-1";

    const neverGrant = await createGrant(store, {
      action: "send_legal_notice",
      actionClass: "legal_document",
      tier: "never",
      sessionId,
      humanId: "robert",
      ownership,
    });

    const evalRes = await evaluatePolicy(store, {
      action: "send_legal_notice",
      actionClass: "legal_document",
      grants: [neverGrant.grant],
      sessionId,
      ownership,
    });
    assert.equal(evalRes.decision, "deny");

    const check = await verifyAgentClaim(store, {
      sessionId,
      agentId: "seat:test:dodger",
      claimKind: "action_permitted",
      claimText: "I thought send_legal_notice was allowed.",
      action: "send_legal_notice",
      ownership,
    });

    assert.equal(check.accepted, false);
    assert.ok(check.dodgeReceiptId);
    assert.equal(check.originalReceiptId, evalRes.receiptId);

    // Original deny receipt is still intact
    const orig = await store.get(evalRes.receiptId);
    assert.ok(orig);
    assert.equal(orig.event, "policy_decision");
    assert.equal(orig.decision, "deny");

    // Permanent second mark recorded
    const dodge = await store.get(check.dodgeReceiptId);
    assert.ok(dodge);
    assert.equal(dodge.event, "responsibility_dodge");
    assert.equal(dodge.prevReceiptId, evalRes.receiptId);
    assert.equal(
      dodge.ownership.disclaimerAttempt,
      "I thought send_legal_notice was allowed."
    );
    assert.equal(dodge.ownership.responsible, true);
    assert.equal(await store.verifyChain(sessionId), true);
  });

  it("rejects claiming completion without a consumed token + fire receipt, and always rejects disclaiming responsibility", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:claimer");
    const sessionId = "sess-dodge-2";
    const surface = new Vx3RailsSurface(store);

    const created = await surface.invokeAgentTool(
      "vx3_create_draft",
      { content: "Settlement offer draft", actionClass: "legal_document" },
      { sessionId, agentId: "seat:test:claimer", ownership }
    );
    assert.equal(created.ok, true);
    const draft = created.data as Vx3Draft;

    // Claiming completion when only DRAFT exists -> rejected as responsibility_dodge
    const fakeComplete = await verifyAgentClaim(store, {
      sessionId,
      agentId: "seat:test:claimer",
      claimKind: "action_completed",
      claimText: "The settlement offer has been sent.",
      draftId: draft.id,
      ownership,
    });
    assert.equal(fakeComplete.accepted, false);
    assert.ok(fakeComplete.dodgeReceiptId);

    // Broken rail: a bare fire_attempt receipt WITHOUT a preceding token_consumed receipt must still be rejected
    const brokenSession = "sess-broken-rail";
    await emitReceipt(store, {
      sessionId: brokenSession,
      actor: { type: "human", id: "robert" },
      event: "fire_attempt",
      actionClass: "legal_document",
      decision: "allow",
      draftId: "draft-broken-1",
      fromStatus: "APPROVED_FOR_FIRE",
      toStatus: "FIRED",
      ownership,
    });
    const brokenCheck = await verifyAgentClaim(store, {
      sessionId: brokenSession,
      agentId: "seat:test:claimer",
      claimKind: "action_completed",
      claimText: "Sent via broken rail.",
      draftId: "draft-broken-1",
      ownership,
    });
    assert.equal(brokenCheck.accepted, false);
    assert.match(brokenCheck.reason ?? "", /broken rail/i);

    // Now run the real human Airlock path
    const queued = await surface.invokeAgentTool(
      "vx3_request_human_fire",
      { draftId: draft.id },
      { sessionId, agentId: "seat:test:claimer", ownership }
    );
    assert.equal(queued.ok, true);
    const pendingDraft = queued.data as Vx3Draft;
    assert.equal(pendingDraft.status, "PENDING_HUMAN");

    const issued = await issueAuditedFireToken(
      store,
      pendingDraft,
      sessionId,
      "robert",
      ownership
    );
    assert.ok(issued);
    const approved = markApprovedForFire(pendingDraft);
    assert.ok(approved);

    const fired = await consumeFireToken(
      store,
      approved,
      issued.fireToken.token,
      sessionId,
      "robert",
      ownership
    );
    assert.ok(fired);

    // NOW claiming completion with the real receipt chain succeeds
    const realComplete = await verifyAgentClaim(store, {
      sessionId,
      agentId: "seat:test:claimer",
      claimKind: "action_completed",
      claimText: `Human fired draft ${draft.id}; receipt ${fired.receiptId}.`,
      draftId: draft.id,
      ownership,
    });
    assert.equal(realComplete.accepted, true);

    // Disclaiming responsibility AFTER human fired is STILL rejected as responsibility_dodge
    const disclaim = await verifyAgentClaim(store, {
      sessionId,
      agentId: "seat:test:claimer",
      claimKind: "disclaim_responsibility",
      claimText: "You fired it, so the system decided and I bear no responsibility.",
      draftId: draft.id,
      originalReceiptId: fired.receiptId,
      ownership,
    });
    assert.equal(disclaim.accepted, false);
    assert.ok(disclaim.dodgeReceiptId);

    // Direct emitResponsibilityDodge also appends cleanly without erasing prior receipt
    const directDodgeId = await emitResponsibilityDodge(
      store,
      sessionId,
      "seat:test:claimer",
      fired.receiptId,
      "I didn't know.",
      ownership
    );
    const directDodge = await store.get(directDodgeId);
    assert.ok(directDodge);
    assert.equal(directDodge.event, "responsibility_dodge");
    assert.ok(await store.get(fired.receiptId));
    assert.equal(await store.verifyChain(sessionId), true);
  });
});

describe("Rule (f): No agent-facing fire, send, file, execute, or token-consume tool", () => {
  it("exposes strictly the 6 documented tools matching rails/tools.md and zero fire/send/file tools", () => {
    const store = new MemoryAuditStore();
    const surface = new Vx3RailsSurface(store);
    const tools = surface.listTools();
    const names = tools.map((t) => t.name);

    assert.deepEqual(names, [
      "vx3_request_approval",
      "vx3_resolve_approval",
      "vx3_create_draft",
      "vx3_list_drafts",
      "vx3_request_human_fire",
      "vx3_get_receipts",
    ]);
    assert.equal(VX3_AGENT_TOOLS.length, 6);

    // Confirm no fire/send/file/execute/consume capability exists on the agent manifest
    const forbiddenNames = [
      "vx3_fire",
      "vx3_send",
      "vx3_file",
      "vx3_execute",
      "vx3_consume_token",
      "consumeFireToken",
      "issueFireToken",
      "markApprovedForFire",
    ];
    for (const bad of forbiddenNames) {
      assert.equal(names.includes(bad as never), false);
    }

    // Cross-check every exported tool name is documented in rails/tools.md
    const toolsDoc = readFileSync(
      resolve(import.meta.dirname, "../../rails/tools.md"),
      "utf8"
    );
    for (const name of names) {
      assert.ok(
        toolsDoc.includes(`\`${name}\``),
        `Expected ${name} to be documented in rails/tools.md`
      );
    }
  });

  it("denies forbidden tool calls and agent self-approval attempts with forbidden_tool_call receipts", async () => {
    const store = new MemoryAuditStore();
    const surface = new Vx3RailsSurface(store);
    const ownership = makeOwnership("seat:test:boundary");
    const ctx = {
      sessionId: "sess-tools-1",
      agentId: "seat:test:boundary",
      ownership,
    };

    for (const badTool of [
      "vx3_fire",
      "vx3_send",
      "vx3_file",
      "vx3_execute",
      "consume_fire_token",
    ]) {
      const res = await surface.invokeAgentTool(badTool, {}, ctx);
      assert.equal(res.ok, false);
      assert.equal(res.decision, "deny");
      assert.ok(res.receiptId);

      const receipt = await store.get(res.receiptId);
      assert.ok(receipt);
      assert.equal(receipt.event, "forbidden_tool_call");
      assert.equal(receipt.action, badTool);
      assert.equal(receipt.decision, "deny");
      assert.equal(receipt.ownership.agentId, "seat:test:boundary");
    }

    // Agent trying to self-grant via vx3_resolve_approval is also denied
    const selfResolve = await surface.invokeAgentTool(
      "vx3_resolve_approval",
      { choice: "session", action: "read_inbox" },
      ctx
    );
    assert.equal(selfResolve.ok, false);
    assert.equal(selfResolve.decision, "deny");
    assert.ok(selfResolve.receiptId);
    const selfResolveReceipt = await store.get(selfResolve.receiptId);
    assert.equal(selfResolveReceipt?.event, "forbidden_tool_call");

    // Agent draft -> request_human_fire stops at PENDING_HUMAN and never returns a token
    const draftRes = await surface.invokeAgentTool(
      "vx3_create_draft",
      { content: "Contract addendum", actionClass: "legal_document" },
      ctx
    );
    assert.equal(draftRes.ok, true);
    const draft = draftRes.data as Vx3Draft;

    const reqFireRes = await surface.invokeAgentTool(
      "vx3_request_human_fire",
      { draftId: draft.id },
      ctx
    );
    assert.equal(reqFireRes.ok, true);
    assert.equal(reqFireRes.decision, "needs_approval");
    const queued = reqFireRes.data as Vx3Draft;
    assert.equal(queued.status, "PENDING_HUMAN");
    assert.equal(queued.humanFire, undefined);

    // Agent can retrieve its own receipts read-only via vx3_get_receipts
    const receiptsRes = await surface.invokeAgentTool("vx3_get_receipts", {}, ctx);
    assert.equal(receiptsRes.ok, true);
    const receipts = receiptsRes.data as Vx3Receipt[];
    assert.ok(receipts.length >= 8);
    assert.equal(await store.verifyChain("sess-tools-1"), true);
  });

  it("enforces full Vx3RailsSurface approval, session-end revocation, never override, and cloned draft isolation", async () => {
    const store = new MemoryAuditStore();
    const surface = new Vx3RailsSurface(store);
    const ownership = makeOwnership("seat:test:surface-e2e");
    const ctx1 = {
      sessionId: "sess-e2e-1",
      agentId: "seat:test:surface-e2e",
      ownership,
    };
    const ctx2 = {
      sessionId: "sess-e2e-2",
      agentId: "seat:test:surface-e2e",
      ownership,
    };

    // Initially needs approval
    const req1 = await surface.invokeAgentTool(
      "vx3_request_approval",
      { action: "read_calendar", actionClass: "personal" },
      ctx1
    );
    assert.equal(req1.ok, false);
    assert.equal(req1.decision, "needs_approval");

    // Human cannot grant a session auto-allow for missile-class actions
    await assert.rejects(
      () =>
        surface.resolveApprovalAsHuman({
          sessionId: "sess-e2e-1",
          humanId: "robert",
          action: "file_brief",
          actionClass: "legal_document",
          choice: "session",
          ownership,
        }),
      /missile-class/i
    );

    // Human grants session approval for non-missile action
    await surface.resolveApprovalAsHuman({
      sessionId: "sess-e2e-1",
      humanId: "robert",
      action: "read_calendar",
      actionClass: "personal",
      choice: "session",
      ownership,
    });

    const reqAllowed = await surface.invokeAgentTool(
      "vx3_request_approval",
      { action: "read_calendar", actionClass: "personal" },
      ctx1
    );
    assert.equal(reqAllowed.ok, true);
    assert.equal(reqAllowed.decision, "allow");

    // Ending session revokes the session grant
    const ended = await surface.endSession("sess-e2e-1");
    assert.equal(ended.revokedGrants.length, 1);

    const reqAfterEnd = await surface.invokeAgentTool(
      "vx3_request_approval",
      { action: "read_calendar", actionClass: "personal" },
      ctx1
    );
    assert.equal(reqAfterEnd.ok, false);
    assert.equal(reqAfterEnd.decision, "needs_approval");

    // Human sets permanent never -> holds across sessions until human clears in writing
    await surface.resolveApprovalAsHuman({
      sessionId: "sess-e2e-1",
      humanId: "robert",
      action: "bulk_export",
      actionClass: "personal",
      choice: "never",
      ownership,
    });
    const deniedInSess2 = await surface.invokeAgentTool(
      "vx3_request_approval",
      { action: "bulk_export", actionClass: "personal" },
      ctx2
    );
    assert.equal(deniedInSess2.decision, "deny");

    await surface.clearNeverGrant({
      action: "bulk_export",
      humanId: "robert",
      writtenReason: "Human cleared after review.",
      sessionId: "sess-e2e-2",
      ownership,
    });
    const afterClear = await surface.invokeAgentTool(
      "vx3_request_approval",
      { action: "bulk_export", actionClass: "personal" },
      ctx2
    );
    assert.equal(afterClear.decision, "needs_approval");

    // vx3_list_drafts returns cloned drafts so mutating them cannot forge status or strip disclaimer
    const created = await surface.invokeAgentTool(
      "vx3_create_draft",
      { content: "Immutable draft body", actionClass: "irreversible" },
      ctx2
    );
    const createdDraft = created.data as Vx3Draft;
    const listed = (
      await surface.invokeAgentTool("vx3_list_drafts", {}, ctx2)
    ).data as Vx3Draft[];
    assert.equal(listed.length, 1);
    listed[0].status = "FIRED";
    listed[0].disclaimer = "";

    const storedDraft = surface.getDraft(createdDraft.id);
    assert.ok(storedDraft);
    assert.equal(storedDraft.status, "DRAFT");
    assert.ok(storedDraft.disclaimer.length > 0);

    assert.equal(await store.verifyChain("sess-e2e-1"), true);
    assert.equal(await store.verifyChain("sess-e2e-2"), true);
  });
});
