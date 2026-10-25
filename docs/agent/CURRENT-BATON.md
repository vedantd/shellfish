# Current Shellfish baton

- Label / ID: **B-0001** (replaces SETUP-DRAFT).
- State: READY (coordinator adopted; product coding not claimed).
- Coordinator: **Vedant, acknowledged** 2026-10-25 00:41 UTC.
- Objective owner: coordinator (Vedant) for C0 contract freeze. Sponsor: Gita.
- Updated: 2026-10-25 03:35 UTC. Started: acknowledgement recorded; implementation not started.
- Profile: setup-r1 adopted. Claim receipt: this baton + GitHub PR comments channel.
- Repository: Shellfish. Branch: `main`.
- Accepted base: `cf601b40639899d36c34b3df49b6499b0975a434` (includes REP-CURVE docs).
- Claim channel: **GitHub PR comments** on `vedantd/shellfish`.
- Clone mode: **separate clones**.
- Setup state: documentation aligned to PRD v1.1. REP-CURVE-v0.2 engineering-accepted for C0. No product implementation claim.

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
- [ ] Bind full asset identity, evidence observation period, rates, fees, schedule, and REP fields (C0 fixture).
- [ ] Separate approved-terms commitment from final signed transaction hash.
- [ ] Name the next check for each work lane and the hour-4 integration gate.

## Scope

Use the [profile's exact allocation](PROJECT-PROFILE.md#exclusive-file-scopes-after-acknowledged-claims).
Lane records remain READY: [Gita](work/SETUP-GITA.md), [Vedant](work/SETUP-VEDANT.md).
No product implementation starts until each owner claims a bounded slice after C0 examples exist.

## Fixed product boundaries

Final PRD v1.1 controls product scope. Two engineers code. Nick and Shell provide
bounded non-coding review. Lenders own underwriting. Known exposure is partial.
Reservation precedes required signing. Unknown execution retains capacity.
Simulation remains labeled. Full repayment UX and secondary trading are outside
the first 12-hour slice.

## Inspected evidence

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

## Open decisions (C0 remaining)

- Unified `AssetRef` (currency + issuer) on mandate, offer, evidence exposure, registry.
- Evidence observation period or history months so Lender B’s 12-month rule is computable.
- Fixture/schema fields for `model_version`, REP consent, stake proof, pending returns, suspension.
- Exact cost/schedule mapping and verified outcome payload shapes.
- Both engineers must accept the first versioned fixture example before coding slices.

Reservation call point, claim channel/clone mode, and REP-CURVE-v0.2 as C0 math are **decided**.

## Release and operations

This pass records engineering acceptance of REP-CURVE-v0.2 on central agent docs only.
No application source, fixtures JSON, package code, database, keys or PRD binary changed
by the acceptance itself. Commit/push of this acknowledgement is a separate coordinator
action when requested. No Devnet submission authorized.

## Exact next action

Gita publishes the C0 fixture + registry contract including AssetRef, observation period,
and REP-CURVE fields (`model_version`, consent, stake proof, pending returns). Vedant
publishes the network/signing contract binding validated REP redemption before LoanSet.
Both accept that package in a GitHub PR comment. Then allocate bounded lane claims.
Stop before product implementation until that fixture package is accepted.
