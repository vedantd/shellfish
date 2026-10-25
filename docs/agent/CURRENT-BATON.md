# Current Shellfish baton

- Label / ID: **B-0001** (replaces SETUP-DRAFT).
- State: READY (coordinator adopted; product coding not claimed).
- Coordinator: **Vedant, acknowledged** 2026-10-25 00:41 UTC.
- Objective owner: coordinator (Vedant) for C0 contract freeze. Sponsor: Gita.
- Updated: 2026-10-25 00:41 UTC. Started: acknowledgement recorded; implementation not started.
- Profile: setup-r1 adopted. Claim receipt: this baton + GitHub PR comments channel.
- Repository: Shellfish. Branch: `main`.
- Accepted base: `7fbcfc718b5f7d8b9cb63ebd3f1f6eb9787486b8`.
- Claim channel: **GitHub PR comments** on `vedantd/shellfish`.
- Clone mode: **separate clones**.
- Setup state: documentation aligned to PRD v1.1. No product implementation claim or release grant.

## Next bounded outcome

Freeze the first producer/consumer contract (C0): one accepted evidence / offer / match /
reservation / outcome example, plus network/signing contract. Not the full 12-hour demo.

## Acceptance

- [x] Vedant acknowledges coordinator role, setup-r1, shared claim channel and clone mode.
- [x] Coordinator allocates B-0001 and records ownership map (scopes remain READY until claimed).
- [ ] Gita and Vedant accept one evidence, offer, match, reservation and outcome example.
- [x] Single reservation call point decided: authorize reserves before ALLOW; originate consumes.
- [ ] Bind full asset identity, evidence observation period, rates, fees and schedule (C0 fixture).
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

No fixture parse, security TODO, or rate conversion is presented as full acceptance.

## Open decisions (C0 remaining)

- Unified `AssetRef` (currency + issuer) on mandate, offer, evidence exposure, registry.
- Evidence observation period or history months so Lender B’s 12-month rule is computable.
- Exact cost/schedule mapping and verified outcome payload shapes.
- Both engineers must accept the first versioned fixture example before coding slices.

Reservation call point and claim channel/clone mode are **decided** (see above).

## Release and operations

This pass updates central agent docs and scaffold ownership/reserve wording only.
No application source, fixtures JSON, package code, database, keys or PRD binary changed.
No commit, push, publication, deployment or Devnet submission authorized by this baton alone.

## Exact next action

Gita claims her lane and publishes the agreed C0 fixture + registry contract (AssetRef +
observation period). Vedant publishes the network/signing contract against the same
identifiers. Both accept in a PR comment on `vedantd/shellfish`. Stop at that shared
contract before either expands into product implementation.
