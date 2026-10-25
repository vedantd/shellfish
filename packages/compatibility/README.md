# `@shellfish/compatibility`

**Owner:** Gita

Nick matcher + two **independent** lender policy adapters.

## What this module handles

- Lender A / Lender B evaluate the **same** evidence to **different** outcomes (FR-04)
- Normalize offer units (principal, APR bps, term, asset) (FR-05)
- Deterministic intersect of lender offer ∩ borrower mandate (FR-06) — **no LLM final permission**

## Build steps

### Lender adapters

1. Implement `evaluateLender("lender-A", evidence)` → APPROVE with `fixtures/offer-lender-a.json`.
2. Implement `evaluateLender("lender-B", evidence)` → DECLINE (`fixtures/lender-b-decline.json`) because history is under 12 months.
3. Return `LenderEvaluateResult` (APPROVE + offer **or** DECLINE + reason codes).
4. Never let Lender B’s decline overwrite Lender A’s offer.

### Nick match

5. Implement `matchOffers({ mandate, offers })`.
6. Check: amount ≤ mandate max, APR ≤ mandate max (and respect lender floor — do **not** invent a rate the lender never offered), term ≤ max, purpose allowlist, lender allowlist, asset match.
7. On failure return `compatible: false` + codes like `DENY_NO_OVERLAP` / `DENY_RATE` / `DENY_AMOUNT` / `DENY_TERM`.
8. On success return permitted envelope fields + `envelope_hash` (hash of canonical matched terms).

### API

9. Wire `POST /v1/lenders/:id/evaluate` and `POST /v1/offers/match`.

## Do **not** do here

- Sign transactions or reserve facility capacity
- Call XRPL
- Treat Gita tier as underwriting approval

## Done when

- Identical evidence → A approves, B declines.
- Match of 2000 @ 550 bps succeeds; 3000 and 900 bps fail with the expected codes.
