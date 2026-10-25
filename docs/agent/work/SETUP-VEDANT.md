# Vedant work record

## Current incoming rough backend handoff

- Recorded: 2026-10-25 10:26 America/New_York, by Gita's agent under her direct handoff instruction.
- State: **REVIEW** — consumer regression restored locally; **not** full backend acceptance. Vedant remains coordinator for B-0002.
- Delivery SHA pulled: `1a0ddcd` (on `main` after selection merge `4237c87`). Selection preserved: 90 days, zero fees, interval 7776000, 550 bps, principal_minor 200000 and loan MPT scale six.
- Code includes native SQLite credit sources/intents, detached principal mandate authentication, ledger-backed verifiers, signer lanes, durable origination/reconciliation and repayment/default/REP-return workers.
- Frontend contract: `GET /openapi.json`, 24 operations / 56 schemas. Eight new native API operations.
- Existing joined request/loan/credit/transaction reads and SQLite receipt/approved-offer storage remain available.

### Consumer verification (2026-10-25, Vedant) — regression restore only

| Check | Result | Scope |
| --- | --- | --- |
| Pull / base | PASS | `main` at `1a0ddcd` |
| `pnpm build` / `pnpm typecheck` | PASS | Workspace |
| `pnpm exec vitest run --no-cache` | PASS | **205 PASS / 6 todo** |
| LIVE mock ports | PASS | `tests/xrpl.test.ts` updated to durable `transport` + `execution` + `signerLanes` |
| Full backend acceptance | NOT CLAIMED | Lifecycle runtime, recovery audit, Devnet smoke still open |
| Connected Devnet smoke | NOT RUN | AUTH-DEVNET-001 still granted |

- Lifecycle runtime tests, operator CAS recovery, restart/unknown-debt audit, LIVE source-doc P2, UI Screens A/B, and native smoke/return/default remain open.
- Do not treat playground-term verification doubles as 90d/0 product acceptance.

### Exact testing and hardening handoff

1. Pull the delivery and run `pnpm build`, `pnpm typecheck` and focused new tests on Node 24.21.0 / SQLite 12.10.1 / XRPL.js 5.3.0. Update old mock ledger adapters, then run `pnpm exec vitest run --no-cache`.
2. Verify the selected scale-six loan asset against all principal/fee conversions and compare stored state with actual ledger state after restart. Audit pending attempts and unknown debt before treating startup as complete.
3. Exercise crash, timeout, exact retry and completed native-outcome reconciliation. An expired absent attempt stays RECONCILING until final absence/failure is proved. Do not sign a replacement to make the test pass.
4. Exercise stopped-worker operator CAS recovery with the exact owner/fence. There is no automatic expiry or takeover. Check the one-hour native-intent cache and use a new key after expiry.
5. Provision the REP issuer seed locally for returns. Test repayment metadata/principal reduction, owed REP, serialized issuer return and replay. Keep keys and signed blobs out of shared output.
6. Run the bounded Devnet smoke under AUTH-DEVNET-001, then fresh native return and eligible native default checks. A 90-day loan/seven-day grace cannot be forced into immediate default. Record any isolated test schedule separately.
7. Record failures, harden the code and update the six security TODOs through actual consumer checks. Wire borrower/credit/receipt UI to OpenAPI and the joined read view. Do not label the rough backend fully accepted before these checks.

## Historical incoming Gita handoff: SQLite and frontend contract

- Recorded: 2026-10-25 09:38 America/New_York, at Gita's request to sync central and individual batons.
- Application delivery: `fbc8de90e46e68213894221a4cfb61b3b6407303`, committed and pushed after `9fad690` binding repair.
- This records the delivered handoff, not a new Vedant ACK. Vedant remains ACTIVE on B-0002.
- Delivered: durable SQLite offer/receipt state with atomic authorization storage, public joined request/loan/credit/transaction view, and served OpenAPI contract.
- Frontend entry points: `GET /openapi.json` and `GET /v1/requests/:id`. Source contract: `services/api/src/openapi.json`. Guide: `docs/API.md`.
- Verified on the actual checkout: build/typecheck PASS, 154 repository tests PASS with six existing TODOs, 23 UI backend tests PASS, 12 OpenAPI checks PASS, 20 conformance cases PASS and 63 prior fixture tests PASS.
- HTTP test restarts the API twice, then fetches the same receipt, originates the existing reservation without reauthorization and retries without duplicate events.
- Earlier isolated native fixtures used real Devnet transactions. No new ledger submission occurred in this UI backend delivery.

### Historical pre-rough backend dependency list

1. ~~Select coherent native accounts, loan asset/scale, schedule and fees.~~ **PASS (draft)** — 2026-10-25.
   Locked product terms: 90-day / zero fees / interval 7776000 / 550 bps / principal_minor 200000.
   Env defaults fixed in `@shellfish/xrpl` + `.env.live.example`. Draft + preflight report:
   [`services/api/NATIVE-SELECTION.md`](../../../services/api/NATIVE-SELECTION.md).
   Preflight exit 2 / `CONFIGURATION_INCOMPLETE` solely from default SIM source docs (expected).
2. Supply matching native evidence/approved-offer inputs to `live-backend.ts`. **Gita prepares**
   LIVE_DEVNET portfolio/mandate/offer/request/evidence + `native_asset_metadata` against the
   selection in `services/api/native-selection.draft.json`. Vedant injects nonempty services.
   Transaction hashes alone do not create underwriting or a passport.
3. Connect execution-store fencing, finalized-field commitments and signed-attempt persistence before submission. Reconcile the saved attempt after timeout or restart, including completed native outcomes.
4. Replace structural-only portfolio/event checks with authenticated ledger-backed verification and the required native mandate/signing validation.
5. Connect the issuer-return worker to the existing durable return store. Verified repayment creates owed REP, then a validated issuer Payment makes it available once.
6. Run the granted connected Devnet smoke and C4 checks. Record native default and the fresh migrated return-queue proof separately. Close the six security TODOs with the actual application path.

### Historical Gita ask after Priority 1 selection

Please produce LIVE_DEVNET source records bound to
[`services/api/native-selection.draft.json`](../../../services/api/native-selection.draft.json)
(public borrower/broker/MPT/broker_id + 90d/0-fee terms). Do not relabel SIMULATED_LOAN fixtures.
Schema successor for `network-signing-contract` `native_ready` remains separate after smoke.

UI integration can proceed now against the documented routes. Borrower and lender screens still need wiring, and the receipt screen should consume the joined read view. Existing helpers, APIs and SQLite persistence are delivered. The historical entries below retain their original checkpoint evidence.

## C0-REP-1 consumer ACK and B-0002 claim

- Recorded: 2026-10-25 11:07 UTC. Ledger: AUTH-C0-CONSUMER-001. Parent: B-0001 → **B-0002**.
- Original C0 claim: ACTIVE on B-0002. Gita later resumed and delivered the current handoff above.
- Accepted base: `08397b5449a6f2853e8d5da921ae29034353e4d2`.
- Contract: C0-REP-1 / REP-CURVE-v0.2. First mode: **SIMULATED_LOAN**.
- Checks reproduced locally (Node 24.21.0): build PASS, typecheck PASS, 128 tests PASS /
  6 todo, 37 fixture tests PASS.
- Claim: Vedant owns authorization, XRPL, remaining API (inject backend), web, named tests.
  Do not edit Gita schemas/registry/evidence/compatibility/fixtures/gita routes except via request.
- Stop for B-0002 first checkpoint: simulated authorize → reserve → originate consume →
  receipt/status path without inventing native hashes.

## B-0002 first checkpoint (SIMULATED_LOAN) — 2026-10-25

- State: **PASS** for first connected simulation checkpoint.
- Implemented: API `openFixtureCreditBackend` inject + shutdown close; `authorizeExactAction`
  reserves once before ALLOW; `originateLoan` SIM path consumes reservation via `applyEvent`;
  You routes authorize/originate/loan/receipt; demo repay simulated; Screen C happy-path button.
- Checks: `pnpm build` PASS, `pnpm typecheck` PASS, `pnpm test` **137 PASS / 6 todo**
  (new `tests/authorization.test.ts`, `tests/xrpl.test.ts`). API smoke: credit-status 200,
  ALLOW with `reservation_id`, originate `simulated:true` / `txHash:null`.

## B-0002 LIVE_DEVNET product slice — 2026-10-25

- State: **PASS** for product wiring (mocked ledger unit tests). Stateful Devnet smoke: **NOT RUN**.
  Execution grant: **AUTH-DEVNET-001 APPROVED** 2026-10-25 11:54 UTC.
- Checks: `pnpm build` PASS, `pnpm typecheck` PASS, `pnpm test` **140 PASS / 6 todo**.
- Implemented (Vedant paths only):
  - `@shellfish/xrpl` LIVE dual-sign LoanSet / LoanPay / REP redeem; `originateLoan` LIVE path
    stakes before sign, applies native evidence hashes; structural verifiers for registry.
  - `attachLiveStakeProof` for real `stake_proof_id` + prepared commitment (no sim invent on LIVE).
  - API `live-backend.ts` / `live-config.ts` / `live-materials.ts`; `NETWORK_MODE=LIVE_DEVNET`
    bootstrap; you routes + Screen C branch for real `txHash` / explorer; sim path unchanged.
  - Public signing fields from env via `GET /v1/network` and `services/api/.env.live.example`.
- Signing contract fixture: `fixtures/network-signing-contract.json` left
  `native_ready: false` / `AWAITING_VEDANT` — Gita schema locks nulls; do not edit without
  allocation. Runtime publishes public IDs from env when LIVE is configured.
- Gaps (later): execution-store fencing, return-store issuer Payment, client-backed native
  re-verify, six security TODOs, Devnet smoke when execution grant exists.

## Incoming Gita producer handoff

- Updated at Gita's explicit request on 2026-10-25 10:45 UTC. Coordinator remains Vedant.
- Consumer ACK completed under AUTH-C0-CONSUMER-001 (see above). Historical notice below
  remains for provenance.
- Read the current checkpoint in SETUP-GITA.md and packages/registry/README.md first.
- Contract: C0-REP-1 / REP-CURVE-v0.2. Delivery base `08397b5`.

### Required next actions

1. Pull origin/main and reproduce build/typecheck, 128 repository passes plus six existing
   TODOs, and 37 separate fixture passes. Use Node 24.21 / SQLite 12.10.1 / XRPL.js 5.3.0.
2. Inject `openFixtureCreditBackend(config.databasePath).services` into `gitaRoutes` for
   simulation and close the backend on app shutdown. Without registry injection the
   facility/status/quote routes return 503. Native mode needs trusted sources.
3. Consume `registry.reserveRequest` once before ALLOW. Reuse its reservation in
   origination. Require verified REP redemption before the controlled LoanSet signature.
4. Consume `createExecutionStore`, `freezePreparedAction` and immutable signed attempts.
   Decode/hash-check signed bytes, persist before submit and reconcile the same blob.
5. Supply `verifyNativePortfolio`, `verifyNativeEvent` and `verifyReturnFailure`. Native
   servicing events must bind `servicing.nextPaymentDueAt` to post-LoanManage state.
6. Consume `createReturnStore` for issuer returns. Keep unknown outcomes OWED and the
   issuer lane retained. Verify exact delivery and credit memo before atomic settlement.
7. Wire receipts/UI to the same persisted request and registry status. Replace the six
   security TODOs with connected denial/replay/race/timeout checks. Run the migrated
   native return path and a separately overdue native LoanManage default.

### Available producer exports

- Schemas: AssetRef, EvidencePassport, AtomicReservationRequest, CreditStatus and CreditQuote.
- Services: createEvidenceService, createCompatibilityService, openFixtureCreditBackend.
- Registry: reserveRequest, getCreditStatus, quoteCredit, applyEvent, getRequest and getLoan.
- Execution: createExecutionStore and createReturnStore. No raw event/signing mutation HTTP API.
- UI reads: GET `/v1/facilities/:id/credit-status`, POST `/v1/facilities/:id/quote`.
  Quotes grant no permission. Final reserve reprices atomically.

### Decisions and proof boundary

- Approved math is unchanged. REP burns before origination. Default forfeits the
  restoration right, with no second burn. Full repayment restores through issuer Payment.
- Native POC terms 1,000/30 days/100 origination fee/10 service fee stay separate from
  C0 terms 2,000/90 days/zero fees. Select and accept the exact connected-demo terms.
- Native repayment/REP mechanics passed in the isolated fixture. Native default, the
  migrated return queue and the production authorization/UI integration remain unproven.
- No edit to Vedant authorization, XRPL source, entrypoint or UI accompanies this notice.

## Historical initial assignment

- Label: SETUP-VEDANT → claim next sequential ID when starting implementation (after C0).
- State: READY. Owner and human sponsor: Vedant.
- Coordinator: **Vedant, acknowledged** (B-0001).
- Prepared: 2026-10-25 00:19 UTC. Updated: 2026-10-25 00:41 UTC. Started: not started.
- Accepted base: `7fbcfc718b5f7d8b9cb63ebd3f1f6eb9787486b8`, local `main`.
- Parent: [B-0001 contract checkpoint](../CURRENT-BATON.md).
- Contract: scaffold + adopted process; first accepted interface version still pending C0.
- This record is a queued assignment, not implementation authorization.

## First bounded outcome

Publish the exact execution and signing contract, choose a supported native or
explicit simulation path, and make the gate consume Gita's agreed reservation interface.
Target the network decision by hour two and first integration by hour four.

## Scope

Own the Vedant paths listed in the [profile](../PROJECT-PROFILE.md#exclusive-file-scopes-after-acknowledged-claims).
That includes authorization, XRPL, orchestration, receipts, UI, root configuration,
manifests and named tests. Gita owns schemas, fixtures, Gita routes and database files.
`services/api/src/routes/demo.ts` is Vedant's facade calling Gita's evidence exports.
Do not rename `you.ts` as a coordination change or silently edit Gita's contract.

## Input and acceptance

Inputs: Gita's approved offer and reservation contract, Shell's bounded negative cases,
the final PRD, and the selected endpoint's observed feature support.

- [ ] Publish network/mode, exact asset, borrower, broker ID, supported schedule and SDK pin.
- [ ] Required signer is behind the policy gate. Agent has no unrestricted signing seed.
- [ ] Prepared transaction matches the accepted offer, mandate and transaction commitment.
- [ ] `authorizeExactAction` reserves via Gita registry **before** ALLOW; denial issues no signature.
- [ ] Origination **consumes** reservation; does not reserve again.
- [ ] Persist the final signed blob/hash and reconciliation details before submission.
- [ ] Timeout retains capacity. Verified outcome flows to Gita exactly once.
- [ ] Gita reproduces the agreed execution-result payload and updates accounting.

The scaffold's `originateLoan` is a stub. Rate conversion is not proof of origination.
Do not equate application proposal hash with the final signed transaction hash.
Bind all non-signature fields before signing. No autofill may silently alter the approved action.

## Checks and result

Existing commands: `pnpm test`, `pnpm typecheck`, `pnpm build`.
Ask Gita before dependency installation. Native validation needs an explicitly scoped
implementation/execution grant and exact endpoint evidence.
Result: NOT AVAILABLE for runtime product checks; lane not started.
Coordinator ACK of setup-r1 is recorded on B-0001; that does not start this lane.

## Handoff and stop

Return mode/network, prepared-transaction contract, fixture result, final execution event,
patch/base identity, checks, remaining gaps and Gita's exact accounting action.
Time-box the native spike. Use labeled simulation if blocked without weakening the
authorization or registry checks. No synthetic native hash or inferred settlement.

## REP-CURVE engineering accept

- Recorded: 2026-10-25 03:35 UTC under AUTH-REP-ENG-001.
- Accepted REP-CURVE-v0.2 for C0 design: reserve facility+REP before ALLOW; validated
  REP redemption before controlled LoanSet; no AMM/consensus.
- Lane remains READY and unclaimed for coding.

**Next action (B-0002 follow-up):** Pull the rough backend delivery, run the testing/hardening sequence in the current incoming handoff, then integrate the UI. Native implementation paths are now coded but not fully accepted. Gita pauses after delivery. AUTH-DEVNET-001 remains the existing bounded smoke grant.
