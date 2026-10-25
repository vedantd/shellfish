import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repo = process.env.SOURCE_REPO ?? process.cwd();
const temporary = mkdtempSync(resolve(tmpdir(), 'shellfish-http-restart-'));
const database = resolve(temporary, 'credit.db');
let child, address;
async function start() {
  child = spawn(process.execPath, ['services/api/dist/index.js'], {
    cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NETWORK_MODE: 'SIMULATED_LOAN', DATABASE_PATH: database, API_PORT: '0', API_HOST: '127.0.0.1' },
  });
  address = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('API startup timeout')), 10000);
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const found = buffer.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) { clearTimeout(timer); done(found[0]); }
    });
    child.once('exit', () => { clearTimeout(timer); fail(new Error('API exited before readiness')); });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const ended = new Promise(done => child.once('exit', done));
  child.kill('SIGTERM');
  await ended;
}
async function request(path, body) {
  const response = await fetch(address + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('HTTP credit view, receipts and exact origination survive two real API process restarts', async () => {
  try {
    await start();
    const spec = await request('/openapi.json');
    assert.equal(spec.status, 200);
    assert.equal(spec.body.openapi, '3.1.0');
    assert.ok(spec.body.paths['/v1/requests/{id}']);
    assert.equal((await request('/v1/requests/does-not-exist')).status, 404);
    const evidence = await request('/v1/evidence/business:harbor-supply-demo');
    assert.equal(evidence.status, 200);
    const a = await request('/v1/lenders/lender-A/evaluate', { subject_id: evidence.body.subject_id });
    const b = await request('/v1/lenders/lender-B/evaluate', { subject_id: evidence.body.subject_id });
    assert.equal(a.body.decision, 'APPROVE');
    assert.equal(b.body.decision, 'DECLINE');

    const auth = await request('/v1/authorizations', { unique: false });
    assert.equal(auth.status, 200);
    assert.equal(auth.body.decision, 'ALLOW');
    const id = auth.body.request_id;
    await stop();
    await start();
    const saved = await request('/v1/receipts/' + id);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.reservation_id, auth.body.reservation_id);
    let view = await request('/v1/requests/' + id);
    assert.equal(view.status, 200);
    assert.equal(view.body.request_state, 'AWAITING_STAKE');
    assert.equal(view.body.credit_status.portfolio.reputation.reserved_u, '720000000');
    assert.equal(view.body.approved_offer.commercial_terms_hash, auth.body.commercial_terms_hash);
    assert.equal(view.body.lender_decision.decision, 'APPROVE');

    const originBody = { request_id: id, reservation_id: auth.body.reservation_id, proposal_hash: auth.body.proposal_hash };
    const origin = await request('/v1/loans/originate', originBody);
    assert.equal(origin.status, 200);
    assert.equal(origin.body.txHash, null);
    view = await request('/v1/requests/' + id);
    assert.equal(view.body.request_state, 'ACTIVE');
    assert.equal(view.body.loan.loan_id, origin.body.loanId);
    assert.equal(view.body.credit_status.portfolio.reputation.available_u, '40000000');
    assert.equal(view.body.transactions.length, 2);
    assert.ok(view.body.transactions.every(tx => tx.tx_hash === null && tx.explorer === null));

    await stop();
    await start();
    assert.equal((await request('/v1/receipts/' + id)).body.xrpl_state, 'SIMULATED');
    const reauthorized = await request('/v1/authorizations', { unique: false });
    assert.equal(reauthorized.status, 200);
    assert.equal(reauthorized.body.xrpl_state, 'SIMULATED');
    const retry = await request('/v1/loans/originate', originBody);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.loanId, origin.body.loanId);
    const unchanged = await request('/v1/requests/' + id);
    assert.equal(unchanged.body.transactions.length, 2);
    assert.deepEqual(unchanged.body.credit_status, view.body.credit_status);
    const altered = await request('/v1/loans/originate', { ...originBody, term_days: 360 });
    assert.equal(altered.status, 400);
    assert.equal((await request('/v1/requests/' + id)).body.transactions.length, 2);
    assert.equal(JSON.stringify(unchanged.body).includes('signed_blob'), false);
  } finally {
    await stop();
    rmSync(temporary, { recursive: true, force: true });
  }
});
