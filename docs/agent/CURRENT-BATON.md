# Current Shellfish baton

- Label / ID: **B-0002** (Vedant consumer integration). Parent C0: **B-0001** ACCEPTED.
- State: **ACTIVE** — SIMULATED_LOAN **PASS**; LIVE product wiring **PASS** (PR #5 merged); Devnet execution **APPROVED** (AUTH-DEVNET-001); LIVE smoke **not run yet**.
- Coordinator: **Vedant, acknowledged** 2026-10-25 00:41 UTC.
- Objective owner: coordinator (Vedant). Sponsor: Gita.
- Updated: 2026-10-25 11:54 UTC (AUTH-DEVNET-001: stateful Devnet execution APPROVED).
- Profile: setup-r1 adopted. Claim channel: **GitHub PR comments** on `vedantd/shellfish`.
- Clone mode: **separate clones**.
- Repository: Shellfish. Branch for this slice: `feat/b0002-live-devnet` → [PR #5](https://github.com/vedantd/shellfish/pull/5).
- Accepted C0 base: **`08397b5449a6f2853e8d5da921ae29034353e4d2`** (Gita producer handoff).
- Delivery: Gita PAUSED (AUTH-GITA-HANDOFF-001). Vedant ACK: AUTH-C0-CONSUMER-001. LIVE wiring under B-0002 product claim.

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

**B-0002 follow-up:** fill env from playground/Gita native artifacts, run LIVE smoke under
AUTH-DEVNET-001, record PASS/FAIL; flip fixture `native_ready` only after schema allocation + smoke PASS.
Deferred in parallel: execution-store fencing, return-store issuer Payment, six security TODOs.

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
- [ ] LIVE_DEVNET identifiers committed in network-signing-contract (`native_ready: true`).
- [ ] Stateful Devnet smoke PASS (execution grant + real hashes on Devnet).
- [ ] Full connected demo polish (C4 denials/replay/race/timeout on product path).

## Scope

Use the [profile's exact allocation](PROJECT-PROFILE.md#exclusive-file-scopes-after-acknowledged-claims).
Lane records: [Gita](work/SETUP-GITA.md) PAUSED after delivery,
[Vedant](work/SETUP-VEDANT.md) ACTIVE for B-0002 (SIM PASS; LIVE wiring on PR #5).

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

## Exact next action

Vedant: fill local env from playground / Gita native E2E public IDs + seeds (never commit),
run `NETWORK_MODE=LIVE_DEVNET` smoke under AUTH-DEVNET-001, record PASS/FAIL/SKIP with
revision. Gita stays paused unless schema allocation is needed to flip
`network-signing-contract.json`. Do not invent live hashes.
