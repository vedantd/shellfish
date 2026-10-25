import assert from 'node:assert/strict';

/** Only public, allowlisted observations leave the fixture. Never copy signed bytes. */
export function summarizeStatus(status) {
  const r = status.portfolio.reputation;
  return {
    mode: status.mode,
    active_principal_minor: status.portfolio.active_principal_minor,
    reserved_principal_minor: status.portfolio.reserved_principal_minor,
    facility_headroom_minor: status.facility.headroom_minor,
    reputation: Object.fromEntries(['available_u', 'reserved_u', 'bonded_u', 'pending_return_u', 'growth_u', 'forfeited_u', 'suspended'].map(k => [k, r[k]])),
  };
}

export function assertConservation(status) {
  const r = status.portfolio.reputation;
  assert.equal(BigInt(r.seed_u) + BigInt(r.growth_u), ['available_u', 'reserved_u', 'bonded_u', 'pending_return_u', 'forfeited_u'].reduce((n, k) => n + BigInt(r[k]), 0n), 'REP conservation');
}

export function assertSimulationReceipt(receipt, record) {
  assert.equal(receipt.mode, 'SIMULATED_LOAN');
  assert.equal(receipt.tx_hash, null);
  assert.equal(receipt.native_signing_permitted, false);
  assert.equal(receipt.request_id, record.requestId);
  assert.equal(receipt.reservation_id, record.reservationId);
  assert.equal(receipt.quote_bond_u, record.originalBondU);
  assert.equal(receipt.proposal_hash, record.payloadHash);
  assert.equal(receipt.mandate_id, record.request.mandate_id);
  assert.equal(receipt.commercial_terms_hash, record.request.commercial_terms_hash);
  assert.equal(receipt.policy_hash, record.request.policy_hash);
}

export function assertTraceOrder(trace, first, second) {
  const a = trace.findIndex(e => e.kind === first);
  const b = trace.findIndex(e => e.kind === second);
  assert.ok(a >= 0 && b > a, `${first} must precede ${second}`);
}
