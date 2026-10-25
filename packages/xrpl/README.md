# `@shellfish/xrpl`

**Owner:** You (XRPL + Shellfish)

LoanSet / LoanPay adapter + controlled signing boundary.

## What this module handles

- Convert app APR **bps** ↔ XRPL InterestRate (**tenths of a bps**: 550 → 5500)
- Build / sign / submit LoanSet only for bytes matching Shellfish `proposal_hash` (FR-09, FR-10)
- `submitAndWait` + inspect validated result / Loan ID — never infer success from bare submit
- LoanPay observe/originate (FR-13) when ready
- Honest fallback: `LIVE_DEVNET` vs `SIMULATED_LOAN`

## Build steps

### Hour 0–3 spike (outside this package first is OK)

1. Hit XRPL feature API; confirm lending amendments on the chosen Devnet.
2. Run official create-loan tutorial; get one manual two-signature LoanSet `tesSUCCESS`.
3. Freeze go/no-go: live path or labeled simulation.

### In this package

4. Keep `aprBpsToXrplInterestRate` / reverse helpers unit-tested.
5. Implement controlled signer: only signs canonical approved bytes; agent never gets master seed.
6. Implement `originateLoan`:
   - If `SIMULATED_LOAN`: return `{ simulated: true, validated: false, txHash: null }` (or a clearly labeled sim id — **not** a fake explorer hash).
   - If `LIVE_DEVNET`: construct LoanSet, require Shellfish approval first, submit, store real hash + Loan ID.
7. On timeout: query chain before retry; set state `RECONCILING` — do not release reservation blindly.
8. Implement `repayLoan` (P1 after happy path works).
9. Wire `POST /v1/loans/originate`, `GET /v1/loans/:id`, `POST /v1/demo/repay`.

## Unit traps

- PaymentInterval is **seconds** (30 days = 2,592,000).
- Demo asset may be RLUSD-**like** — do not falsely label a test IOU as real RLUSD.

## Do **not** do here

- Underwriting or mandate policy checks (call authorization first)
- Facility CAS (registry) — orchestrator reserves before you sign

## Done when

- Live mode shows a queryable Devnet hash **or** UI badge says `SIMULATED_LOAN` correctly.
- Unauthorized / denied requests never reach a signature.
