# Fixtures

**Owner:** Gita. Both engineers consume these payloads.

Fictional HarborSupply borrower, a seeded Lender A approval, Lender B decline and REP-CURVE-v0.2 state vectors.

## What this folder is for

`C0-REP-1` supplies deterministic inputs and expected outputs for the shared contract.
Gita requested this revision after the curve decision. Vedant's consumer acceptance is pending.
Every execution example is `SIMULATED_LOAN`. The native contract remains `AWAITING_VEDANT`.
A simulated ALLOW grants no native signing permission.

Use the fixed clock `2026-10-24T18:11:00Z`. Live runs need fresh evidence, offers and mandates.
`sim:*` identifiers and `sig-simulated-*` strings are synthetic inputs, not native accounts or signatures.
The synthetic loan asset is USD with issuer `sim:usd-issuer`. It is not real RLUSD.
Shared `AssetRef` supports currency/issuer assets, native XRP and MPT issuance IDs.
The final native loan asset can differ after Vedant publishes and accepts its mapping.

## C0 package

| File | Contract |
| --- | --- |
| `rep-policy.json` | Exact approved constants and units. The policy hash commits to this object |
| `scenario.json` | Shared context, fixed clock, opening loan, facility and REP balances |
| `evidence-passport.json` | Six accepted history months, active exposure 1000, participating sources only |
| `mandate.json` | Existing monetary limits plus explicit REP consent and 760 REP stake cap |
| `offer-lender-a.json` | Seeded 2000 offer at 550 nominal annual bps, zero fees, proposed 90-day bullet schedule |
| `lender-b-decline.json` | Twelve-month history rule applied to the same six-month evidence |
| `offer-match.json` | Selected firm offer and permitted envelope |
| `reservation.json` | Atomic facility/REP before-and-after example, request commitment and quote |
| `authorization-receipt-allow.json` | Simulated decision after synthetic stake verification. Native signing stays false |
| `rep-bond-cases.json` | Increasing costs, original exposure denial, isolated race vectors and retry semantics |
| `execution-cases.json` | Synthetic stake, success, unknown outcome, cancellation, pending return, repayment and default branches |
| `expected-denials.json` | Baseline mutations and expected codes. Synthetic signatures must be rebuilt after payload changes |
| `network-signing-contract.json` | Known commitment domains and explicit missing Vedant inputs |
| `seed-summary.json` | Human-readable values checked against the scenario and reservation |

## Opening balances and expected transitions

Money uses cents, with `money_scale: 100`. REP uses integer micro-REP strings, with `rep_scale: 1000000`.
API monetary display strings retain two decimal places. Reject unsupported native precision at the adapter boundary.

One opening loan carries 1000 principal and its original 240 REP bond. It remains performing past day 90.
Seed REP is 1000. Available REP is 760. Pending originations and issuer returns start at zero.
Facility A has limit 5000, committed 1000 and headroom 4000.
The new 2000 request costs 720 REP. Reservation leaves available 40, reserved 720 and bonded 240.
Validated origination would move reserved 720 to bonded, giving bonded 960 and available 40.
Synthetic examples describe that transition without claiming validated execution.

The old 3000-exposure scenario now lives in `rep-bond-cases.json` as a denial.
Its three original bonds are 240, 320 and 400. Available REP is 40. A new 2000 request costs 1040.
Do not reset exposure or increase the seed to make it pass.

Full clean repayment of the new 2000 bullet loan at day 90 earns 12 REP before caps.
Its original 720 bond plus 12 reward becomes a pending issuer credit of 732.
Only a validated issuer return makes that credit available. The final available balance is 772.
A partial repayment of 500 on day 30 releases no bond. Full closure on day 90 earns 10 REP.
Late closure returns 720 with zero appreciation. Default forfeits 720 and suspends the principal.
Defaulted principal stays in the history/recovery balance after active principal falls.
Each branch states its own starting snapshot. It does not award the opening loan another reward.

Race vectors isolate facility capacity, REP capacity and repricing against pending exposure.
They use separate valid mandate IDs and nonces for one shared principal.
The vectors calculate expected serial outcomes. They do not prove database concurrency.
Exact key/payload retry returns the existing state. Changed payload under that key fails.
A new request using a consumed mandate nonce fails. A new mandate does not seed fresh REP.

## Commitments and signatures

`SORTED_KEYS_JSON_UTF8_V1` recursively sorts object keys and preserves array order.
It serializes compact JSON with no extra spaces. These vectors use ASCII keys/text and exact integer strings.
SHA-256 output is prefixed `sha256:`. The fixture test contains the reference canonicalizer.
This format is the proposed application contract. Vedant still accepts signature domains and native bytes.

- Evidence excludes `signature` and `evidence_hash` from its content commitment.
- Mandate excludes `principal_signature` and `mandate_hash`.
- Offer excludes `lender_signature` and `offer_hash`. Its separate commercial hash covers the exact terms listed in the test.
- Match excludes `envelope_hash`.
- Reservation hashes its entire `request`, including contract/mode, mandate hash, REP asset and consent limit.
- Receipt `proposal_hash` references that request commitment. It is not a native transaction hash.
- Prepared transaction commitment and final signed transaction hash remain separate and null pending Vedant's contract.

The legacy field name `apr_bps` means **nominal annual interest** in C0-REP-1.
The fixture does not calculate an all-in APR. Native interest/fee rounding and schedule mapping remain open.
New REP denial codes are proposed shared enum additions for Vedant's acceptance.

## Remaining C0 work

| Input | Owner | Current state |
| --- | --- | --- |
| Revised synthetic fixtures and schemas | Gita | Implemented for review |
| General lender A underwriting | Nick | Demo uses a seeded approval. No broader credit rule invented |
| Native mode, endpoint, loan asset, accounts, broker, vault and REP issuance | Vedant | Missing accepted binding |
| Native payment schedule, fees, rounding and grace | Vedant | Proposed 90-day bullet example awaits mapping |
| Mandate signature format, required signer route, prepared transaction commitment | Vedant | Missing accepted binding |
| Exact SDK pin | Gita request implemented | xrpl 5.3.0, latest stable at check. Vedant consumes the tested pin |
| Consumer ACK, next lane claims and hour-four check | Both engineers / coordinator | Pending |

Local schema/evidence/registry implementation can use these deterministic vectors after the bounded lane claim.
Full native integration needs the missing execution contract. No real customer dataset is required for this demo.
The coordinator maintains the central baton. This fixture pass does not mark C0 complete.

## Done when

- `pnpm test -- tests/schemas.fixtures.test.ts` parses every JSON and checks references, commitments and arithmetic.
- `pnpm build`, `pnpm typecheck` and `pnpm test` pass, with remaining security TODOs reported.
- Vedant accepts the exact C0-REP-1 patch/revision in the shared PR-comment channel.
- Runtime atomicity, nonce enforcement, outcome idempotency and controlled native signing receive separate implementation checks.
