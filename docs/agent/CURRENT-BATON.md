# Current Shellfish baton

- Label / ID: **B-0001** (C0 contract checkpoint) → consumer ACK recorded; next work **B-0002**.
- State: **ACCEPTED** for C0-REP-1 consumer freeze (SIMULATED_LOAN first integration). LIVE_DEVNET native identifiers remain open.
- Coordinator: **Vedant, acknowledged** 2026-10-25 00:41 UTC.
- Objective owner: coordinator (Vedant). Sponsor: Gita.
- Updated: 2026-10-25 11:07 UTC (Vedant consumer ACK after reproduce).
- Profile: setup-r1 adopted. Claim channel: **GitHub PR comments** on `vedantd/shellfish`.
- Clone mode: **separate clones**.
- Repository: Shellfish. Branch: `main`.
- Accepted base: **`08397b5449a6f2853e8d5da921ae29034353e4d2`** (Gita producer handoff).
- Delivery: Gita PAUSED after verified producer delivery (AUTH-GITA-HANDOFF-001). Vedant ACK: AUTH-C0-CONSUMER-001.

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
- First integration mode: **`SIMULATED_LOAN`** per [`fixtures/network-signing-contract.json`](../../fixtures/network-signing-contract.json).
  `native_ready` remains false until Vedant fills endpoint/asset/borrower/broker/schedule/signer fields.
- SDK pin accepted for integration: **xrpl 5.3.0**; runtime **Node 24.21.0** / better-sqlite3 12.10.1.
- Does **not** claim: connected auth/UI demo, LIVE_DEVNET product path, native default, or migrated return-queue native re-run.
- Preserve reserve-before-ALLOW and stake-before-LoanSet.

## Next bounded outcome

**B-0002** (allocated): Vedant wires authorization + XRPL adapter + API/UI to consume Gita exports
under C0-REP-1, starting in `SIMULATED_LOAN`. Publish filled network/signing fields when selecting LIVE_DEVNET.

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
- [ ] LIVE_DEVNET identifiers and required signer route filled in network-signing-contract.
- [ ] Connected integration (auth → sign → submit → Gita accounting → UI) proven on B-0002.

## Scope

Use the [profile's exact allocation](PROJECT-PROFILE.md#exclusive-file-scopes-after-acknowledged-claims).
Lane records: [Gita](work/SETUP-GITA.md) PAUSED after delivery,
[Vedant](work/SETUP-VEDANT.md) ACTIVE for B-0002 consumer integration (claim recorded here + claim channel).

## Fixed product boundaries

Final PRD v1.1 controls product scope. Two engineers code. Nick and Shell provide
bounded non-coding review. Lenders own underwriting. Known exposure is partial.
Reservation precedes required signing. Unknown execution retains capacity.
Simulation remains labeled. Full repayment UX and secondary trading are outside
the first 12-hour slice.

## Consumer verification evidence (2026-10-25 11:06 UTC)

| Check | Result | Scope |
| --- | --- | --- |
| Pull / base | PASS | `main` at `08397b5` |
| Node / pnpm | PASS | Node 24.21.0, pnpm 9.15.0 |
| `pnpm build` | PASS | Workspace |
| `pnpm typecheck` | PASS | Workspace |
| `pnpm test` | PASS | 128 passed / 6 todo (existing security TODOs) |
| Fixture node tests | PASS | 37 passed / 0 todo (`fixtures/xrpl-poc-replay`) |
| C0-REP-1 fixtures package | PASS (review) | AssetRef, observation months, REP fields, reservation/quote examples present |
| LIVE_DEVNET product wiring | NOT STARTED | B-0002 |
| Native default / return-queue native | NOT RUN | As recorded by Gita |

## Exact next action

Vedant executes **B-0002**: inject `openFixtureCreditBackend`, implement `authorizeExactAction`
(reserve once before ALLOW), controlled signer + XRPL originate/repay consuming reservation,
native/simulated verifiers, receipts/UI. Gita stays paused until feedback or a resume request.
Stop at first connected simulation checkpoint before expanding to LIVE_DEVNET term selection.
