import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStatus, assertConservation, assertSimulationReceipt, assertTraceOrder } from './checker.mjs';

const status = () => ({ mode: 'SIMULATED_LOAN',
  facility: { headroom_minor: '400000' },
  portfolio: { active_principal_minor: '100000', reserved_principal_minor: '0',
    reputation: { seed_u: '1000000000', growth_u: '0', available_u: '760000000',
      reserved_u: '0', bonded_u: '240000000', pending_return_u: '0', forfeited_u: '0', suspended: false },
  },
});

test('exact integer conservation detects one atomic unit of invented reputation', () => {
  assertConservation(status());
  const broken = status();
  broken.portfolio.reputation.available_u = '760000001';
  assert.throws(() => assertConservation(broken), assert.AssertionError);
});

test('public balance projection drops unexpected sensitive fields', () => {
  const value = status();
  value.signedBlob = 'private-test-sentinel';
  value.portfolio.reputation.secret = 'private-test-sentinel';
  assert.equal(JSON.stringify(summarizeStatus(value)).includes('private-test-sentinel'), false);
});

test('observation order rejects an ALLOW before actual successful reserve', () => {
  assertTraceOrder([{ kind: 'RESERVE_OK' }, { kind: 'AUTH_ALLOW' }], 'RESERVE_OK', 'AUTH_ALLOW');
  assert.throws(() => assertTraceOrder([{ kind: 'AUTH_ALLOW' }, { kind: 'RESERVE_OK' }], 'RESERVE_OK', 'AUTH_ALLOW'), assert.AssertionError);
});

test('receipt comparison rejects a proposal hash from another reservation', () => {
  const record = { requestId: 'r', reservationId: 'res', originalBondU: '720000000', payloadHash: 'expected',
    request: { mandate_id: 'm', commercial_terms_hash: 'terms', policy_hash: 'policy' } };
  const receipt = { mode: 'SIMULATED_LOAN', tx_hash: null, native_signing_permitted: false,
    request_id: 'r', reservation_id: 'res', quote_bond_u: '720000000', proposal_hash: 'different',
    mandate_id: 'm', commercial_terms_hash: 'terms', policy_hash: 'policy' };
  assert.throws(() => assertSimulationReceipt(receipt, record), assert.AssertionError);
});
