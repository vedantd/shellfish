# Current Shellfish baton

- Label / ID: **B-0002** (Vedant consumer integration). Parent C0: **B-0001** ACCEPTED.
- State: **ACTIVE**. Binding repair and durable UI backend PASS. UI reads the joined SQLite view and OpenAPI contract now. Devnet remains the native integration target. Connected product Devnet smoke remains NOT RUN.
- Coordinator: **Vedant, acknowledged** 2026-10-25 00:41 UTC.
- Objective owner: coordinator (Vedant). Sponsor: Gita.
- Updated: 2026-10-25 09:38 America/New_York. Central and both individual records reflect the SQLite/API delivery.
- Profile: setup-r1 adopted. Claim channel: **GitHub PR comments** on `vedantd/shellfish`.
- Clone mode: **separate clones**.
- Repository: Shellfish. Branch: `main`. Current application delivery: **`fbc8de90e46e68213894221a4cfb61b3b6407303`**. Binding repair: `9fad690`. PRs #4, #5 and #6 are merged.
- Accepted C0 base: **`08397b5449a6f2853e8d5da921ae29034353e4d2`** (Gita producer handoff).
- Delivery: Gita resumed by direct request, pushed the binding repair and SQLite/API/OpenAPI delivery, and is REVIEW for the handoff. Vedant remains coordinator and ACTIVE on remaining native execution/UI. Current handoff is in both individual work records.

## Incoming approved model decision

Recorded by Gita's agent at Gita's explicit request, 2026-10-25 03:09 UTC.

**Nick and Gita approved REP-CURVE-v0.2**, as confirmed by Gita in the current request.
Nick's approval is attributed through Gita. This does not assert a separate Nick signature.
Canonical model: [mathematical-model.md](../../mathematical-model.md).
Decision: [REP-CURVE-v0.2](../decisions/REP-CURVE-v0.2.md).
Simulation: [rep-exposure-curve.html](../simulations/rep-exposure-curve.html).

- New stake is C(E + P) minus C(E), where C(E) = 0.2E + 0.00004E squared.
- E covers active plus reserved principal across participating lenders for one principal and asset.
- Retain each original bond until full repayment. Default forfeits it and suspends borrowing.
- Reward base principal-time exposure, not the convex surcharge.
- Gita owns policy/registry. Vedant owns signer/native integration. No XRPL consensus change or AMM.

### Vedant engineering acceptance (coordinator)

- Status: **ACCEPTED for C0 contract design** — 2026-10-25 03:35 UTC.
- Ledger: AUTH-REP-ENG-001.
- Execution mapping locked:
  1. Quote REP bond from the curve against E = active + reserved principal.
  2. Atomically reserve **facility headroom and REP** (Gita registry) **before** ALLOW.
  3. Validate issuer-bound REP redemption / stake proof **before** controlled LoanSet signature.
  4. Originate consumes those reservations; timeout stays RECONCILING with capacity retained.
  5. No AMM, no XRPL consensus change; simulation is explanatory only.

### Vedant consumer acceptance of C0-REP-1 (coordinator)

- Status: **ACCEPTED** — 2026-10-25 11:07 UTC.
- Ledger: AUTH-C0-CONSUMER-001.
- Source: Vedant pulled `08397b5`, reproduced checks, instructed Cursor to record acceptance.
- Accepted package: fixtures under `C0-REP-1` / `REP-CURVE-v0.2`, schemas (`packages/schemas` incl. `c0.ts`),
  evidence, compatibility, registry (reserve/status/quote/events/returns/execution stores),
  Gita HTTP routes, and isolated native E2E evidence under `fixtures/xrpl-poc-replay/`.
- First integration mode: **`SIMULATED_LOAN`** (PASS). LIVE product path wired in PR #5;
  [`fixtures/network-signing-contract.json`](../../fixtures/network-signing-contract.json) stays
  `native_ready: false` (Gita schema locks nulls). Runtime public IDs via env + `GET /v1/network`.
- SDK pin: **xrpl 5.3.0**; runtime **Node 24.21.0** / better-sqlite3 12.10.1.
- Does **not** claim: stateful Devnet smoke PASS, native default, or migrated return-queue native re-run.
- Preserve reserve-before-ALLOW and stake-before-LoanSet.

## Next bounded outcome

Backend UI state is implemented. The same SQLite database now stores checked offers,
receipts and their audit history beside credit requests, loans and ledger event references.
Authorization reservation, offer and receipt storage commit in one SQL transaction.
Restart tests prove existing requests can originate and retry without reauthorization.

The frontend contract is `services/api/src/openapi.json`, served by `GET /openapi.json`.
It covers all 16 HTTP operations and 44 schemas. `GET /v1/requests/:id` joins the receipt,
approved offer/lender decision, current loan/REP state, recorded transaction references
and safe pending-attempt summaries. The API performs no ledger submission for this read.

Devnet is the native integration target. Earlier isolated fixtures ran real Devnet
issuance, REP redemption, LoanSet, LoanPay and restoration. These are existing proof.
The latest HTTP/restart checks use local simulation to test app recovery without
repeating those transactions. They do not replace native evidence.

Next: UI owner wires A/B and completes C against this contract. Vedant supplies coherent
native identifiers/terms, connects authenticated verification, durable execution and
issuer returns, then runs the connected product smoke under AUTH-DEVNET-001.
Native mode's credit services still need matching evidence/approved-offer input records.
Do not infer a credit approval from a transaction hash or relabel a simulated passport.
Gita prepares any selected native source/schema changes under her scope.

The [work board](WORK-BOARD.md#ui-can-start-now) maps screens and endpoint contracts.
Full repayment UI remains deferred. No new baton ID or coordinator takeover is recorded.

## Acceptance

- [x] Vedant acknowledges coordinator role, setup-r1, shared claim channel and clone mode.
- [x] Coordinator allocates B-0001 and records ownership map.
- [x] Vedant engineering-accepts REP-CURVE-v0.2 for C0 (policy math + execution mapping).
- [x] Gita delivered and Vedant accepts one evidence, offer, match, reservation and outcome example (C0-REP-1).
- [x] Single reservation call point: authorize reserves before ALLOW; originate consumes.
- [x] REP stake proof required before controlled LoanSet signature (mapping accepted; product wiring = B-0002).
- [x] Producer fixtures/code bind AssetRef, observation period, terms and REP fields.
- [x] Producer contracts separate commercial terms, prepared commitment and final signed hash.
- [x] Consumer reproduced build/typecheck/128 tests + 37 fixture tests at `08397b5`.
- [x] SIMULATED_LOAN connected authorize → reserve → originate → Screen C (PR #4).
- [x] LIVE_DEVNET product wiring: dual-sign + stake-before-sign + API/UI (PR #5; mocked ledger tests).
- [x] Binding repair `9fad690`: all 20 conformance cases PASS, including 12 previously failing mutations.
- [x] HTTP simulation: ALLOW, altered-term rejection, origination, receipt and exact retry PASS.
- [x] SQLite receipt and approved-offer state survive API restart. Reservation/offer/receipt commit together.
- [x] Joined request/credit/transaction endpoint and OpenAPI contract implemented.
- [ ] Screens A/B consume the APIs and C consumes the joined state. UI ownership remains with Vedant.
- [ ] Native evidence and approved-offer services are populated with matching source records.
- [ ] LIVE_DEVNET identifiers and accepted native configuration recorded in the schema successor. Native proof controls readiness.
- [ ] Stateful Devnet smoke PASS (execution grant + real hashes on Devnet).
- [ ] Full connected demo polish (C4 denials/replay/race/timeout on product path).

## Scope

Use the [profile's exact allocation](PROJECT-PROFILE.md#exclusive-file-scopes-after-acknowledged-claims).
Lane records: [Gita](work/SETUP-GITA.md) REVIEW after the verified repair, with SQLite persistence delivered
and selected native source preparation queued in her existing scope. [Vedant](work/SETUP-VEDANT.md) remains ACTIVE on execution/API/UI. Future work uses acknowledged disjoint claims.


## Fixed product boundaries

Final PRD v1.1 controls product scope. Two engineers code. Nick and Shell provide
bounded non-coding review. Lenders own underwriting. Known exposure is partial.
Reservation precedes required signing. Unknown execution retains capacity.
Simulation remains labeled. Full repayment UX and secondary trading are outside
the first 12-hour slice.

## Consumer verification evidence

### C0 reproduce (2026-10-25 11:06 UTC)

| Check | Result | Scope |
| --- | --- | --- |
| Pull / base | PASS | `main` at `08397b5` |
| Node / pnpm | PASS | Node 24.21.0, pnpm 9.15.0 |
| `pnpm build` | PASS | Workspace |
| `pnpm typecheck` | PASS | Workspace |
| `pnpm test` | PASS | 128 passed / 6 todo |
| Fixture node tests | PASS | 37 passed (`fixtures/xrpl-poc-replay`) |
| C0-REP-1 fixtures package | PASS (review) | Accepted producer package |

### B-0002 LIVE product wiring (2026-10-25 11:47 UTC)

| Check | Result | Scope |
| --- | --- | --- |
| LIVE product wiring (PR #5) | PASS | Auth → stake → LoanSet path in Vedant packages; mocked ledger |
| `pnpm build` / `typecheck` / `test` | PASS | **140 PASS / 6 todo** |
| SIMULATED_LOAN regression | PASS | Prior PR #4 path kept |
| Fixture `native_ready` | false | Schema-locked; env publishes public IDs at runtime |
| Stateful Devnet execution grant | APPROVED | AUTH-DEVNET-001 (2026-10-25 11:54 UTC) |
| Stateful Devnet smoke | NOT RUN | Grant present; env + submit still pending |
| Native default / return-queue native | NOT RUN | As recorded by Gita |

### Current verified repair and UI baseline

Application code: `9fad690`. The following commands ran against that checkout on Node 24.21.0.

| Check | Result | Scope |
| --- | --- | --- |
| Workspace build and typecheck | PASS | Combined workspace |
| Repository tests | PASS | 154 passed, six existing TODOs |
| Source conformance | PASS | 20 cases, including the previous 12 binding failures |
| Checker and native preflight tests | PASS | 26 passed, no TODOs |
| Existing native fixture tests | PASS | 37 passed. No new ledger execution |
| HTTP simulation smoke | PASS | ALLOW, altered 360-day rejection without state change, originate, receipt and exact retry |
| Connected native lifecycle | NOT RUN | Product smoke, native default and fresh migrated return queue remain open |

The earlier 128/140-test tables are historical checkpoint evidence. They do not replace
the current result or establish native execution. No dependency versions changed.

### Durable UI backend evidence

- SQLite helper: 12 behavioral checks PASS. Request/transaction view: 10 checks PASS.
- Actual HTTP process restart test: PASS across two restarts, including saved ALLOW,
  origination without reauthorization, current balances, receipt and exact retry.
- OpenAPI: 12 checks PASS, all 16 registered routes present, 44 schemas, examples and
  current source-schema hashes checked. Generation reproduces the served JSON exactly.
- Full workspace and existing regression checks run again on the combined delivery.
  No native submission is part of this checkpoint.

## Exact next action

UI owner opens `GET /openapi.json` or `docs/API.md`, then uses `GET /v1/requests/:id`
for the credit/loan/receipt/transaction screen. Wire borrower and lender views to the
existing evidence/evaluate/match/status/quote endpoints. Backend SQLite/lookup code is ready.

Vedant completes authenticated native verification, persisted execution and returns,
selects coherent native configuration and runs the granted product smoke. Gita supplies
matching native source/schema records after those values are selected. Native default
and a fresh migrated return-queue native run remain separate unrun acceptance checks.

AUTH-DEVNET-001 remains Vedant's bounded execution grant. A hash or public runtime
`live_ready` value is not a lender approval or a newly authenticated ledger outcome.
Preserve request identity for retries and the one-use mandate boundary.
