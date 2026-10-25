# `@shellfish/registry`

**Owner:** Gita

Lender-specific facility headroom and **atomic** reservations (FR-08).

## What this module handles

- Facility snapshot: limit, committed, reserved, version
- Reserve headroom for one proposal (optimistic lock / serializable TX)
- Idempotency on `proposal_hash` (same hash → same reservation, not a second draw)
- Commit reservation → committed exposure only after XRPL **validated** success
- Release on deny / submit failure / expiry

## Build steps

1. Use tables in `services/api/src/db/schema.sql` (`facilities`, `reservations`).
2. Seed facility A: limit **5000**, committed **1000**, reserved **0** → headroom **4000**.
3. Implement `getFacility(facilityId)`.
4. Implement `reserveFacility({ facilityId, proposalHash, amount, expiresAt })`:
   - Fail with capacity error if `amount > headroom` (maps to `DENY_CAPACITY`).
   - Unique on `proposal_hash`.
   - Increment `reserved` and bump `version` (CAS).
5. Implement `settleReservation({ reservationId, outcome })`:
   - `COMMITTED` → move reserved → committed
   - `RELEASED` → free reserved back to headroom
6. Add a race test: two concurrent 2500 reserves against 4000 headroom → **at most one** wins.
7. Orchestration rule: **You** must call reserve **before** controlled signing.

## Do **not** do here

- Underwriting decisions
- XRPL submit
- Global “all lenders’ debt” claims

## Done when

- Happy path reserve then commit works.
- Replay of same `proposal_hash` is idempotent.
- Capacity race test passes (or is the next prioritized test after H18).
