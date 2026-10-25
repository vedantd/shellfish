# Current Shellfish baton

- Label / ID: **B-0001** (replaces SETUP-DRAFT).
- State: REVIEW. Gita producer implementation is verified. Vedant consumer acceptance is pending.
- Coordinator: **Vedant, acknowledged** 2026-10-25 00:41 UTC.
- Objective owner: coordinator (Vedant) for C0 contract freeze. Sponsor: Gita.
- Updated: 2026-10-25 10:45 UTC. Gita is paused at her explicit handoff request.
- Profile: setup-r1 adopted. Claim receipt: this baton + GitHub PR comments channel.
- Repository: Shellfish. Branch: `main`.
- Accepted base: `cf601b40639899d36c34b3df49b6499b0975a434` (includes REP-CURVE docs).
- Claim channel: **GitHub PR comments** on `vedantd/shellfish`.
- Clone mode: **separate clones**.
- Current checkpoint: producer code delivered for C0 review under Gita's later direct implementation request.
- Delivery base: 64d31b1 plus the producer commit containing this record. No Vedant ACK is invented.

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
- Source: Vedant reviewed the model and decision after Gita's pull; instructed Cursor to record acceptance.
- Ledger: AUTH-REP-ENG-001.
- Meaning: Shellfish C0 and later implementation **will follow** REP-CURVE-v0.2 as the reputation-bond policy. This is not a claim that code, Devnet, or native MPT flows are done.
- Execution mapping locked for C0:
  1. Quote REP bond from the curve against E = active + reserved principal.
  2. Atomically reserve **facility headroom and REP** (Gita registry) **before** ALLOW.
  3. Validate issuer-bound REP redemption / stake proof **before** controlled LoanSet signature.
  4. Originate consumes those reservations; timeout stays RECONCILING with capacity retained.
  5. No AMM, no XRPL consensus change; simulation is explanatory only.
- C0 payload fields that must appear in the shared fixture/contracts:
  `model_version` (`REP-CURVE-v0.2`), principal REP spend consent, stake proof /
  redemption reference, pending return credit states, verified outcome / suspension fields —
  plus prior AssetRef + observation-period requirements.

## Next bounded outcome

Freeze the first producer/consumer contract (C0): one accepted evidence / offer / match /
reservation / outcome example, plus network/signing contract. Not the full 12-hour demo.

## Acceptance

- [x] Vedant acknowledges coordinator role, setup-r1, shared claim channel and clone mode.
- [x] Coordinator allocates B-0001 and records ownership map (scopes remain READY until claimed).
- [x] Vedant engineering-accepts REP-CURVE-v0.2 for C0 (policy math + execution mapping).
- [ ] Gita and Vedant accept one evidence, offer, match, reservation and outcome example (fixtures).
- [x] Single reservation call point decided: authorize reserves before ALLOW; originate consumes.
- [x] REP stake proof required before controlled LoanSet signature (mapping accepted; not implemented).
- [x] Producer fixtures/code bind asset identity, observation period, terms and REP fields. Consumer acceptance remains pending.
- [x] Producer contracts/store separate commercial terms, prepared commitment and final signed hash. Native consumer integration remains pending.
- [x] Next consumer checks are named in the incoming handoff and both work records. Connected integration gate remains open.

## Scope

Use the [profile's exact allocation](PROJECT-PROFILE.md#exclusive-file-scopes-after-acknowledged-claims).
Lane records: [Gita](work/SETUP-GITA.md) PAUSED after verified producer delivery,
[Vedant](work/SETUP-VEDANT.md) READY for consumer review and integration.
Gita authorized the narrow baton/dependency update directly. Coordinator ownership and
allocation of new IDs remain with Vedant.

## Fixed product boundaries

Final PRD v1.1 controls product scope. Two engineers code. Nick and Shell provide
bounded non-coding review. Lenders own underwriting. Known exposure is partial.
Reservation precedes required signing. Unknown execution retains capacity.
Simulation remains labeled. Full repayment UX and secondary trading are outside
the first 12-hour slice.

## Historical setup and engineering evidence

| Check | Result | Scope |
| --- | --- | --- |
| Git baseline and status | PASS | Local `main` at `7fbcfc7`, clean at alignment edit start |
| Repo PRD equals Gita's final PDF | PASS | SHA-256 `1ee77372d9cc27a587055ccceb123e66177346e925523bc63355d86824d34787` |
| PRD product thesis vs baton roles | PASS | Vedant=You, Gita=credit/registry, Nick/Shell non-coding |
| PRD non-goals vs baton boundaries | PASS | No micro-bonds, universal score, production custody |
| Atomic reserve as P0 (PRD §11.4.2) | PASS | Board notes FR-14 P1 does not override |
| Schemas ownership docs vs AGENTS | FAIL then fixed | Scaffold said Shared; now Gita sole writer + Vedant accept |
| Reserve vs ALLOW order in build docs | FAIL then fixed | Standardized to reserve-before-ALLOW |
| Fixture asset identity consistency | FAIL (open C0) | Mandate `{currency,issuer}`; offer/evidence string `RLUSD` |
| Evidence observation period for Lender B | FAIL (open C0) | History counts only; no months/window for ≥12 month rule |
| Tests/typecheck/build this pass | SKIP | Docs-only; no install or runtime claimed |
| Native loan and repayment | SKIP | Outside this baton |
| REP-CURVE-v0.2 product math | PASS (Nick/Gita policy) | Decision record + model |
| REP-CURVE-v0.2 engineering accept | PASS (Vedant) | C0 design only; not implemented |
| REP curve simulation | SKIP as prod proof | Explanatory HTML only |

No fixture parse, security TODO, or rate conversion is presented as full acceptance.

## Current C0 dependencies

- Vedant accepts the delivered C0-REP-1 fixtures, registry/event APIs and source revision.
- Select exact connected-demo native asset, accounts, broker, schedule, fees and signer route.
- Wire producer services into authorization, native verification, receipts and UI.
- Reproduce combined checks before closing C0 or claiming full demo acceptance.

## Historical release and operations

This pass records engineering acceptance of REP-CURVE-v0.2 on central agent docs only.
No application source, fixtures JSON, package code, database, keys or PRD binary changed
by the acceptance itself. Commit/push of this acknowledgement is a separate coordinator
action when requested. No Devnet submission authorized.

## Incoming verified producer handoff

Gita explicitly requested this update, commit/push and pause on 2026-10-25 10:45 UTC.
This does not transfer coordinator ownership or record Vedant acceptance.

- Producer implementation: schemas/fixtures, evidence, A/B lender decisions, match, atomic
  facility+REP reserve, nonce/retry protection, exact curve, fixed bonds, rewards/default,
  verified event accounting, durable attempts, issuer returns and status/quote API.
- Checks: build/typecheck PASS, 128 repository tests PASS / six existing TODOs, 37 separate
  fixture tests PASS / zero TODOs. Includes original simultaneous 2,500-vs-4,000 vector.
- Native fixture proof: issuance, redemption, LoanSet, LoanPay and restoration passed.
  Native default and fresh execution of the migrated return queue remain NOT RUN.
- Dependency graph: Gita producer exports → Vedant authorization/required signer + native
  verifiers → persisted execution → Gita accounting → Vedant receipt/UI acceptance.
- Full Shellfish completion is not claimed. Gita is waiting for consumer feedback.

## Exact next action

Vedant pulls the producer delivery, reads SETUP-VEDANT.md and packages/registry/README.md,
accepts the exact C0 package in the agreed claim channel, then injects the shared backend
and wires the required signer and verified outcomes. Preserve reserve-before-ALLOW and
stake-before-LoanSet signing. Gita remains paused until feedback or a resume instruction.
