# `@shellfish/web`

**Owner:** Vedant

Three-screen judge demo (PRD §10.1).

## What this app handles

- Screen A — Borrower workspace (principal, agent, mandate, request)
- Screen B — Credit & lender decisions (Gita passport, A approve / B decline, Nick envelope)
- Screen C — Authorization & XRPL receipt (check matrix, reserve, signer, hash/Loan ID, one DENY)
- Network badge: `LIVE_DEVNET` vs `SIMULATED_LOAN`

## Build steps

1. Keep three routes; do not add dashboards or extra P1 charts before H26.
2. Screen A: show signed mandate max **2500** and request **2000**; call `POST /v1/mandates`.
3. Screen B: load evidence + run both lenders + show match result.
4. Screen C: show Shellfish checks; trigger originate; show receipt.
5. Add explicit buttons for denial demos: **3000** → `DENY_AMOUNT`, **9%** → `DENY_RATE`, replay → `DENY_REPLAY`.
6. If `tx_hash` is null / sim mode, show **SIMULATED_LOAN** badge — never imply Mainnet or live lending.
7. Link real hashes to the Devnet explorer only when `LIVE_DEVNET` and hash is real.

## Do **not** do here

- Policy logic in the browser — display API results only
- Hide simulation mode

## Done when

- 90-second demo path works: mandate → evidence → A/B → match → ALLOW → (loan or sim) → one denial.
