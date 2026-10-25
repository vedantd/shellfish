import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { contentHash } from "../../packages/registry/dist/index.js";
import {
  CAPTURE_SHA256,
  loadReplayFixture,
  openReplay,
  recordedLoanFacts,
  registryMinor,
  runReplay,
  validateReplayFixture,
} from "./replay.mjs";

const event = (session, name) => structuredClone(session.fixture.events.steps.find(step => step.step_id === name).event);
const day = 86400;

function reserved() {
  const session = openReplay();
  session.registry.reserveRequest(session.request);
  return session;
}

async function active() {
  const session = reserved();
  try {
    await session.registry.applyEvent(event(session, "stake"));
    await session.registry.applyEvent(event(session, "origin"));
    return session;
  } catch (error) {
    session.close();
    throw error;
  }
}

test("saved POC preserves gross principal, net proceeds, maximum, debit and principal reduction", () => {
  const fixture = loadReplayFixture();
  assert.equal(fixture.evidenceSha256, CAPTURE_SHA256);
  const facts = recordedLoanFacts(fixture.evidence);
  assert.equal(facts.gross_principal_native_units, "1000");
  assert.equal(facts.borrower_received_native_units, "900");
  assert.equal(facts.submitted_loan_pay_max_native_units, "2000");
  assert.equal(facts.actual_borrower_debit_native_units, "1015");
  assert.equal(facts.principal_reduction_native_units, "1000");
  assert.equal(registryMinor("1000", 0, 100), "100000");
  assert.throws(() => registryMinor("1", 3, 100), /Unsupported precision/);
});

test("offline E2E restores the original bond once and persists no native receipts", async () => {
  const report = await runReplay();
  assert.equal(report.result, "PASS");
  assert.equal(report.steps.length, 7);
  assert.equal(report.applied_event_count, 5);
  assert.equal(report.return_credit_count, 1);
  assert.equal(report.final_request_state, "REPAID");
  assert.equal(report.steps.at(-1).reputation.available_u, "1000000000");
  assert.equal(report.duplicate_delivery, "PASS");
  assert.equal(report.repeat_enrollment, "PASS");
  assert.equal(report.native_signing_permitted, false);
  assert.equal(report.live_verification_performed, false);
  assert.equal(report.native_reward_status, "NOT_EVALUATED");
});

const invalidFixtures = [
  ["removed source facts", f => { f.events.source_facts = {}; }],
  ["native mode", f => { f.events.mode = "LIVE_DEVNET"; }],
  ["native signing permission", f => { f.events.native_signing_permitted = true; }],
  ["native proof on a simulated event", f => { f.events.steps[0].event.native = { validated: true }; }],
  ["wrong principal from total debit", f => { f.events.request.principal_minor = "101500"; }],
  ["wrong principal from submitted maximum", f => { f.events.request.principal_minor = "200000"; }],
  ["wrong displayed unit conversion", f => { f.events.unit_mapping.actual_borrower_debit_minor = "200000"; }],
  ["invented reward interval", f => { f.events.steps[3].event.occurredAt += 2; }],
  ["native result label on expected output", f => { f.expected.mode = "LIVE_DEVNET"; }],
  ["contradictory terms with freshly recomputed hashes", f => {
    f.events.commitment_inputs.commercial_terms.origination_fee_minor = "0";
    f.events.request.commercial_terms_hash = contentHash(f.events.commitment_inputs.commercial_terms);
    f.events.request_payload_hash = contentHash(f.events.request);
    f.events.steps[0].event.stake.requestHash = f.events.request_payload_hash;
  }],
  ["changed capture with a matching rewritten adjacent digest", f => {
    const bytes = Buffer.concat([Buffer.from(f.evidenceBytes), Buffer.from("\n")]);
    f.evidenceBytes = bytes;
    f.evidenceSha256 = createHash("sha256").update(bytes).digest("hex");
    f.events.source_evidence_sha256 = f.evidenceSha256;
  }],
];
for (const [label, mutate] of invalidFixtures) {
  test(`fixture rejects ${label} before opening the database`, () => {
    const fixture = structuredClone(loadReplayFixture());
    mutate(fixture);
    assert.throws(() => validateReplayFixture(fixture));
  });
}

test("unknown origination retains both holds and does not create a second reservation", async () => {
  const session = reserved();
  try {
    await session.registry.applyEvent(event(session, "stake"));
    const before = session.snapshot();
    await session.registry.applyEvent(event(session, "unknown"));
    assert.deepEqual(session.snapshot(), before);
    assert.equal(session.registry.getRequest(session.request.request_id).state, "RECONCILING");
    assert.equal(session.registry.reserveRequest(session.request).originalBondU, "240000000");
    assert.deepEqual(session.snapshot(), before);
  } finally { session.close(); }
});

test("wrong redemption destination and attached native evidence cannot activate the loan", async () => {
  const session = reserved();
  try {
    const before = session.snapshot();
    const wrong = event(session, "stake");
    wrong.stake.destination = "sim:different-issuer";
    await assert.rejects(session.registry.applyEvent(wrong), /DENY_STAKE_PROOF/);
    const native = event(session, "stake");
    native.native = { txHash: session.facts.loan_set_hash, ledgerIndex: 6396437, transactionIndex: 0,
      validated: true, result: "tesSUCCESS", transactionType: "Payment" };
    await assert.rejects(session.registry.applyEvent(native), /SIMULATION_CANNOT_CLAIM_NATIVE_PROOF/);
    await assert.rejects(session.registry.applyEvent(event(session, "origin")), /STAKE_REQUIRED/);
    assert.deepEqual(session.snapshot(), before);
  } finally { session.close(); }
});

test("incomplete history leaves the original bond bonded and creates no return credit", async () => {
  const session = await active();
  try {
    const before = session.snapshot();
    const repay = event(session, "repay");
    repay.history.previousEventId = "sim:missing-event";
    await assert.rejects(session.registry.applyEvent(repay), /Backfill complete ordered history/);
    assert.deepEqual(session.snapshot(), before);
    assert.equal(session.registry.getReturnCredits(session.binding).length, 0);
  } finally { session.close(); }
});

test("a different payload under an applied event ID fails without reducing principal twice", async () => {
  const session = await active();
  try {
    const repay = event(session, "repay");
    await session.registry.applyEvent(repay);
    const before = session.snapshot();
    const changed = structuredClone(repay);
    changed.repayment.principalReductionMinor = "101500";
    await assert.rejects(session.registry.applyEvent(changed), /EVENT_CONFLICT/);
    assert.deepEqual(session.snapshot(), before);
    assert.equal(session.registry.getReturnCredits(session.binding).length, 1);
  } finally { session.close(); }
});

test("pending issuer return stays unspendable after unknown outcome or wrong return amount", async () => {
  const session = await active();
  try {
    await session.registry.applyEvent(event(session, "repay"));
    const before = session.snapshot();
    assert.equal(before.reputation.available_u, "760000000");
    assert.equal(before.reputation.pending_return_u, "240000000");
    const credit = session.registry.getReturnCredits(session.binding)[0];
    await session.registry.applyEvent({ eventId: "sim:unknown-return", kind: "UNKNOWN", occurredAt: session.now(), creditId: credit.creditId });
    assert.deepEqual(session.snapshot(), before);
    const returned = event(session, "return");
    session.advance(returned.occurredAt);
    returned.returned.amountU = "240000001";
    await assert.rejects(session.registry.applyEvent(returned), /INVALID_REP_RETURN/);
    assert.deepEqual(session.snapshot(), before);
    assert.equal(session.registry.getReturnCredits(session.binding)[0].state, "OWED");
  } finally { session.close(); }
});

test("separate synthetic 30-day loan earns 2 REP, issued once with its 240 REP bond", async () => {
  const session = await active();
  try {
    const repay = event(session, "repay");
    repay.eventId = "sim:synthetic-30-day-repayment";
    repay.occurredAt += 30 * day;
    session.advance(repay.occurredAt);
    await session.registry.applyEvent(repay);
    const credit = session.registry.getReturnCredits(session.binding)[0];
    assert.equal(credit.growthU, "2000000");
    assert.equal(credit.amountU, "242000000");
    assert.equal(session.snapshot().reputation.available_u, "760000000");
    await session.registry.applyEvent(repay);
    assert.equal(session.registry.getReturnCredits(session.binding).length, 1);
    const returned = event(session, "return");
    returned.occurredAt = repay.occurredAt + 1;
    returned.returned.amountU = credit.amountU;
    session.advance(returned.occurredAt);
    await session.registry.applyEvent(returned);
    const after = session.snapshot();
    await session.registry.applyEvent(returned);
    assert.deepEqual(session.snapshot(), after);
    assert.equal(after.reputation.available_u, "1002000000");
    assert.equal(after.reputation.pending_return_u, "0");
  } finally { session.close(); }
});

test("separate synthetic partial repayment releases no bond and earns principal-time growth", async () => {
  const session = await active();
  try {
    const partial = event(session, "repay");
    partial.eventId = "sim:synthetic-day-15-partial";
    partial.occurredAt += 15 * day;
    partial.repayment.principalReductionMinor = "50000";
    partial.repayment.fullContractualRepayment = false;
    session.advance(partial.occurredAt);
    await session.registry.applyEvent(partial);
    assert.equal(session.snapshot().active_principal_minor, "50000");
    assert.equal(session.snapshot().reputation.bonded_u, "240000000");
    assert.equal(session.snapshot().reputation.available_u, "760000000");
    assert.equal(session.registry.getReturnCredits(session.binding).length, 0);
    const final = event(session, "repay");
    final.eventId = "sim:synthetic-day-30-final";
    final.occurredAt += 30 * day;
    final.repayment.principalReductionMinor = "50000";
    final.history.previousEventId = partial.eventId;
    session.advance(final.occurredAt);
    await session.registry.applyEvent(final);
    const credit = session.registry.getReturnCredits(session.binding)[0];
    assert.equal(credit.growthU, "1500000");
    assert.equal(credit.amountU, "241500000");
  } finally { session.close(); }
});

test("separate synthetic default forfeits the bond, records liability and denies new borrowing", async () => {
  const session = await active();
  try {
    const origin = event(session, "origin");
    const at = origin.loan.nextPaymentDueAt + origin.loan.graceSeconds + 1;
    session.advance(at);
    await session.registry.applyEvent({ eventId: "sim:synthetic-default", kind: "DEFAULT", occurredAt: at,
      loanId: origin.loan.loanId, history: { complete: true, originHash: `sim:${origin.eventId}`, previousEventId: origin.eventId } });
    const state = session.snapshot();
    assert.equal(state.active_principal_minor, "0");
    assert.equal(state.defaulted_principal_minor, "100000");
    assert.equal(state.reputation.forfeited_u, "240000000");
    assert.equal(state.reputation.available_u, "760000000");
    assert.equal(state.reputation.suspended, true);
    assert.equal(session.registry.getReturnCredits(session.binding).length, 0);
    assert.throws(() => session.registry.reserveRequest({ ...session.request, request_id: "sim:after-default",
      idempotency_key: "sim:after-default", mandate_id: "sim:new-mandate", nonce: "sim:new-nonce",
      expires_at: new Date((at + 60) * 1000).toISOString() }), /DENY_SUSPENDED/);
  } finally { session.close(); }
});
