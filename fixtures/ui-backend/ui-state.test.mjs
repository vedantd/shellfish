import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.env.SOURCE_REPO;
if (!repo) throw new Error('Set SOURCE_REPO to the Shellfish checkout');
const { loadSourceRuntime } = await import(pathToFileURL(resolve(repo, 'fixtures/consumer-acceptance/source-runtime.mjs')).href);
const { schemas: S, registry: R, authorization: A, xrpl: X, Database } = await loadSourceRuntime(repo);
const { createUiStateStore } = await import(pathToFileURL(resolve(repo, 'services/api/src/db/ui-state.ts')).href);
const load = name => JSON.parse(readFileSync(resolve(repo, 'fixtures', name), 'utf8'));
const scenario = S.ScenarioFixture.parse(load('scenario.json'));
const mandate = S.BorrowingMandate.parse(load('mandate.json'));
const offer = S.LenderFacilityOffer.parse(load('offer-lender-a.json'));
const request = S.ReservationFixture.parse(load('reservation.json')).request;
const clock = () => new Date(scenario.clock);

function setup() {
  const folder = mkdtempSync(resolve(tmpdir(), 'shellfish-ui-state-'));
  const path = resolve(folder, 'state.db');
  let db, registry, state;
  const env = { path, open, close,
    get db() { return db; }, get registry() { return registry; }, get state() { return state; },
    receipt() {
      const receipt = A.authorizeExactAction({ mandate, offer, reservationRequest: request,
        proposalHash: R.contentHash(request), evidenceFresh: true, hashContent: R.contentHash,
        reserveRequest: raw => registry.reserveRequest(raw), now: clock() });
      state.storeApprovedOffer(offer);
      state.storeReceipt(receipt);
      return receipt;
    },
    async originate(receipt) {
      await X.originateLoan({ proposalHash: receipt.proposal_hash, principal: offer.principal,
        aprBps: offer.apr_bps, termDays: offer.term_days, asset: JSON.stringify(offer.asset),
        networkMode: 'SIMULATED_LOAN', requestId: receipt.request_id, reservationId: receipt.reservation_id }, {
        getRequest: id => registry.getRequest(id), applyEvent: event => registry.applyEvent(event),
        hashRequest: R.contentHash, getApprovedOffer: hash => state.getApprovedOffer(hash),
        clockSeconds: () => Math.floor(clock().getTime() / 1000), borrowerAccount: mandate.xrpl_borrower, repAsset: scenario.rep_asset,
      });
      const advanced = { ...receipt, signature_state: 'SIGNATURE_ISSUED', xrpl_state: 'SIMULATED' };
      state.storeReceipt(advanced);
      return advanced;
    },
    cleanup() { close(); rmSync(folder, { recursive: true, force: true }); },
  };
  function open() {
    db = new Database(path);
    registry = R.createRegistry(db, { now: clock });
    registry.seedScenario(scenario, mandate.xrpl_borrower);
    state = createUiStateStore(db, { hash: R.contentHash, now: clock });
  }
  function close() { if (db?.open) db.close(); }
  open(); return env;
}

test('approved offer and receipt survive closing and reopening the same SQLite file', () => {
  const env = setup(); try {
    const receipt = env.receipt(); env.close(); env.open();
    assert.deepEqual(env.state.getApprovedOffer(offer.commercial_terms_hash), offer);
    assert.deepEqual(env.state.getReceipt(receipt.request_id), receipt);
    assert.deepEqual(env.state.getReceipt(receipt.reservation_id), receipt);
  } finally { env.cleanup(); }
});

test('reopened state can originate the existing reservation without reauthorizing', async () => {
  const env = setup(); try {
    const receipt = env.receipt(); env.close(); env.open();
    const readback = env.state.getReceipt(receipt.request_id);
    await env.originate(readback);
    assert.equal(env.registry.getRequest(receipt.request_id).state, 'ACTIVE');
  } finally { env.cleanup(); }
});

test('stored outputs are detached from callers and remain immutable by terms hash', () => {
  const env = setup(); try {
    const receipt = env.receipt();
    const copy = env.state.getApprovedOffer(offer.commercial_terms_hash); copy.principal = '1.00';
    const other = env.state.getReceipt(receipt.request_id); other.reason_codes.push('DENY_REPLAY');
    assert.deepEqual(env.state.getApprovedOffer(offer.commercial_terms_hash), offer);
    assert.deepEqual(env.state.getReceipt(receipt.request_id), receipt);
    assert.throws(() => env.state.storeApprovedOffer({ ...offer, lender_signature: 'another-signature' }), /IMMUTABLE_OFFER_CONFLICT/);
  } finally { env.cleanup(); }
});

test('altered offer body with stale commitments cannot enter the store', () => {
  const env = setup(); try {
    assert.throws(() => env.state.storeApprovedOffer({ ...offer, principal: '3000.00' }), /OFFER_COMMITMENT_MISMATCH/);
    assert.equal(env.state.getApprovedOffer(offer.commercial_terms_hash), undefined);
  } finally { env.cleanup(); }
});

test('ALLOW needs a real persisted reservation and its approved offer', () => {
  const env = setup(); try {
    const raw = load('authorization-receipt-allow.json');
    assert.throws(() => env.state.storeReceipt(raw), /RESERVATION_REQUIRED/);
    const receipt = A.authorizeExactAction({ mandate, offer, reservationRequest: request,
      proposalHash: R.contentHash(request), evidenceFresh: true, hashContent: R.contentHash,
      reserveRequest: value => env.registry.reserveRequest(value), now: clock() });
    assert.throws(() => env.state.storeReceipt(receipt), /APPROVED_OFFER_REQUIRED/);
    assert.equal(env.db.prepare('SELECT count(*) AS n FROM app_ui_receipt_history').get().n, 0);
  } finally { env.cleanup(); }
});

test('cross-request reservation, quote, commitment and mode mutations are rejected', () => {
  const env = setup(); try {
    const receipt = env.receipt();
    for (const change of [ { reservation_id: 'res-other' }, { quote_bond_u: '1' },
      { proposal_hash: 'sha256:'+'0'.repeat(64) }, { mode: 'LIVE_DEVNET' }, { mandate_id: 'other' } ]) {
      assert.throws(() => env.state.storeReceipt({ ...receipt, ...change }), /BINDING_MISMATCH/);
    }
    assert.deepEqual(env.state.getReceipt(receipt.request_id), receipt);
  } finally { env.cleanup(); }
});

test('a later denial is audited without hiding the existing ALLOW receipt', () => {
  const env = setup(); try {
    const receipt = env.receipt();
    const denied = { ...receipt, decision: 'DENY', compatible: false, reason_codes: ['DENY_REPLAY'],
      checks: { ...receipt.checks, nonce: 'FAIL' }, reservation_id: null, quote_bond_u: '0',
      signature_state: 'DENIED', xrpl_state: 'NOT_SUBMITTED', stake_proof_id: null };
    env.state.storeReceipt(denied);
    assert.deepEqual(env.state.getReceipt(receipt.request_id), receipt);
    assert.deepEqual(env.state.getReceipt(receipt.reservation_id), receipt);
    assert.equal(env.db.prepare('SELECT count(*) AS n FROM app_ui_receipt_history').get().n, 2);
  } finally { env.cleanup(); }
});

test('a repeated authorization cannot erase an executed receipt after restart', async () => {
  const env = setup(); try {
    const receipt = env.receipt(); const advanced = await env.originate(receipt);
    env.close(); env.open(); env.state.storeReceipt(receipt);
    assert.deepEqual(env.state.getReceipt(receipt.request_id), advanced);
    assert.equal(env.db.prepare('SELECT count(*) AS n FROM app_ui_receipt_history').get().n, 2);
  } finally { env.cleanup(); }
});

test('simulation execution state needs an actual recorded loan', () => {
  const env = setup(); try {
    const receipt = env.receipt();
    assert.throws(() => env.state.storeReceipt({ ...receipt, xrpl_state: 'SIMULATED', signature_state: 'SIGNATURE_ISSUED' }), /EXECUTION_EVIDENCE_REQUIRED/);
  } finally { env.cleanup(); }
});

test('optional scope hides another mode and rejects cross-scope writes', () => {
  const env = setup(); try {
    const receipt = env.receipt();
    const live = createUiStateStore(env.db, { hash: R.contentHash, mode: 'LIVE_DEVNET', network: 'devnet' });
    assert.equal(live.getReceipt(receipt.request_id), undefined);
    assert.equal(live.getApprovedOffer(offer.commercial_terms_hash), undefined);
    assert.throws(() => live.storeApprovedOffer(offer), /SCOPE_MISMATCH/);
    assert.throws(() => live.storeReceipt(receipt), /SCOPE_MISMATCH/);
    const crossModeDenial = { ...receipt, mode: 'LIVE_DEVNET', decision: 'DENY', compatible: false,
      reason_codes: ['DENY_REPLAY'], reservation_id: null, quote_bond_u: '0',
      signature_state: 'DENIED', xrpl_state: 'NOT_SUBMITTED', stake_proof_id: null };
    assert.throws(() => live.storeReceipt(crossModeDenial), /SCOPE_MISMATCH/);
    assert.deepEqual(env.state.getReceipt(receipt.request_id), receipt);
  } finally { env.cleanup(); }
});

test('denials persist without a reservation and exact audit retry is idempotent', () => {
  const env = setup(); try {
    const denied = A.authorizeExactAction({ mandate, offer: { ...offer, principal: '3000.00' }, reservationRequest: request,
      proposalHash: R.contentHash(request), evidenceFresh: true, hashContent: R.contentHash,
      reserveRequest: value => env.registry.reserveRequest(value), now: clock() });
    env.state.storeReceipt(denied); env.state.storeReceipt(denied); env.close(); env.open();
    assert.deepEqual(env.state.getReceipt(denied.request_id), denied);
    assert.equal(env.db.prepare('SELECT count(*) AS n FROM app_ui_receipt_history').get().n, 1);
  } finally { env.cleanup(); }
});

test('real recorded native event references persist with public receipt hashes', async () => {
  const env = setup(); try {
    // This tests trusted-hook plumbing with synthetic native-shaped data, not a ledger.
    const native = structuredClone(scenario); delete native.provenance; delete native.native_signing_permitted;
    native.mode = 'LIVE_DEVNET'; native.principal_id = 'test-native-principal';
    native.loan_asset = { mpt_issuance_id: 'A'.repeat(48) };
    native.rep_asset = { mpt_issuance_id: 'B'.repeat(48), issuer: 'rTestIssuer', asset_scale: 6 };
    native.facility = { ...native.facility, facility_id: 'native-facility', asset: native.loan_asset };
    native.opening_loans = [];
    Object.assign(native.opening, { active_principal_minor: '0', facility_committed_minor: '0' });
    Object.assign(native.opening.reputation, { available_u: '1000000000', bonded_u: '0' });
    const registry = R.createRegistry(env.db, { now: clock, verifyNativePortfolio: async () => {}, verifyNativeEvent: async () => {} });
    await registry.initializeNativePortfolio(native, 'rTestBorrower', {});
    const liveOffer = { ...offer, mode: 'LIVE_DEVNET', borrower_id: native.principal_id, facility_id: native.facility.facility_id, asset: native.loan_asset };
    const keys = ['lender_id','borrower_id','facility_id','offer_id','asset','principal','apr_bps','rate_kind','term_days','fees','purpose','expires_at','schedule','network'];
    liveOffer.commercial_terms_hash = R.contentHash(Object.fromEntries(Object.entries(liveOffer).filter(([key]) => keys.includes(key))));
    liveOffer.offer_hash = R.contentHash(S.withoutFields(liveOffer, ['lender_signature', 'offer_hash']));
    env.state.storeApprovedOffer(liveOffer);
    const req = { ...request, mode: 'LIVE_DEVNET', principal_id: native.principal_id, request_id: 'native-request',
      idempotency_key: 'native-key', mandate_id: 'native-mandate', nonce: 'native-nonce', facility_id: native.facility.facility_id,
      asset: native.loan_asset, rep_asset: native.rep_asset, commercial_terms_hash: liveOffer.commercial_terms_hash };
    const record = registry.reserveRequest(req); const at = Math.floor(clock().getTime()/1000);
    const evidence = (tx, type, index) => ({ txHash: tx, ledgerIndex: 10, transactionIndex: index, validated: true, result: 'tesSUCCESS', transactionType: type });
    await registry.applyEvent({ eventId: 'native-stake', requestId: req.request_id, kind: 'STAKE_VALIDATED', occurredAt: at,
      native: evidence('1'.repeat(64), 'Payment', 0), stake: { amountU: record.originalBondU, repAsset: native.rep_asset,
        sender: 'rTestBorrower', destination: native.rep_asset.issuer, requestHash: R.contentHash(req), partialPayment: false } });
    await registry.applyEvent({ eventId: 'native-origin', requestId: req.request_id, kind: 'ORIGINATION_VALIDATED', occurredAt: at,
      native: evidence('2'.repeat(64), 'LoanSet', 1), loan: { loanId: 'native-loan', maturityAt: at + 7776000, nextPaymentDueAt: at + 7776000, graceSeconds: 60 } });
    const receipt = { ...load('authorization-receipt-allow.json'), request_id: req.request_id, mode: 'LIVE_DEVNET',
      mandate_id: req.mandate_id, reservation_id: record.reservationId, proposal_hash: record.payloadHash,
      commercial_terms_hash: req.commercial_terms_hash, quote_bond_u: record.originalBondU,
      signature_state: 'SIGNATURE_ISSUED', xrpl_state: 'VALIDATED_ACTIVE', native_signing_permitted: true,
      stake_proof_id: '1'.repeat(64), tx_hash: '2'.repeat(64), prepared_tx_commitment: 'sha256:'+'3'.repeat(64) };
    env.state.storeReceipt(receipt); env.close(); env.open();
    assert.equal(env.state.getReceipt(req.request_id).tx_hash, '2'.repeat(64));
    assert.equal(env.state.getReceipt(req.request_id).stake_proof_id, '1'.repeat(64));
    assert.throws(() => env.state.storeReceipt({ ...receipt, tx_hash: '4'.repeat(64) }), /EXECUTION_EVIDENCE_REQUIRED/);
  } finally { env.cleanup(); }
});
