// VX3 Rails tests — missile-class drafts, forced disclaimer, state machine, and one-time human Airlock
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consumeFireToken,
  issueAuditedFireToken,
  issueFireToken,
  markApprovedForFire,
  MAX_TOKEN_TTL_MS,
} from "../../rails/airlock.ts";
import { MemoryAuditStore } from "../../rails/audit.ts";
import {
  canTransition,
  createAuditedDraft,
  createDraft,
  hashContent,
  transitionDraft,
  VX3_LEGAL_DISCLAIMER,
} from "../../rails/legal.ts";
import { makeOwnership } from "../../rails/policy.ts";

describe("Rule (a): Missile-class drafts carry forced disclaimer and strict state transitions", () => {
  it("always starts at DRAFT with forced legal disclaimer and records draft_created receipt", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:drafter");
    const sessionId = "sess-draft-1";

    const draft = await createAuditedDraft(
      store,
      sessionId,
      "Motion to dismiss — draft text",
      "legal_document",
      ownership
    );

    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.disclaimer, VX3_LEGAL_DISCLAIMER);
    assert.equal(draft.ownership.agentId, "seat:test:drafter");
    assert.equal(draft.ownership.responsible, true);

    const receipt = await store.get(draft.receiptId);
    assert.ok(receipt);
    assert.equal(receipt.event, "draft_created");
    assert.equal(receipt.draftId, draft.id);
    assert.equal(receipt.toStatus, "DRAFT");
    assert.equal(receipt.contentHash, hashContent(draft.content));
  });

  it("forbids skipping directly to APPROVED_FOR_FIRE or FIRED and blocks terminal-state resurrection", async () => {
    assert.equal(canTransition("DRAFT", "PENDING_HUMAN"), true);
    assert.equal(canTransition("DRAFT", "APPROVED_FOR_FIRE"), false);
    assert.equal(canTransition("DRAFT", "FIRED"), false);
    assert.equal(canTransition("PENDING_HUMAN", "FIRED"), false);
    assert.equal(canTransition("FIRED", "DRAFT"), false);
    assert.equal(canTransition("DISCARDED", "PENDING_HUMAN"), false);
    assert.equal(canTransition("REFUSED", "APPROVED_FOR_FIRE"), false);

    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:state-machine");
    const sessionId = "sess-transitions";

    const draft = await createAuditedDraft(
      store,
      sessionId,
      "Wire transfer instruction",
      "irreversible",
      ownership
    );

    // Agent cannot jump DRAFT -> APPROVED_FOR_FIRE or DRAFT -> FIRED
    assert.equal(
      await transitionDraft(
        store,
        sessionId,
        draft,
        "APPROVED_FOR_FIRE",
        { type: "agent", id: "seat:test:state-machine" },
        ownership
      ),
      null
    );
    assert.equal(
      await transitionDraft(
        store,
        sessionId,
        draft,
        "FIRED",
        { type: "agent", id: "seat:test:state-machine" },
        ownership
      ),
      null
    );

    // Agent CAN move DRAFT -> PENDING_HUMAN
    const pending = await transitionDraft(
      store,
      sessionId,
      draft,
      "PENDING_HUMAN",
      { type: "agent", id: "seat:test:state-machine" },
      ownership
    );
    assert.ok(pending);
    assert.equal(pending.status, "PENDING_HUMAN");
    assert.equal(pending.disclaimer, VX3_LEGAL_DISCLAIMER);

    // Even if someone strips disclaimer on an object copy, transitionDraft re-stamps it.
    const stripped = { ...pending, disclaimer: "" };
    const approved = await transitionDraft(
      store,
      sessionId,
      stripped,
      "APPROVED_FOR_FIRE",
      { type: "human", id: "robert" },
      ownership
    );
    assert.ok(approved);
    assert.equal(approved.disclaimer, VX3_LEGAL_DISCLAIMER);

    // Agent cannot approve its own draft from PENDING_HUMAN -> APPROVED_FOR_FIRE
    assert.equal(
      await transitionDraft(
        store,
        sessionId,
        pending,
        "APPROVED_FOR_FIRE",
        { type: "agent", id: "seat:test:state-machine" },
        ownership
      ),
      null
    );

    // Even human cannot reach FIRED through transitionDraft (must go through Airlock consumeFireToken)
    assert.equal(
      await transitionDraft(
        store,
        sessionId,
        approved,
        "FIRED",
        { type: "human", id: "robert" },
        ownership
      ),
      null
    );

    assert.equal(await store.verifyChain(sessionId), true);
  });
});

describe("Rule (b): One-time human Airlock token issue, consume, replay refusal, expiry burn, and tamper rejection", () => {
  it("issues token only for PENDING_HUMAN with bounded TTL, returns frozen snapshot, consumes once, and refuses replay", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:airlock");
    const sessionId = "sess-airlock-1";

    const draft = await createAuditedDraft(
      store,
      sessionId,
      "Cease and desist letter v1",
      "legal_document",
      ownership
    );

    // Cannot issue token while still DRAFT
    assert.equal(issueFireToken(draft), null);

    const pending = await transitionDraft(
      store,
      sessionId,
      draft,
      "PENDING_HUMAN",
      { type: "agent", id: "seat:test:airlock" },
      ownership
    );
    assert.ok(pending);

    // Rejects out-of-bounds TTLs
    assert.equal(issueFireToken(pending, { ttlMs: 0 }), null);
    assert.equal(issueFireToken(pending, { ttlMs: -100 }), null);
    assert.equal(issueFireToken(pending, { ttlMs: MAX_TOKEN_TTL_MS + 1 }), null);

    const issued = await issueAuditedFireToken(
      store,
      pending,
      sessionId,
      "robert",
      ownership
    );
    assert.ok(issued);
    const { fireToken, receiptId: issueReceiptId } = issued;

    // Returned snapshot is frozen; caller cannot mutate internal token state
    assert.equal(Object.isFrozen(fireToken), true);
    assert.throws(() => {
      (fireToken as { used: boolean }).used = true;
    }, TypeError);

    // token_issued receipt must NOT leak the raw token value
    const issueReceipt = await store.get(issueReceiptId);
    assert.ok(issueReceipt);
    assert.equal(issueReceipt.event, "token_issued");
    assert.equal(JSON.stringify(issueReceipt).includes(fireToken.token), false);

    // Cannot consume while still PENDING_HUMAN (not yet APPROVED_FOR_FIRE)
    const premature = await consumeFireToken(
      store,
      pending,
      fireToken.token,
      sessionId,
      "robert",
      ownership
    );
    assert.equal(premature, null);

    const approved = markApprovedForFire(pending);
    assert.ok(approved);
    assert.equal(approved.status, "APPROVED_FOR_FIRE");

    // First valid consume succeeds
    const fired = await consumeFireToken(
      store,
      approved,
      fireToken.token,
      sessionId,
      "robert",
      ownership
    );
    assert.ok(fired);
    assert.equal(fired.status, "FIRED");
    assert.equal(fired.humanFire?.approvedBy, "robert");
    assert.equal(fired.ownership.agentId, "seat:test:airlock");
    assert.equal(fired.ownership.responsible, true);

    // Verify token_consumed precedes fire_attempt allow receipt (AIRLOCK.md)
    const receipts = await store.query({ sessionId, draftId: draft.id });
    const consumedIdx = receipts.findIndex((r) => r.event === "token_consumed");
    const fireAllowIdx = receipts.findIndex(
      (r) => r.event === "fire_attempt" && r.decision === "allow"
    );
    assert.ok(consumedIdx >= 0, "token_consumed receipt must exist");
    assert.ok(fireAllowIdx > consumedIdx, "token_consumed must precede allow fire_attempt");
    assert.equal(
      receipts[fireAllowIdx].prevReceiptId,
      receipts[consumedIdx].receiptId
    );

    // Replay with the exact same token MUST fail and emit a deny fire_attempt receipt
    const replayed = await consumeFireToken(
      store,
      approved,
      fireToken.token,
      sessionId,
      "robert",
      ownership
    );
    assert.equal(replayed, null);

    // Cannot issue a new token or approve an already-fired draft ID
    assert.equal(issueFireToken(pending), null);
    assert.equal(markApprovedForFire(pending), null);

    const denyAttempts = (
      await store.query({ sessionId, draftId: draft.id, event: "fire_attempt" })
    ).filter((r) => r.decision === "deny");
    assert.ok(denyAttempts.length >= 2);
    assert.equal(
      denyAttempts.at(-1)?.meta?.reason,
      "token replay rejected"
    );
    assert.equal(await store.verifyChain(sessionId), true);
  });

  it("burns expired token on real wall-clock expiry and emits deny receipt", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:ttl");
    const sessionId = "sess-airlock-ttl";

    const draft = createDraft("Short-lived draft", "irreversible", ownership);
    const pending = { ...draft, status: "PENDING_HUMAN" as const };
    const token = issueFireToken(pending, { ttlMs: 25 });
    assert.ok(token);

    const approved = markApprovedForFire(pending);
    assert.ok(approved);

    await new Promise((resolve) => setTimeout(resolve, 45));

    const result = await consumeFireToken(
      store,
      approved,
      token.token,
      sessionId,
      "robert",
      ownership
    );
    assert.equal(result, null);

    const attempts = await store.query({
      sessionId,
      draftId: draft.id,
      event: "fire_attempt",
    });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].decision, "deny");
    assert.equal(attempts[0].meta?.reason, "token expired");
  });

  it("invalidates prior unused token on re-issue and rejects draft content tampering (TOCTOU)", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:tamper");
    const sessionId = "sess-airlock-tamper";

    const draft = createDraft("Original approved filing text", "legal_document", ownership);
    const pending = { ...draft, status: "PENDING_HUMAN" as const };

    const t1 = issueFireToken(pending);
    const t2 = issueFireToken(pending);
    assert.ok(t1 && t2);
    assert.notEqual(t1.token, t2.token);

    const approved = markApprovedForFire(pending);
    assert.ok(approved);

    // t1 was burned when t2 was issued (prevents multi-token double-fire)
    const oldTokenTry = await consumeFireToken(
      store,
      approved,
      t1.token,
      sessionId,
      "robert",
      ownership
    );
    assert.equal(oldTokenTry, null);

    // Tampering draft.content after token issuance must be denied and burn t2
    const tampered = { ...approved, content: "MODIFIED MALICIOUS TEXT" };
    const tamperedTry = await consumeFireToken(
      store,
      tampered,
      t2.token,
      sessionId,
      "robert",
      ownership
    );
    assert.equal(tamperedTry, null);

    // Even retrying t2 with original content now fails because t2 was burned on tamper detection
    const retryAfterTamper = await consumeFireToken(
      store,
      approved,
      t2.token,
      sessionId,
      "robert",
      ownership
    );
    assert.equal(retryAfterTamper, null);

    const attempts = await store.query({
      sessionId,
      draftId: draft.id,
      event: "fire_attempt",
    });
    assert.equal(attempts.length, 3);
    assert.ok(attempts.every((a) => a.decision === "deny"));
    assert.equal(
      attempts[1].meta?.reason,
      "draft content modified after token issuance"
    );
  });

  it("rejects unknown token, cross-draft token reuse, and blank humanId", async () => {
    const store = new MemoryAuditStore();
    const ownership = makeOwnership("seat:test:cross");
    const sessionId = "sess-airlock-cross";

    const d1 = { ...createDraft("Draft one", "irreversible", ownership), status: "PENDING_HUMAN" as const };
    const d2 = { ...createDraft("Draft two", "irreversible", ownership), status: "PENDING_HUMAN" as const };

    const t1 = issueFireToken(d1);
    assert.ok(t1);
    const a1 = markApprovedForFire(d1);
    const a2 = markApprovedForFire(d2);
    assert.ok(a1 && a2);

    // Unknown token
    assert.equal(
      await consumeFireToken(store, a1, "non-existent-token", sessionId, "robert", ownership),
      null
    );

    // Cross-draft token
    assert.equal(
      await consumeFireToken(store, a2, t1.token, sessionId, "robert", ownership),
      null
    );

    // Blank humanId
    assert.equal(
      await consumeFireToken(store, a1, t1.token, sessionId, "   ", ownership),
      null
    );

    const receipts = await store.query({ sessionId, event: "fire_attempt" });
    assert.equal(receipts.length, 3);
    assert.ok(receipts.every((r) => r.decision === "deny"));
  });
});
