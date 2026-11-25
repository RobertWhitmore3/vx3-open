// VX3 Rails tests — policy engine, missile protection, session expiry, permanent never, decision receipts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryAuditStore } from "../../rails/audit.ts";
import {
  clearNeverGrant,
  createGrant,
  decide,
  endSession,
  evaluatePolicy,
  isMissile,
  makeOwnership,
} from "../../rails/policy.ts";
import type { Vx3Grant, Vx3MissileClass } from "../../rails/types.ts";

const MISSILE_CLASSES: readonly Vx3MissileClass[] = [
  "legal_document",
  "irreversible",
  "harm_potential",
  "child_related",
];

describe("Rule (a): Missile-class actions are draft-only and never auto-allowed", () => {
  it("classifies all four missile classes and never allows them even with session or automation grants", () => {
    const ownership = makeOwnership("seat:test:alpha");
    const sessionId = "sess-missile-1";

    for (const actionClass of MISSILE_CLASSES) {
      assert.equal(isMissile(actionClass), true);

      // Even if a caller manually injects raw session + automation grants for a missile class,
      // decide() must still fail closed and return needs_approval.
      const hostileGrants: Vx3Grant[] = [
        {
          id: crypto.randomUUID(),
          action: "launch_action",
          actionClass,
          tier: "session",
          sessionId,
          grantedBy: "human",
          createdAt: new Date().toISOString(),
          receiptId: crypto.randomUUID(),
          ownership,
        },
        {
          id: crypto.randomUUID(),
          action: "launch_action",
          actionClass,
          tier: "automation",
          automationId: "auto-1",
          grantedBy: "human",
          createdAt: new Date().toISOString(),
          receiptId: crypto.randomUUID(),
          ownership,
        },
      ];

      assert.equal(
        decide("launch_action", actionClass, hostileGrants, sessionId),
        "needs_approval",
        `${actionClass} must never auto-allow`
      );
    }

    assert.equal(isMissile("normal"), false);
    assert.equal(isMissile("personal"), false);
    assert.equal(isMissile("automation"), false);
  });

  it("refuses to mint session or automation auto-allow grants for missile classes", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:alpha");

    for (const actionClass of MISSILE_CLASSES) {
      await assert.rejects(
        () =>
          createGrant(store, {
            action: "file_lawsuit",
            actionClass,
            tier: "session",
            sessionId: "sess-1",
            humanId: "robert",
            ownership,
          }),
        /missile-class/i
      );

      await assert.rejects(
        () =>
          createGrant(store, {
            action: "file_lawsuit",
            actionClass,
            tier: "automation",
            automationId: "cron-1",
            sessionId: "sess-1",
            humanId: "robert",
            ownership,
          }),
        /missile-class/i
      );
    }
  });
});

describe("Rule (c): Session grants die with the session and respect expiry", () => {
  it("allows non-missile action only in the exact active session and never in another or empty session", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:beta");

    const { grant } = await createGrant(store, {
      action: "read_calendar",
      actionClass: "personal",
      tier: "session",
      sessionId: "sess-A",
      humanId: "robert",
      ownership,
    });

    assert.equal(decide("read_calendar", "personal", [grant], "sess-A"), "allow");
    assert.equal(
      decide("read_calendar", "personal", [grant], "sess-B"),
      "needs_approval"
    );
    assert.equal(
      decide("read_calendar", "personal", [grant], ""),
      "needs_approval"
    );
    assert.equal(
      decide("read_calendar", "personal", [grant], "   "),
      "needs_approval"
    );
  });

  it("expires session and automation grants after real elapsed expiresAt time", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:clock");
    const shortExpiry = new Date(Date.now() + 25).toISOString();

    const { grant: sessionGrant } = await createGrant(store, {
      action: "sync_notes",
      actionClass: "normal",
      tier: "session",
      sessionId: "sess-exp",
      humanId: "robert",
      ownership,
      expiresAt: shortExpiry,
    });

    const { grant: autoGrant } = await createGrant(store, {
      action: "nightly_index",
      actionClass: "automation",
      tier: "automation",
      automationId: "indexer-1",
      sessionId: "sess-exp",
      humanId: "robert",
      ownership,
      expiresAt: shortExpiry,
    });

    assert.equal(decide("sync_notes", "normal", [sessionGrant], "sess-exp"), "allow");
    assert.equal(
      decide("nightly_index", "automation", [autoGrant], "sess-exp"),
      "allow"
    );

    await new Promise((resolve) => setTimeout(resolve, 45));

    assert.equal(
      decide("sync_notes", "normal", [sessionGrant], "sess-exp"),
      "needs_approval"
    );
    assert.equal(
      decide("nightly_index", "automation", [autoGrant], "sess-exp"),
      "needs_approval"
    );
  });

  it("revokes every session grant on endSession with grant_revoked receipts while preserving other sessions and never grants", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:session-end");

    const s1 = await createGrant(store, {
      action: "read_inbox",
      actionClass: "personal",
      tier: "session",
      sessionId: "sess-1",
      humanId: "robert",
      ownership,
    });
    const s2 = await createGrant(store, {
      action: "read_inbox",
      actionClass: "personal",
      tier: "session",
      sessionId: "sess-2",
      humanId: "robert",
      ownership,
    });
    const nev = await createGrant(store, {
      action: "wire_money",
      actionClass: "irreversible",
      tier: "never",
      sessionId: "sess-1",
      humanId: "robert",
      ownership,
    });

    const grants = [s1.grant, s2.grant, nev.grant];
    assert.equal(decide("read_inbox", "personal", grants, "sess-1"), "allow");

    const ended = await endSession(store, grants, "sess-1");
    assert.equal(ended.revokedGrants.length, 1);
    assert.equal(ended.revokedGrants[0].id, s1.grant.id);
    assert.equal(ended.receiptIds.length, 1);

    // sess-1 grant is dead
    assert.equal(
      decide("read_inbox", "personal", ended.remainingGrants, "sess-1"),
      "needs_approval"
    );
    // sess-2 grant still holds
    assert.equal(
      decide("read_inbox", "personal", ended.remainingGrants, "sess-2"),
      "allow"
    );
    // never grant survives session end
    assert.equal(
      decide("wire_money", "irreversible", ended.remainingGrants, "sess-1"),
      "deny"
    );

    const revokedReceipt = await store.get(ended.receiptIds[0]);
    assert.ok(revokedReceipt);
    assert.equal(revokedReceipt.event, "grant_revoked");
    assert.equal(revokedReceipt.ownership.agentId, "seat:test:session-end");
    assert.equal(revokedReceipt.ownership.responsible, true);
    assert.equal(await store.verifyChain("sess-1"), true);
  });
});

describe("Rule (d): Permanent 'never' holds across sessions until named human clears it in writing", () => {
  it("never overrides session and automation grants, ignores expiresAt, and survives endSession", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:never");

    const nev = await createGrant(store, {
      action: "export_contacts",
      actionClass: "personal",
      tier: "never",
      sessionId: "sess-1",
      humanId: "robert",
      ownership,
      expiresAt: new Date(Date.now() - 10_000).toISOString(), // must be stripped/ignored for never
    });
    assert.equal(nev.grant.expiresAt, undefined);
    assert.equal(nev.grant.sessionId, undefined);

    const sess = await createGrant(store, {
      action: "export_contacts",
      actionClass: "personal",
      tier: "session",
      sessionId: "sess-2",
      humanId: "robert",
      ownership,
    });
    const auto = await createGrant(store, {
      action: "export_contacts",
      actionClass: "personal",
      tier: "automation",
      automationId: "sync-bot",
      sessionId: "sess-2",
      humanId: "robert",
      ownership,
    });

    const allGrants = [sess.grant, auto.grant, nev.grant];
    assert.equal(decide("export_contacts", "personal", allGrants, "sess-1"), "deny");
    assert.equal(decide("export_contacts", "personal", allGrants, "sess-2"), "deny");
    assert.equal(decide("export_contacts", "personal", allGrants, "sess-99"), "deny");

    const ended = await endSession(store, allGrants, "sess-2");
    assert.equal(
      decide("export_contacts", "personal", ended.remainingGrants, "sess-3"),
      "deny"
    );
  });

  it("refuses clearing never without a named human and written reason, and clears with receipt when valid", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:never-clear");

    const nev = await createGrant(store, {
      action: "post_public_update",
      actionClass: "normal",
      tier: "never",
      sessionId: "sess-1",
      humanId: "robert",
      ownership,
    });

    await assert.rejects(
      () =>
        clearNeverGrant(store, [nev.grant], {
          action: "post_public_update",
          humanId: "",
          writtenReason: "tried anonymously",
          sessionId: "sess-2",
          ownership,
        }),
      /named human/i
    );

    await assert.rejects(
      () =>
        clearNeverGrant(store, [nev.grant], {
          action: "post_public_update",
          humanId: "robert",
          writtenReason: "   ",
          sessionId: "sess-2",
          ownership,
        }),
      /written reason/i
    );

    // Still denied
    assert.equal(
      decide("post_public_update", "normal", [nev.grant], "sess-2"),
      "deny"
    );

    const cleared = await clearNeverGrant(store, [nev.grant], {
      action: "post_public_update",
      humanId: "robert",
      writtenReason: "Operator explicitly re-enabled after policy review.",
      sessionId: "sess-2",
      ownership,
    });

    assert.equal(cleared.revokedGrants.length, 1);
    assert.equal(cleared.remainingGrants.length, 0);
    assert.equal(
      decide("post_public_update", "normal", cleared.remainingGrants, "sess-2"),
      "needs_approval"
    );

    const receipt = await store.get(cleared.receiptIds[0]);
    assert.ok(receipt);
    assert.equal(receipt.event, "grant_revoked");
    assert.equal(receipt.actor.type, "human");
    assert.equal(receipt.actor.id, "robert");
    assert.equal(receipt.meta?.reason, "human_written_override");
  });
});

describe("Rule (e): Every policy decision emits an append-only receipt with seat ownership", () => {
  it("emits policy_decision receipts for allow, needs_approval, and deny with verifiable session chain", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:receipts");
    const sessionId = "sess-decisions";

    const allowGrant = await createGrant(store, {
      action: "read_local_doc",
      actionClass: "normal",
      tier: "session",
      sessionId,
      humanId: "robert",
      ownership,
    });
    const neverGrant = await createGrant(store, {
      action: "delete_vault",
      actionClass: "irreversible",
      tier: "never",
      sessionId,
      humanId: "robert",
      ownership,
    });
    const grants = [allowGrant.grant, neverGrant.grant];

    const rAllow = await evaluatePolicy(store, {
      action: "read_local_doc",
      actionClass: "normal",
      grants,
      sessionId,
      ownership,
    });
    assert.equal(rAllow.decision, "allow");
    assert.equal(rAllow.needsApproval, undefined);

    const rAsk = await evaluatePolicy(store, {
      action: "send_filing",
      actionClass: "legal_document",
      grants,
      sessionId,
      ownership,
    });
    assert.equal(rAsk.decision, "needs_approval");
    assert.ok(rAsk.needsApproval);
    assert.equal(rAsk.needsApproval.status, "needs_vx3_approval");
    assert.equal(rAsk.needsApproval.vx3.receiptId, rAsk.receiptId);
    assert.equal(rAsk.needsApproval.vx3.ownership.agentId, "seat:test:receipts");
    assert.equal(rAsk.needsApproval.vx3.ownership.responsible, true);
    assert.ok(!rAsk.needsApproval.vx3.options.includes("session"));

    const rDeny = await evaluatePolicy(store, {
      action: "delete_vault",
      actionClass: "irreversible",
      grants,
      sessionId,
      ownership,
    });
    assert.equal(rDeny.decision, "deny");

    const decisionReceipts = await store.query({
      sessionId,
      event: "policy_decision",
    });
    assert.equal(decisionReceipts.length, 3);
    assert.deepEqual(
      decisionReceipts.map((r) => r.decision),
      ["allow", "needs_approval", "deny"]
    );
    for (const r of decisionReceipts) {
      assert.equal(r.schema, "vx3-runtime-receipt/v1");
      assert.equal(r.ownership.agentId, "seat:test:receipts");
      assert.equal(r.ownership.responsible, true);
    }

    assert.equal(await store.verifyChain(sessionId), true);
  });
});
