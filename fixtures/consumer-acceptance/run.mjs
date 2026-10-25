import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadSourceRuntime } from './source-runtime.mjs';
import { summarizeStatus, assertConservation, assertSimulationReceipt, assertTraceOrder } from './checker.mjs';

const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
function discoverRepository() {
  let folder = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(resolve(folder, 'fixtures/scenario.json')) && existsSync(resolve(folder, 'packages/registry/src/index.ts'))) return folder;
    const parent = dirname(folder);
    if (folder === parent) return undefined;
    folder = parent;
  }
}
const repositoryOption = option('--repo', process.env.SHELLFISH_REPO ?? discoverRepository());
if (!repositoryOption) throw new Error('Pass --repo <Shellfish checkout> or set SHELLFISH_REPO');
const repo = resolve(repositoryOption);
const output = resolve(option('--output', resolve(dirname(fileURLToPath(import.meta.url)), 'acceptance-results.json')));
const runtime = await loadSourceRuntime(repo);
const { schemas, registry: R, authorization: A, xrpl: X, Database } = runtime;
const fixture = name => JSON.parse(readFileSync(resolve(repo, 'fixtures', name), 'utf8'));
const original = {
  scenario: schemas.ScenarioFixture.parse(fixture('scenario.json')),
  mandate: schemas.BorrowingMandate.parse(fixture('mandate.json')),
  offer: schemas.LenderFacilityOffer.parse(fixture('offer-lender-a.json')),
  request: schemas.ReservationFixture.parse(fixture('reservation.json')).request,
};
const origin = Math.floor(Date.parse(original.scenario.clock) / 1000);
const cases = [];
const clone = value => structuredClone(value);

function setup() {
  const folder = mkdtempSync(resolve(tmpdir(), 'shellfish-consumer-'));
  const db = new Database(resolve(folder, 'test.db'));
  let seconds = origin;
  const registry = R.createRegistry(db, { now: () => new Date(seconds * 1000) });
  registry.seedScenario(original.scenario, original.mandate.xrpl_borrower);
  const trace = [];
  const env = {
    registry, trace,
    inputs: clone(original),
    status: () => registry.getCreditStatus(original.scenario.facility.facility_id),
    at: n => { seconds = n; },
    authorize(change = {}) {
      const { mandate, offer, request } = env.inputs;
      const receipt = A.authorizeExactAction({ mandate, offer, reservationRequest: request,
        proposalHash: R.contentHash(request), evidenceFresh: true, now: new Date(seconds * 1000), hashContent: R.contentHash,
        reserveRequest: raw => {
          const result = registry.reserveRequest(raw);
          trace.push({ kind: 'RESERVE_OK', requestId: result.requestId });
          return result;
        }, ...change });
      trace.push({ kind: receipt.decision === 'ALLOW' ? 'AUTH_ALLOW' : 'AUTH_DENY', requestId: receipt.request_id });
      return schemas.AuthorizationReceipt.parse(receipt);
    },
    async originate(receipt, change = {}) {
      return X.originateLoan({ proposalHash: receipt.proposal_hash,
        principal: env.inputs.offer.principal, aprBps: env.inputs.offer.apr_bps,
        termDays: env.inputs.offer.term_days, asset: JSON.stringify(env.inputs.offer.asset),
        networkMode: 'SIMULATED_LOAN', requestId: receipt.request_id,
        reservationId: receipt.reservation_id, ...change }, env.sim);
    },
    close() { db.close(); rmSync(folder, { recursive: true, force: true }); },
  };
  env.sim = {
    getRequest: id => registry.getRequest(id),
    applyEvent: async event => {
      const result = await registry.applyEvent(event);
      trace.push({ kind: event.kind, requestId: event.requestId });
      return result;
    },
    hashRequest: R.contentHash,
    getApprovedOffer: hash => hash === env.inputs.offer.commercial_terms_hash ? env.inputs.offer : undefined,
    clockSeconds: () => seconds,
    borrowerAccount: original.mandate.xrpl_borrower,
    repAsset: original.scenario.rep_asset,
  };
  return env;
}

async function check(id, purpose, body) {
  const env = setup();
  const before = env.status();
  let result;
  try {
    await body(env);
    assertConservation(env.status());
    result = { id, purpose, result: 'PASS' };
  } catch (error) {
    // Report the case, assertion class and safe balance projection, never raw errors/input.
    result = { id, purpose, result: 'FAIL', failure: error instanceof assert.AssertionError ? 'CONFORMANCE_ASSERTION_FAILED' : 'CONSUMER_CALL_REJECTED' };
  }
  result.before = summarizeStatus(before);
  result.after = summarizeStatus(env.status());
  result.trace = env.trace;
  cases.push(result);
  env.close();
}

await check('allow-reserve-origin', 'Accepted request reserves before ALLOW and consumes once in explicit simulation', async env => {
  const auth = env.authorize();
  assert.equal(auth.decision, 'ALLOW');
  assert.equal(auth.quote_bond_u, '720000000');
  assertSimulationReceipt(auth, env.registry.getRequest(auth.request_id));
  assertTraceOrder(env.trace, 'RESERVE_OK', 'AUTH_ALLOW');
  const result = await env.originate(auth);
  assert.equal(result.txHash, null);
  assert.equal(result.simulated, true);
  assert.equal(result.validated, false);
  assert.equal(env.registry.getRequest(auth.request_id).state, 'ACTIVE');
  assert.equal(env.status().portfolio.active_principal_minor, '300000');
  assert.equal(env.status().portfolio.reserved_principal_minor, '0');
  assertTraceOrder(env.trace, 'STAKE_VALIDATED', 'ORIGINATION_VALIDATED');
});

for (const [id, change, code] of [
  ['deny-amount', { offer: { ...original.offer, principal: '3000.00' } }, 'DENY_AMOUNT'],
  ['deny-rate', { offer: { ...original.offer, apr_bps: 900 } }, 'DENY_RATE'],
  ['deny-stale', { evidenceFresh: false }, 'DENY_EVIDENCE_STALE'],
]) await check(id, 'Denied proposal leaves economic state unchanged and never reaches reserve', env => {
  const before = env.status();
  const receipt = env.authorize(change);
  assert.equal(receipt.decision, 'DENY');
  assert.ok(receipt.reason_codes.includes(code));
  assert.deepEqual(env.status(), before);
  assert.equal(env.trace.some(e => e.kind === 'RESERVE_OK'), false);
});

await check('exact-authorization-retry', 'Identical request returns the same reservation without another economic hold', env => {
  const first = env.authorize();
  const held = env.status();
  const second = env.authorize();
  assert.equal(second.decision, 'ALLOW');
  assert.equal(second.reservation_id, first.reservation_id);
  assert.deepEqual(env.status(), held);
});

await check('consumed-nonce', 'New request cannot reuse an already consumed mandate nonce', env => {
  env.authorize();
  const held = env.status();
  const second = { ...env.inputs.request, request_id: 'req-consumed-nonce', idempotency_key: 'idem-consumed-nonce' };
  const denied = env.authorize({ reservationRequest: second, proposalHash: R.contentHash(second) });
  assert.equal(denied.decision, 'DENY');
  assert.ok(denied.reason_codes.includes('DENY_REPLAY'));
  assert.deepEqual(env.status(), held);
});

await check('key-payload-conflict', 'Same idempotency key cannot change its bound request', env => {
  env.authorize();
  const held = env.status();
  // Change a valid request field, so policy/term mismatch does not mask key conflict.
  const changed = { ...env.inputs.request, expires_at: '2026-10-24T18:20:00Z' };
  const denied = env.authorize({ reservationRequest: changed, proposalHash: R.contentHash(changed) });
  assert.equal(denied.decision, 'DENY');
  assert.ok(denied.reason_codes.includes('DENY_IDEMPOTENCY_CONFLICT'));
  assert.deepEqual(env.status(), held);
});

for (const [field, value] of Object.entries({
  mandate_id: 'different-mandate', nonce: 'different-nonce', agent_id: 'different-agent',
  mandate_hash: `sha256:${'0'.repeat(64)}`, offer_id: 'different-offer', principal_minor: '150000',
})) await check(`bind-request-${field}`, `Reservation ${field} must match the checked mandate/offer before reserve`, env => {
  const before = env.status();
  const changed = { ...env.inputs.request, [field]: value };
  const receipt = env.authorize({ reservationRequest: changed, proposalHash: R.contentHash(changed) });
  assert.equal(receipt.decision, 'DENY');
  assert.deepEqual(env.status(), before);
});

await check('bind-rep-spend-consent', 'Checked one-REP consent cannot reserve a 720-REP bond through a larger request cap', env => {
  const mandate = clone(env.inputs.mandate);
  mandate.rep_consent.max_stake_u = '1000000';
  mandate.mandate_hash = R.contentHash(schemas.withoutFields(mandate, ['principal_signature', 'mandate_hash']));
  const request = { ...env.inputs.request, mandate_hash: mandate.mandate_hash };
  const before = env.status();
  const denied = env.authorize({ mandate, reservationRequest: request, proposalHash: R.contentHash(request) });
  assert.equal(denied.decision, 'DENY');
  assert.deepEqual(env.status(), before);
});

for (const [field, value] of Object.entries({
  principal: '3000.00', aprBps: 900, termDays: 360,
  asset: JSON.stringify({ currency: 'USD', issuer: 'sim:different-issuer' }),
  proposalHash: `sha256:${'0'.repeat(64)}`,
})) await check(`bind-originate-${field}`, `Origination ${field} cannot replace the approved action`, async env => {
  const auth = env.authorize();
  assert.equal(auth.decision, 'ALLOW');
  const before = env.status();
  let rejected = false;
  try { await env.originate(auth, { [field]: value }); } catch { rejected = true; }
  assert.equal(rejected, true);
  assert.deepEqual(env.status(), before);
});

await check('repay-owed-return', 'Full repayment queues original bond plus principal-time growth without making it spendable', async env => {
  const auth = env.authorize();
  const loan = await env.originate(auth);
  env.at(origin + 90 * 86400);
  await X.repayLoan({ loanId: loan.loanId, amount: '2000.00', networkMode: 'SIMULATED_LOAN',
    requestId: auth.request_id, principalReductionMinor: '200000',
    sim: { ...env.sim, originHash: `sim:origin:${auth.request_id}`, previousEventId: `origin:${auth.request_id}` } });
  const r = env.status().portfolio.reputation;
  assert.equal(r.available_u, '40000000');
  assert.equal(r.bonded_u, '240000000');
  assert.equal(r.growth_u, '12000000');
  assert.equal(r.pending_return_u, '732000000');
});

let revision;
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
catch { revision = 'UNCOMMITTED_REVIEW_COPY'; }
const report = {
  checked_at: new Date().toISOString(),
  revision,
  node: process.version,
  mode: 'SIMULATED_LOAN',
  fixture_clock: original.scenario.clock,
  execution_source: 'CURRENT_TYPESCRIPT_SOURCE_WITH_INSTALLED_TYPESCRIPT_TRANSPILER',
  summary: { pass: cases.filter(c => c.result === 'PASS').length, fail: cases.filter(c => c.result === 'FAIL').length },
  unavailable: ['NATIVE_SIGNATURE_AUTHENTICITY', 'NATIVE_SIGNER_OR_SUBMISSION_TRACE', 'EXECUTION_STORE_FENCING_IN_CONSUMER', 'NATIVE_DEFAULT', 'FRESH_NATIVE_RETURN_QUEUE'],
  cases,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ revision: report.revision, ...report.summary, report: output, failures: cases.filter(c => c.result === 'FAIL').map(c => c.id) }, null, 2));
process.exitCode = report.summary.fail ? 1 : 0;
