# Current Shellfish baton

- Label / ID: **B-0002** (Vedant consumer integration). Parent C0: **B-0001** ACCEPTED.
- State: **REVIEW** for the rough backend handoff. Native implementation paths are coded. Combined regression, hardening and connected Devnet acceptance remain with Vedant.
- Coordinator: **Vedant, acknowledged** 2026-10-25 00:41 UTC.
- Objective owner: coordinator (Vedant). Sponsor: Gita.
- Updated: 2026-10-25 10:26 America/New_York, by Gita's agent under her direct rough-delivery and three-baton handoff request.
- Profile: setup-r1 adopted. Claim channel: **GitHub PR comments** on `vedantd/shellfish`.
- Clone mode: **separate clones**.
- Repository: Shellfish. Branch: `main`. Integration base: `4237c87`, including Vedant's 90-day, zero-fee selection and loan MPT scale six. Rough delivery identity is the commit containing this handoff, pending the actual closeout result.
- Accepted C0 base: **`08397b5449a6f2853e8d5da921ae29034353e4d2`** (Gita producer handoff).
- Delivery: Gita finishes the authorized verification/commit/push closeout, then is **PAUSED** at her direct request. Vedant receives a **REVIEW** handoff for testing, hardening and UI integration. No new consumer ACK or coordinator transfer is recorded.

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

Deliver the rough backend, then pause Gita's lane. Vedant tests and hardens this delivery
before marking native acceptance or starting another implementation scope.

The rough code includes SQLite-backed native credit intents, evidence and approved offers;
detached native mandate authentication; ledger-backed verifiers; account signer lanes;
durable stake/loan signing, submission and reconciliation; repayment/default lifecycle
operations; and the issuer-return worker. The API has eight new native operations.
`GET /openapi.json` covers 24 operations and 56 schemas. The existing joined request view
continues to expose saved loan, REP, receipt and public transaction state.

Vedant's selected product terms remain 90 days, zero fees, 550 bps, principal_minor 200000
and loan MPT asset scale six. Preserve the selection and its public identifiers in
[Native selection](../../services/api/NATIVE-SELECTION.md). Root is finishing the scale-six
integration recheck. Do not treat the previous scale-zero helper assumption as accepted.

Earlier isolated fixtures ran real Devnet transactions. This rough delivery has not run
the connected native smoke, native default or fresh issuer-return lifecycle acceptance.
The new lifecycle worker has not had its runtime tests completed. Existing native mocks
need the durable transport ports before the full new suite can establish regression.

The handoff is code-present, with testing and hardening still open. UI integration can
use the served contract. The backend is not yet fully accepted.

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
- [x] Rough native intent/evidence/approved-offer storage and service wiring implemented. Integration acceptance remains open.
- [x] Vedant selected the native public configuration, 90-day/zero-fee terms and MPT scale six in `4237c87`.
- [ ] Selected configuration, stored state and ledger state pass the complete restart/unknown-debt audit.
- [x] Rough mandate authentication, authenticated verification, durable origination, lifecycle and return workers implemented.
- [ ] Existing mock ports updated and full new regression/lifecycle suite passes.
- [ ] Stateful Devnet smoke PASS (execution grant + real hashes on Devnet).
- [ ] Full connected demo polish (C4 denials/replay/race/timeout on product path).

## Scope

Vedant remains coordinator for B-0002. Gita's agent wrote this narrow current-record and
individual-handoff update under Gita's direct instruction. No new baton ID is allocated.
[Gita](work/SETUP-GITA.md) pauses after the authorized commit/push. [Vedant](work/SETUP-VEDANT.md)
receives the rough backend in REVIEW for testing, hardening and UI. That incoming state is
not a fabricated Vedant acceptance or a new acknowledged implementation claim.

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

### Historical verified repair and UI baseline

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

### Historical durable UI backend evidence

- SQLite helper: 12 behavioral checks PASS. Request/transaction view: 10 checks PASS.
- Actual HTTP process restart test: PASS across two restarts, including saved ALLOW,
  origination without reauthorization, current balances, receipt and exact retry.
- OpenAPI: 12 checks PASS, all 16 registered routes present, 44 schemas, examples and
  current source-schema hashes checked. Generation reproduces the served JSON exactly.
- Full workspace and existing regression checks run again on the combined delivery.
  No native submission is part of this checkpoint.

## Rough delivery checks and known gaps

| Check | Observed scope/result |
| --- | --- |
| Combined workspace checks | Build PASS and typecheck PASS after the final scale-six correction |
| Focused runtime checks | 4 files, 50 tests PASS after the final scale-six correction |
| Native mandate tests | 17 PASS, individual slice |
| Durable execution tests | 7 PASS, individual slice |
| Ledger verifier tests | 15 PASS, individual slice |
| Signer-lane tests | 11 PASS, individual slice |
| OpenAPI contract checks | 12 PASS, 24 operations / 56 schemas, public loan_asset_scale six |
| Native credit source SQLite smoke | PASS with generated wallets and an explicit portfolio verifier test double. Stable intent/signature/evaluation returns APPROVE. No RPC or ledger transaction |
| Lifecycle runtime tests | NOT RUN |
| Full new combined suite | NOT RUN. Existing native mocks need durable ports |
| Connected Devnet smoke / return / default | NOT RUN |

Known handoff boundaries:

- Restart validates configuration. Complete stored-versus-ledger, pending-attempt and
  unknown-debt audits still need testing and hardening.
- Expired signed attempts without proven final absence remain RECONCILING.
- Native intent cache lasts one hour. Use a new idempotency key after expiry.
- Operator compare-and-set recovery requires a stopped worker and exact current owner/fence
  acknowledgement. There is no automatic TTL takeover.
- REP returns need the issuer seed in local-only runtime configuration. Never put it in
  public source, OpenAPI examples, receipts, batons or logs.
- A selected 90-day loan and seven-day grace do not permit an immediate native default.
  Test an actually eligible overdue loan or an explicitly agreed isolated test schedule.
- Earlier 154-test and fixture results above belong to the previous delivery. They do
  not certify this rough backend. No native transaction was submitted by this docs sync.

## Exact next action

Root completes the requested closeout and reports the actual commit/remote ref, then
Gita pauses. Vedant pulls that delivery, runs `pnpm build`, `pnpm typecheck`, focused
new tests and `pnpm exec vitest run --no-cache`, and updates the old native mock adapters.
He then tests lifecycle/recovery and the granted connected Devnet path, records exact
results, hardens failures and wires the UI through the 24-operation OpenAPI contract.
Keep native smoke, native return and native default evidence separate. No new dependency
installation, Mainnet execution, deployment or real WhatsApp sending is authorized here.
