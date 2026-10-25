import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = process.env.SOURCE_REPO;
if (!repository) throw new Error('Set SOURCE_REPO to the existing Shellfish checkout');
const { loadSourceRuntime } = await import(pathToFileURL(resolve(repository, 'fixtures/consumer-acceptance/source-runtime.mjs')).href);
const runtime = await loadSourceRuntime(repository);
const { registry: R, authorization: A, xrpl: X, schemas: S, Database } = runtime;
const source = process.env.REQUEST_VIEW_SOURCE ?? resolve(repository, 'services/api/src/db/request-view.ts');
const { createRequestView } = await import(pathToFileURL(source).href);
const fixture = name => JSON.parse(readFileSync(resolve(repository, 'fixtures', name), 'utf8'));
const scenario = S.ScenarioFixture.parse(fixture('scenario.json'));
const mandate = S.BorrowingMandate.parse(fixture('mandate.json'));
const offer = S.LenderFacilityOffer.parse(fixture('offer-lender-a.json'));
const baseRequest = S.ReservationFixture.parse(fixture('reservation.json')).request;
const origin = Date.parse(scenario.clock) / 1000;
const emptyState = () => ({ getReceipt: () => undefined, getApprovedOffer: () => undefined });

function setup() {
  const folder = mkdtempSync(resolve(tmpdir(), 'shellfish-request-view-'));
  const path = resolve(folder, 'credit.db');
  let db = new Database(path), seconds = origin;
  let registry = R.createRegistry(db, { now: () => new Date(seconds * 1000) });
  registry.seedScenario(scenario, mandate.xrpl_borrower);
  let receipt;
  const state = { getReceipt: id => receipt?.request_id === id ? receipt : undefined,
    getApprovedOffer: hash => hash === offer.commercial_terms_hash ? structuredClone(offer) : undefined };
  const current = () => ({ db, registry });
  const env = { path, current, state,
    setReceipt: value => { receipt = value; },
    at: value => { seconds = value; },
    reopen() { db.close(); db = new Database(path); registry = R.createRegistry(db, { now: () => new Date(seconds * 1000) }); },
    view(reader = state) { return createRequestView(db, registry, reader).getRequestView(baseRequest.request_id); },
    authorize() {
      receipt = A.authorizeExactAction({ mandate, offer, reservationRequest: baseRequest,
        proposalHash: R.contentHash(baseRequest), evidenceFresh: true, hashContent: R.contentHash,
        reserveRequest: value => registry.reserveRequest(value), now: new Date(seconds * 1000) });
      assert.equal(receipt.decision, 'ALLOW');
      return receipt;
    },
    async originate() {
      const auth = receipt ?? env.authorize();
      const loan = await X.originateLoan({ proposalHash: auth.proposal_hash, principal: offer.principal,
        aprBps: offer.apr_bps, termDays: offer.term_days, asset: JSON.stringify(offer.asset),
        networkMode: 'SIMULATED_LOAN', requestId: auth.request_id, reservationId: auth.reservation_id }, env.sim());
      receipt = { ...auth, signature_state: 'SIGNATURE_ISSUED', xrpl_state: 'SIMULATED' };
      return loan;
    },
    sim() { return { getRequest: id => registry.getRequest(id), applyEvent: event => registry.applyEvent(event),
      hashRequest: R.contentHash, getApprovedOffer: hash => state.getApprovedOffer(hash), clockSeconds: () => seconds,
      borrowerAccount: mandate.xrpl_borrower, repAsset: scenario.rep_asset }; },
    close() { db.close(); rmSync(folder, { recursive: true, force: true }); },
  };
  return env;
}

test('request view joins actual request, approved receipt and current REP state', async () => {
  const env = setup();
  try {
    env.authorize();
    let view = env.view();
    assert.equal(view.request_state, 'AWAITING_STAKE');
    assert.equal(view.receipt.decision, 'ALLOW');
    assert.equal(view.credit_status.portfolio.reputation.reserved_u, '720000000');
    assert.equal(view.loan, null);
    await env.originate();
    view = env.view();
    assert.equal(view.request_state, 'ACTIVE');
    assert.equal(view.loan.principal_minor, '200000');
    assert.equal(view.approved_offer.principal, '2000.00');
    assert.equal(view.credit_status.portfolio.reputation.bonded_u, '960000000');
    assert.deepEqual(view.transactions.map(row => row.kind), ['STAKE_VALIDATED', 'ORIGINATION_VALIDATED']);
    assert.ok(view.transactions.every(row => row.tx_hash === null && row.explorer === null && row.recorded_validated === false));
  } finally { env.close(); }
});

test('repayment projection keeps owed restoration separate from spendable REP', async () => {
  const env = setup();
  try {
    const loan = await env.originate();
    env.at(origin + 90 * 86400);
    await X.repayLoan({ loanId: loan.loanId, amount: '2000.00', principalReductionMinor: '200000',
      networkMode: 'SIMULATED_LOAN', requestId: baseRequest.request_id,
      sim: { ...env.sim(), originHash: `sim:origin:${baseRequest.request_id}`, previousEventId: `origin:${baseRequest.request_id}` } });
    const view = env.view();
    assert.equal(view.request_state, 'RETURN_PENDING');
    assert.equal(view.loan.outstanding_minor, '0');
    assert.equal(view.credit_status.portfolio.reputation.pending_return_u, '732000000');
    assert.equal(view.credit_status.portfolio.reputation.available_u, '40000000');
    assert.ok(view.transactions.some(event => event.kind === 'REPAYMENT'));
  } finally { env.close(); }
});

test('recorded issuer return completes the same request and appears in its transaction history', async () => {
  const env = setup();
  try {
    const loan = await env.originate();
    env.at(origin + 90 * 86400);
    await X.repayLoan({ loanId: loan.loanId, amount: '2000.00', principalReductionMinor: '200000',
      networkMode: 'SIMULATED_LOAN', requestId: baseRequest.request_id,
      sim: { ...env.sim(), originHash: `sim:origin:${baseRequest.request_id}`, previousEventId: `origin:${baseRequest.request_id}` } });
    const { registry } = env.current();
    const credit = registry.getReturnCredits({ principalId: scenario.principal_id, network: scenario.network, asset: scenario.loan_asset })[0];
    await registry.applyEvent({ eventId: 'return-view-test', kind: 'RETURN_VALIDATED', creditId: credit.creditId,
      occurredAt: origin + 90 * 86400,
      returned: { amountU: credit.amountU, repAsset: scenario.rep_asset,
        sender: scenario.rep_asset.issuer, destination: mandate.xrpl_borrower, partialPayment: false } });
    const view = env.view();
    assert.equal(view.request_state, 'REPAID');
    assert.equal(view.credit_status.portfolio.reputation.pending_return_u, '0');
    assert.equal(view.credit_status.portfolio.reputation.available_u, '772000000');
    const returned = view.transactions.find(event => event.kind === 'RETURN_VALIDATED');
    assert.equal(returned.event_id, 'return-view-test');
    assert.equal(returned.tx_hash, null);
    assert.equal(returned.explorer, null);
  } finally { env.close(); }
});

test('view selects public attempt fields and does not serialize payload or signed blobs', async () => {
  const env = setup();
  try {
    await env.originate();
    const { db } = env.current(), marker = 'PRIVATE_SIGNED_BYTES_SENTINEL';
    db.prepare(`INSERT INTO credit_attempts(request_id,phase,attempt_hash,signed_blob,sequence,last_ledger_sequence,state,commitment)
      VALUES(?,?,?,?,?,?,?,?)`).run(baseRequest.request_id, 'LOAN', 'sim:pending', marker, 1, 100, 'RECONCILING', `sha256:${'0'.repeat(64)}`);
    const row = db.prepare('SELECT event_id,payload_json FROM credit_events WHERE request_id=? LIMIT 1').get(baseRequest.request_id);
    const payload = JSON.parse(row.payload_json);
    payload.private_blob = marker;
    db.prepare('UPDATE credit_events SET payload_json=? WHERE event_id=?').run(JSON.stringify(payload), row.event_id);
    const view = env.view(), text = JSON.stringify(view);
    assert.equal(text.includes(marker), false);
    assert.equal(text.includes('signed_blob'), false);
    assert.equal(text.includes('payload_json'), false);
    assert.equal(view.attempts[0].state, 'RECONCILING');
    assert.equal(view.attempts[0].recorded_validated, false);
    assert.equal(view.attempts[0].tx_hash, null);
  } finally { env.close(); }
});

test('simulation never promotes a hex-looking stored event into a native receipt', async () => {
  const env = setup();
  try {
    await env.originate();
    const { db } = env.current();
    db.prepare("UPDATE credit_events SET tx_hash=? WHERE event_id=?").run('A'.repeat(64), `origin:${baseRequest.request_id}`);
    assert.ok(env.view().transactions.every(event => event.tx_hash === null && event.explorer === null && !event.recorded_validated));
  } finally { env.close(); }
});

test('recorded events alone do not create missing credit approval or authorization', async () => {
  const env = setup();
  try {
    await env.originate();
    const view = env.view(emptyState());
    assert.equal(view.request_state, 'ACTIVE');
    assert.equal(view.receipt, null);
    assert.equal(view.approved_offer, null);
    assert.equal(view.transactions.length, 2);
  } finally { env.close(); }
});

test('unknown request and foreign-mode saved receipt fail closed', () => {
  const env = setup();
  try {
    assert.throws(() => env.view(), { code: 'NOT_FOUND' });
    const receipt = env.authorize();
    assert.throws(() => env.view({ ...env.state, getReceipt: () => ({ ...receipt, mode: 'LIVE_DEVNET' }) }), { code: 'UI_STATE_CONTEXT_MISMATCH' });
  } finally { env.close(); }
});

test('another request event stays out of this request view and output is detached', async () => {
  const env = setup();
  try {
    await env.originate();
    const { db, registry } = env.current();
    const other = { ...baseRequest, request_id: 'req-other-view', idempotency_key: 'idem-other-view', mandate_id: 'm-other-view', nonce: 'nonce-other-view', principal_minor: '100' };
    registry.reserveRequest(other);
    await registry.applyEvent({ eventId: 'stake-other-view', kind: 'STAKE_VALIDATED', requestId: other.request_id, occurredAt: origin,
      stake: { amountU: registry.getRequest(other.request_id).originalBondU, repAsset: scenario.rep_asset,
        sender: mandate.xrpl_borrower, destination: scenario.rep_asset.issuer, requestHash: R.contentHash(other), partialPayment: false } });
    const view = env.view();
    assert.equal(view.transactions.some(event => event.event_id === 'stake-other-view'), false);
    view.receipt.reason_codes.push('DENY_SCOPE');
    view.approved_offer.principal = '9000.00';
    assert.deepEqual(env.view().receipt.reason_codes, []);
    assert.equal(env.view().approved_offer.principal, '2000.00');
    assert.equal(db.prepare('SELECT count(*) AS n FROM credit_events').get().n, 3);
  } finally { env.close(); }
});

test('SQLite reopen preserves request, loan and event references', async () => {
  const env = setup();
  try {
    await env.originate();
    const before = env.view(emptyState());
    env.reopen();
    assert.deepEqual(env.view(emptyState()), before);
  } finally { env.close(); }
});

test('native recorded-reference unit test exposes explorer link without claiming a fresh ledger query', async () => {
  // Explicit trusted verifier doubles exercise the read projection only. No ledger is contacted.
  const db = new Database(':memory:');
  try {
    const registry = R.createRegistry(db, { now: () => new Date(origin * 1000),
      verifyNativePortfolio: async () => {}, verifyNativeEvent: async () => {} });
    const seed = structuredClone(scenario);
    delete seed.provenance;
    delete seed.native_signing_permitted;
    seed.mode = 'LIVE_DEVNET';
    seed.loan_asset = { mpt_issuance_id: '1'.repeat(48) };
    seed.rep_asset = { mpt_issuance_id: '2'.repeat(48), issuer: 'rUnitTestIssuer', asset_scale: 6 };
    seed.facility.asset = seed.loan_asset;
    seed.opening_loans = [];
    Object.assign(seed.opening, { active_principal_minor: '0', reserved_principal_minor: '0',
      defaulted_principal_minor: '0', facility_committed_minor: '0', facility_reserved_minor: '0' });
    Object.assign(seed.opening.reputation, { available_u: '1000000000', reserved_u: '0', bonded_u: '0' });
    await registry.initializeNativePortfolio(seed, 'rUnitTestBorrower', { testOnly: true });
    const request = { ...baseRequest, mode: 'LIVE_DEVNET', asset: seed.loan_asset, rep_asset: seed.rep_asset };
    const record = registry.reserveRequest(request);
    await registry.applyEvent({ eventId: 'native-unit-stake', kind: 'STAKE_VALIDATED', requestId: request.request_id,
      occurredAt: origin, native: { txHash: 'A'.repeat(64), ledgerIndex: 10, transactionIndex: 1,
        validated: true, result: 'tesSUCCESS', transactionType: 'Payment' },
      stake: { amountU: record.originalBondU, repAsset: seed.rep_asset,
        sender: 'rUnitTestBorrower', destination: seed.rep_asset.issuer, requestHash: R.contentHash(request), partialPayment: false } });
    db.prepare(`INSERT INTO credit_attempts(request_id,phase,attempt_hash,signed_blob,sequence,last_ledger_sequence,state,commitment)
      VALUES(?,?,?,?,?,?,?,?)`).run(request.request_id, 'LOAN', 'B'.repeat(64), 'PRIVATE_UNIT_SENTINEL', 1, 100, 'SUBMITTED', `sha256:${'0'.repeat(64)}`);
    const view = createRequestView(db, registry, emptyState()).getRequestView(request.request_id);
    assert.equal(view.transactions[0].tx_hash, 'A'.repeat(64));
    assert.equal(view.transactions[0].explorer, 'https://devnet.xrpl.org/transactions/' + 'A'.repeat(64));
    assert.equal(view.transactions[0].recorded_validated, true);
    assert.equal(view.transactions[0].ledger_requeried, false);
    assert.equal(view.transactions[0].evidence_origin, 'REGISTRY_EVENT');
    assert.equal(view.attempts[0].state, 'SUBMITTED');
    assert.equal(view.attempts[0].recorded_validated, false);
    assert.equal(view.receipt, null);
    assert.equal(JSON.stringify(view).includes('PRIVATE_UNIT_SENTINEL'), false);
  } finally { db.close(); }
});
