# `@shellfish/authorization`

**Owner:** Vedant (XRPL + Shellfish)

Shellfish mandate verification + deterministic authorization kernel. **Final ALLOW/DENY lives here — never in an LLM.**

## What this module handles

- Verify principal-signed mandate (FR-02)
- Reject unauthorized agent, stale evidence, wrong asset, changed tx, over amount/cost, unknown lender, replay (FR-07)
- Call Gita’s `reserveFacility` **before** returning ALLOW (reservation_id on receipt)
- Emit `AuthorizationReceipt` with check matrix + reason codes
- Bind decision to `proposal_hash` / `envelope_hash`

## Build steps

1. Implement `verifyMandate(mandate)`:
   - Required fields present (principal, agent, asset, maxes, purpose, lenders, expiry, nonce, signature, policy version)
   - Signature check (demo stub OK; must still fail on missing/tampered fields)
   - Reject expired mandate
2. Implement `authorizeExactAction({ mandate, offer, proposalHash, evidenceFresh })`:
   - Identity: agent + principal mapping
   - Offer still valid and matches envelope
   - Amount ≤ `max_principal` else `DENY_AMOUNT`
   - APR ≤ `max_apr_bps` else `DENY_RATE`
   - Fees / term / purpose / lender allowlist / asset
   - Evidence freshness else `DENY_EVIDENCE_STALE`
   - Nonce unused else `DENY_REPLAY`
   - On policy PASS: call `reserveFacility`; capacity failure → `DENY_CAPACITY` (no ALLOW)
3. On ALLOW: checks all `PASS`, include `reservation_id`, leave `signature_state: NOT_YET_SIGNED`, `xrpl_state: NOT_SUBMITTED`, `tx_hash: null`.
4. On DENY: never create a reservation or release a signature; fill `reason_codes`.
5. Persist decision via API (`authorizations` table) with unique nonce.
6. Wire `POST /v1/mandates` and `POST /v1/authorizations`. Origination **consumes** the reservation — it does not reserve again.

## Security cases you must cover

| Case | Code |
|------|------|
| Request 3000 vs max 2500 | `DENY_AMOUNT` |
| Offer 900 bps vs max 600 | `DENY_RATE` |
| Same nonce + proposal again | `DENY_REPLAY` |
| Asset issuer swapped after approval | `DENY_TRANSACTION_MISMATCH` / `DENY_ASSET` |

## Do **not** do here

- Lender underwriting (Gita / `compatibility`)
- Facility CAS implementation (Gita / `registry`) — **call** reserve here before ALLOW
- XRPL submit (Vedant / `xrpl`)

## Done when

- Fixture happy path → ALLOW receipt **with** reservation_id.
- Three denial demos return codes with **no** signature and **no** reservation.
