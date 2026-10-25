import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  APPROVED_REP_POLICY_HASH,
  assertSupportedSqliteRuntime,
  contentHash,
  createRegistry,
  quoteRepBondU,
} from "../../packages/registry/dist/index.js";
import {
  CreditSnapshot,
  ReservationFixture,
  ScenarioFixture,
} from "../../packages/schemas/dist/index.js";

const folder = new URL("./", import.meta.url);
const require = createRequire(new URL("../../services/api/package.json", import.meta.url));
const unsigned = /^(0|[1-9][0-9]*)$/;
export const CAPTURE_SHA256 = "f5e5a1403016b00f05086a1fd986138da2255d694314d956a9f6fcdee56fcd96";

function integer(value, name) {
  assert.equal(typeof value, "string", `${name} must be an integer string`);
  assert.match(value, unsigned, `${name} must be a nonnegative integer string`);
  return BigInt(value);
}

function one(items, predicate, name) {
  const matches = items.filter(predicate);
  assert.equal(matches.length, 1, `Expected one ${name}`);
  return matches[0];
}

/** Read this frozen capture only. This function performs no native verification or network I/O. */
export function recordedLoanFacts(evidence) {
  assert.equal(evidence.network, "devnet");
  const origin = one(evidence.transactions, t => t.transaction.TransactionType === "LoanSet", "LoanSet capture");
  const repayment = one(evidence.transactions, t => t.transaction.TransactionType === "LoanPay", "LoanPay capture");
  for (const transaction of [origin, repayment]) {
    assert.equal(transaction.validated, true, "Saved transaction must record validation");
    assert.equal(transaction.result, "tesSUCCESS", "Saved transaction must record success");
    assert.match(transaction.hash, /^[A-F0-9]{64}$/);
  }
  assert.ok(origin.ledger_index < repayment.ledger_index, "Capture must place origination before repayment");
  const created = one(origin.ledger_changes, n => n.entry_type === "Loan" && n.change === "CreatedNode", "created Loan");
  const changed = one(repayment.ledger_changes, n => n.entry_type === "Loan" && n.entry_id === created.entry_id, "repaid Loan");
  assert.equal(repayment.transaction.LoanID, created.entry_id, "LoanPay must target the created Loan");
  assert.equal(created.entry_id, evidence.public_identifiers.loan_id);
  const borrower = created.final_or_created_fields.Borrower;
  assert.equal(repayment.transaction.Account, borrower);
  assert.equal(evidence.public_identifiers.borrower, borrower);
  assert.equal(origin.transaction.Counterparty, borrower);
  const asset = evidence.loan_asset.mpt_issuance_id;
  assert.equal(repayment.transaction.Amount.mpt_issuance_id, asset);
  const vault = one(origin.ledger_changes, n => n.entry_type === "Vault", "origin vault");
  assert.equal(vault.final_or_created_fields.Asset.mpt_issuance_id, asset);
  const balance = transaction => one(transaction.ledger_changes,
    n => n.entry_type === "MPToken" && n.account === borrower && n.mpt_issuance_id === asset,
    "borrower asset balance change");
  const received = balance(origin);
  const paid = balance(repayment);
  const delta = node => BigInt(node.after) - BigInt(node.before);
  assert.equal(delta(received).toString(), received.delta);
  assert.equal(delta(paid).toString(), paid.delta);
  assert.ok(delta(received) > 0n && delta(paid) < 0n);
  const before = integer(changed.previous_fields.PrincipalOutstanding, "recorded principal before");
  // The pinned capture omits zero-valued optional Loan amounts. This is a capture interpretation,
  // not a general LoanPay verifier. Native history and terminal-state verification remain Vedant's work.
  const final = changed.final_or_created_fields;
  const after = integer(final.PrincipalOutstanding ?? "0", "recorded principal after");
  assert.equal(final.Flags, 0, "This capture must contain no default or impairment flag");
  assert.equal(final.PaymentRemaining ?? 0, 0);
  assert.equal(integer(final.TotalValueOutstanding ?? "0", "recorded obligation after"), 0n);
  assert.equal(before.toString(), origin.transaction.PrincipalRequested);
  assert.equal(created.final_or_created_fields.PrincipalOutstanding, before.toString());
  assert.ok(before >= after);
  const start = created.final_or_created_fields.StartDate;
  return {
    network: evidence.network,
    provenance: "SAVED_NATIVE_DEVNET_EVIDENCE",
    borrower_account: borrower,
    loan_asset: { mpt_issuance_id: asset },
    loan_asset_issuer: evidence.loan_asset.issuer,
    native_asset_scale: evidence.loan_asset.asset_scale,
    loan_id: created.entry_id,
    loan_set_hash: origin.hash,
    loan_pay_hash: repayment.hash,
    gross_principal_native_units: before.toString(),
    borrower_received_native_units: delta(received).toString(),
    submitted_loan_pay_max_native_units: repayment.transaction.Amount.value,
    actual_borrower_debit_native_units: (-delta(paid)).toString(),
    principal_reduction_native_units: (before - after).toString(),
    principal_after_native_units: after.toString(),
    origination_fee_native_units: origin.transaction.LoanOriginationFee,
    service_fee_native_units: origin.transaction.LoanServiceFee,
    interest_rate_native: origin.transaction.InterestRate,
    nominal_annual_rate_bps: origin.transaction.InterestRate / 10,
    payment_interval_seconds: origin.transaction.PaymentInterval,
    payment_total: origin.transaction.PaymentTotal,
    grace_period_seconds: origin.transaction.GracePeriod,
    loan_set_ledger_index: origin.ledger_index,
    loan_pay_ledger_index: repayment.ledger_index,
    loan_set_close_time_iso: origin.close_time_iso,
    loan_pay_close_time_iso: repayment.close_time_iso,
    loan_start_date_ripple_seconds: start,
    next_payment_due_date_ripple_seconds: created.final_or_created_fields.NextPaymentDueDate,
    native_repayment_history_status: "NOT_ESTABLISHED_BY_THIS_REPLAY",
    native_reward_status: "NOT_EVALUATED",
    rep_operations_demonstrated: false,
    shellfish_signer_gate_demonstrated: false,
  };
}

/** Convert exact captured asset quantities into registry minor units without rounding. */
export function registryMinor(nativeUnits, nativeScale, moneyScale) {
  assert.ok(Number.isSafeInteger(nativeScale) && nativeScale >= 0 && nativeScale <= 18);
  const scaled = integer(nativeUnits, "native units") * BigInt(moneyScale);
  const divisor = 10n ** BigInt(nativeScale);
  assert.equal(scaled % divisor, 0n, "Unsupported precision cannot be rounded into registry units");
  return (scaled / divisor).toString();
}

export function loadReplayFixture(directory = folder) {
  const base = directory instanceof URL ? directory : pathToFileURL(resolve(directory) + sep);
  const bytes = readFileSync(new URL("native-evidence.json", base));
  const read = name => JSON.parse(readFileSync(new URL(name, base), "utf8"));
  return {
    evidenceBytes: bytes,
    evidence: JSON.parse(bytes.toString("utf8")),
    evidenceSha256: createHash("sha256").update(bytes).digest("hex"),
    scenario: read("scenario.json"),
    events: read("events.json"),
    expected: read("expected.json"),
  };
}

/** Reject a changed source, relabelled simulation or inconsistent amount before creating a database. */
export function validateReplayFixture(fixture) {
  const { evidence, evidenceSha256, events, expected } = fixture;
  const scenario = ScenarioFixture.parse(fixture.scenario);
  const request = ReservationFixture.shape.request.parse(events.request);
  assert.equal(events.fixture_version, "XRPL-POC-REPLAY-1");
  assert.equal(events.mode, "SIMULATED_LOAN");
  assert.equal(events.provenance, "SYNTHETIC");
  assert.equal(events.native_signing_permitted, false);
  assert.equal(events.native_ready, false);
  assert.equal(evidenceSha256, CAPTURE_SHA256, "This replay requires its pinned POC capture");
  assert.equal(createHash("sha256").update(fixture.evidenceBytes).digest("hex"), CAPTURE_SHA256, "Frozen evidence bytes changed");
  assert.deepEqual(evidence, JSON.parse(Buffer.from(fixture.evidenceBytes).toString("utf8")), "Capture object differs from its bytes");
  assert.equal(events.source_evidence_sha256, evidenceSha256, "Frozen evidence bytes changed");
  const facts = recordedLoanFacts(evidence);
  const { native_asset_scale: _scale, principal_after_native_units: _after, ...sourceFacts } = facts;
  assert.deepEqual(events.source_facts, sourceFacts, "Source facts must match the complete capture interpretation");
  assert.equal(events.history_provenance, "SCRIPTED_SIMULATION_ONLY");
  assert.equal(events.source_reference_only, true);
  assert.equal(events.clock_policy.kind, "ZERO_ELAPSED_SYNTHETIC_LOAN");
  assert.equal(events.clock_policy.native_reward_status, "NOT_EVALUATED");
  assert.equal(events.clock_policy.elapsed_principal_seconds, 0);
  assert.equal(events.clock_policy.native_timestamps_unchanged, true);
  assert.equal(events.unit_mapping.native_asset_scale, facts.native_asset_scale);
  assert.equal(events.unit_mapping.registry_money_scale, scenario.money_scale);
  for (const [field, source] of [
    ["gross_principal_minor", "gross_principal_native_units"],
    ["borrower_received_minor", "borrower_received_native_units"],
    ["submitted_loan_pay_max_minor", "submitted_loan_pay_max_native_units"],
    ["actual_borrower_debit_minor", "actual_borrower_debit_native_units"],
    ["principal_reduction_minor", "principal_reduction_native_units"],
    ["origination_fee_minor", "origination_fee_native_units"],
    ["service_fee_minor", "service_fee_native_units"],
  ]) {
    assert.equal(events.unit_mapping[field], registryMinor(facts[source], facts.native_asset_scale, scenario.money_scale), `Unit mapping changed: ${field}`);
  }
  assert.equal(events.unit_mapping.native_units_to_registry_minor_multiplier, "100");
  assert.equal(events.unit_mapping.rep_asset_scale, scenario.rep_asset.asset_scale);
  assert.equal(events.unit_mapping.rep_scale, scenario.rep_scale);
  assert.equal(scenario.mode, "SIMULATED_LOAN");
  assert.equal(scenario.network, facts.network);
  assert.deepEqual(scenario.loan_asset, facts.loan_asset);
  assert.deepEqual(scenario.facility.asset, scenario.loan_asset);
  assert.equal(scenario.policy_hash, APPROVED_REP_POLICY_HASH);
  assert.equal(scenario.opening.active_principal_minor, "0");
  assert.equal(scenario.opening_loans.length, 0);
  assert.match(scenario.principal_id, /^sim:/);
  assert.match(events.borrower_account, /^sim:/);
  assert.match(scenario.rep_asset.issuer, /^sim:/);
  assert.match(scenario.rep_asset.mpt_issuance_id, /^sim:/);
  assert.equal(request.mode, "SIMULATED_LOAN");
  assert.equal(request.principal_id, scenario.principal_id);
  assert.equal(request.facility_id, scenario.facility.facility_id);
  assert.equal(request.network, scenario.network);
  assert.deepEqual(request.asset, scenario.loan_asset);
  assert.deepEqual(request.rep_asset, scenario.rep_asset);
  assert.equal(request.policy_hash, scenario.policy_hash);
  assert.equal(request.principal_minor, registryMinor(facts.gross_principal_native_units, facts.native_asset_scale, scenario.money_scale));
  assert.equal(request.max_stake_u, quoteRepBondU(0n, BigInt(request.principal_minor), BigInt(scenario.money_scale)).toString());
  assert.equal(contentHash(events.commitment_inputs.policy), scenario.policy_hash);
  const { consent, mandate, evidence: passport, commercial_terms: terms } = events.commitment_inputs;
  assert.equal(consent.authorized, true);
  assert.equal(consent.model_version, request.model_version);
  assert.equal(consent.policy_hash, request.policy_hash);
  assert.equal(consent.max_stake_u, request.max_stake_u);
  assert.deepEqual(consent.rep_asset, request.rep_asset);
  assert.deepEqual(mandate.rep_consent, consent);
  for (const field of ["contract_version", "model_version", "network", "mode", "mandate_id", "principal_id", "agent_id", "nonce", "expires_at"]) {
    assert.equal(mandate[field], request[field], `Mandate binding changed: ${field}`);
  }
  assert.equal(mandate.xrpl_borrower, events.borrower_account);
  assert.deepEqual(mandate.asset, request.asset);
  assert.equal(passport.subject_id, request.principal_id);
  assert.deepEqual(passport.known_exposure.asset, request.asset);
  assert.equal(passport.known_exposure.amount, "0.00");
  assert.equal(passport.provenance, "SYNTHETIC");
  assert.equal(passport.mode, "SIMULATED_LOAN");
  for (const field of ["contract_version", "model_version", "network", "mode", "principal_id", "facility_id", "offer_id", "principal_minor", "expires_at"]) {
    assert.equal(terms[field], request[field], `Commercial binding changed: ${field}`);
  }
  assert.equal(terms.borrower_account, events.borrower_account);
  assert.equal(terms.lender_id, scenario.facility.lender_id);
  assert.deepEqual(terms.asset, request.asset);
  assert.equal(terms.money_scale, scenario.money_scale);
  assert.equal(terms.apr_bps, facts.nominal_annual_rate_bps);
  assert.equal(terms.origination_fee_minor, events.unit_mapping.origination_fee_minor);
  assert.equal(terms.service_fee_minor, events.unit_mapping.service_fee_minor);
  assert.equal(terms.schedule.payment_interval_seconds, facts.payment_interval_seconds);
  assert.equal(terms.schedule.payment_total, facts.payment_total);
  assert.equal(terms.schedule.native_acceptance, "PENDING_VEDANT");
  assert.equal(terms.grace_seconds, facts.grace_period_seconds);
  assert.equal(terms.provenance, "SYNTHETIC");
  assert.equal(terms.native_signing_permitted, false);
  for (const [field, object] of [["mandate_hash", "mandate"], ["evidence_hash", "evidence"], ["commercial_terms_hash", "commercial_terms"]]) {
    assert.equal(request[field], contentHash(events.commitment_inputs[object]), `${field} must use this replay's inputs`);
  }
  assert.equal(events.request_payload_hash, contentHash(request));
  for (const [key, value] of Object.entries({ fixture_version: events.fixture_version, mode: "SIMULATED_LOAN", provenance: "SYNTHETIC",
    native_signing_permitted: false, native_ready: false, source_evidence_sha256: evidenceSha256,
    history_provenance: "SCRIPTED_SIMULATION_ONLY", native_reward_status: "NOT_EVALUATED" })) {
    assert.equal(expected[key], value, `Expected-output label changed: ${key}`);
  }
  assert.deepEqual(events.steps.map(step => step.step_id), ["stake", "unknown", "origin", "repay", "return"]);
  const origin = events.steps.find(step => step.step_id === "origin").event;
  const repay = events.steps.find(step => step.step_id === "repay").event;
  const stake = events.steps.find(step => step.step_id === "stake").event;
  const returned = events.steps.find(step => step.step_id === "return").event;
  const kinds = { stake: "STAKE_VALIDATED", unknown: "UNKNOWN", origin: "ORIGINATION_VALIDATED", repay: "REPAYMENT", return: "RETURN_VALIDATED" };
  for (const step of events.steps) {
    assert.equal(step.provenance, "SYNTHETIC");
    assert.equal(step.native_signing_permitted, false);
    assert.equal(step.source_reference_only, true);
    assert.equal(Object.hasOwn(step.event, "native"), false, "A replay event cannot claim native proof");
    assert.equal(step.event.kind, kinds[step.step_id]);
    assert.match(step.event.eventId, /^sim:/);
    if (step.event.loanId) assert.match(step.event.loanId, /^sim:/);
    if (step.event.requestId) assert.equal(step.event.requestId, request.request_id);
    assert.equal(step.source_transaction_hash, ({ origin: facts.loan_set_hash, repay: facts.loan_pay_hash })[step.step_id] ?? null);
    assert.equal(step.event.occurredAt, origin.occurredAt + (step.step_id === "return" ? 1 : 0));
  }
  assert.equal(stake.stake.requestHash, events.request_payload_hash);
  assert.equal(stake.stake.amountU, request.max_stake_u);
  assert.equal(origin.occurredAt, Math.floor(Date.parse(scenario.clock) / 1000));
  assert.equal(events.clock_policy.origin_unix_seconds, origin.occurredAt);
  assert.equal(events.clock_policy.repayment_unix_seconds, repay.occurredAt);
  assert.equal(events.clock_policy.return_unix_seconds, returned.occurredAt);
  assert.equal(repay.occurredAt, origin.occurredAt, "POC rewards must not use an invented native interval");
  assert.match(origin.loan.loanId, /^sim:/);
  assert.equal(origin.loan.maturityAt - origin.occurredAt, facts.payment_interval_seconds);
  assert.equal(origin.loan.graceSeconds, facts.grace_period_seconds);
  assert.equal(repay.loanId, origin.loan.loanId);
  assert.equal(repay.repayment.principalReductionMinor,
    registryMinor(facts.principal_reduction_native_units, facts.native_asset_scale, scenario.money_scale));
  assert.equal(repay.history.originHash, `sim:${origin.eventId}`);
  assert.equal(repay.history.previousEventId, origin.eventId);
  assert.equal(repay.history.complete, true);
  assert.equal(repay.repayment.fullContractualRepayment, true);
  assert.equal(repay.repayment.onTime, true);
  assert.equal(returned.creditId, `credit:${contentHash({ requestId: request.request_id, loanId: origin.loan.loanId, reason: "REPAYMENT" })}`);
  assert.equal(returned.returned.amountU, request.max_stake_u);
  assert.equal(expected.quote.bond_u, request.max_stake_u);
  assert.equal(expected.original_bond_u, request.max_stake_u);
  assert.equal(expected.simulated_elapsed_principal_seconds, 0);
  assert.equal(expected.simulated_growth_u, "0");
  for (const snapshot of Object.values(expected.snapshots)) CreditSnapshot.parse(snapshot);
  return { scenario, request, facts };
}

function snapshot(registry, binding) {
  const { portfolioKey: _key, ...state } = registry.getPortfolio(binding);
  return state;
}

export function openReplay(fixture = loadReplayFixture()) {
  const checked = validateReplayFixture(fixture);
  assertSupportedSqliteRuntime();
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  let clock = Math.floor(Date.parse(checked.scenario.clock) / 1000);
  try {
    const registry = createRegistry(db, { now: () => new Date(clock * 1000) });
    const binding = { principalId: checked.scenario.principal_id, network: checked.scenario.network, asset: checked.scenario.loan_asset };
    registry.seedScenario(checked.scenario, fixture.events.borrower_account);
    return {
      ...checked,
      fixture,
      registry,
      db,
      binding,
      now: () => clock,
      advance: seconds => { assert.ok(seconds >= clock); clock = seconds; },
      snapshot: () => snapshot(registry, binding),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Complete offline accounting flow. Every applied event remains a simulation. */
export async function runReplay(fixture = loadReplayFixture()) {
  const session = openReplay(fixture);
  const { registry, request, binding, facts } = session;
  const results = [];
  function check(stepId) {
    const state = session.snapshot();
    assert.deepEqual(state, fixture.expected.snapshots[stepId], `${stepId}: accounting mismatch`);
    if (stepId !== "seed") {
      assert.equal(registry.getRequest(request.request_id).state, fixture.expected.request_states[stepId]);
    }
    assert.equal(registry.getFacility(request.facility_id).version, fixture.expected.facility_versions[stepId]);
    const credits = registry.getReturnCredits(binding);
    const expectedState = fixture.expected.return_credit_states[stepId];
    assert.equal(credits.length, expectedState === null ? 0 : 1);
    if (expectedState !== null) {
      assert.equal(credits[0].state, expectedState);
      for (const [key, value] of Object.entries(fixture.expected.return_credit)) assert.equal(credits[0][key], value);
      assert.equal(credits[0].returnHash, expectedState === "PAID" ? fixture.expected.simulated_return_hash : null);
    }
    results.push({ step: stepId, mode: "SIMULATED_LOAN", native_signing_permitted: false, ...state });
  }
  try {
    check("seed");
    registry.seedScenario(session.scenario, fixture.events.borrower_account);
    assert.deepEqual(session.snapshot(), fixture.expected.snapshots.seed, "Repeated enrollment cannot issue more REP");
    const reservation = registry.reserveRequest(request);
    check("reserve");
    assert.equal(registry.reserveRequest(request).reservationId, reservation.reservationId);
    assert.deepEqual(session.snapshot(), fixture.expected.snapshots.reserve, "Reservation retry cannot reserve twice");
    for (const step of fixture.events.steps) {
      session.advance(step.event.occurredAt);
      await registry.applyEvent(step.event);
      check(step.step_id);
      const counts = session.db.prepare("SELECT count(*) n FROM credit_events").get().n;
      await registry.applyEvent(step.event);
      assert.deepEqual(session.snapshot(), fixture.expected.snapshots[step.step_id], "Event retry cannot change accounting twice");
      assert.equal(session.db.prepare("SELECT count(*) n FROM credit_events").get().n, counts);
    }
    const credits = registry.getReturnCredits(binding);
    assert.equal(credits.length, 1);
    assert.equal(credits[0].state, "PAID");
    assert.equal(credits[0].growthU, "0");
    const nativeRows = session.db.prepare("SELECT count(*) n FROM credit_events WHERE tx_hash IS NOT NULL OR ledger_index IS NOT NULL OR transaction_index IS NOT NULL").get().n;
    assert.equal(nativeRows, 0, "Simulated events cannot persist native ledger receipts");
    return {
      fixture_version: fixture.events.fixture_version,
      result: "PASS",
      mode: "SIMULATED_LOAN",
      evidence_status: "SAVED_DEVNET_CAPTURE_CHECKED_OFFLINE",
      live_verification_performed: false,
      native_signing_permitted: false,
      native_reward_status: "NOT_EVALUATED",
      synthetic_reward_u: "0",
      synthetic_clock_elapsed_seconds: 0,
      recorded_facts: facts,
      steps: results,
      duplicate_delivery: "PASS",
      repeat_enrollment: "PASS",
      return_credit_count: credits.length,
      applied_event_count: session.db.prepare("SELECT count(*) n FROM credit_events").get().n,
      final_request_state: registry.getRequest(request.request_id).state,
    };
  } finally {
    session.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.stdout.write(`${JSON.stringify(await runReplay(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Replay failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
