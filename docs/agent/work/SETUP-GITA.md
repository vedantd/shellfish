# Gita initial work record

- Label: SETUP-GITA → claim next sequential ID when starting implementation (after C0).
- State: READY. Owner and human sponsor: Gita.
- Coordinator: **Vedant, acknowledged** (B-0001).
- Prepared: 2026-10-25 00:19 UTC. Updated: 2026-10-25 00:41 UTC. Started: not started.
- Accepted base: `7fbcfc718b5f7d8b9cb63ebd3f1f6eb9787486b8`, local `main`.
- Parent: [B-0001 contract checkpoint](../CURRENT-BATON.md).
- Contract: scaffold + adopted process; first accepted interface version still pending C0.
- This record is a queued assignment, not implementation authorization.

## First bounded outcome

Publish one accepted evidence/offer/match example and a callable atomic registry
interface. Then prove the first credit/registry slice against that contract.
Target the first two to four hours after C0 examples are accepted.

## Scope

Own the Gita paths listed in the [profile](../PROJECT-PROFILE.md#exclusive-file-scopes-after-acknowledged-claims).
That includes **schemas** (sole writer), evidence, compatibility, registry, fixtures, Gita routes,
database schema/init and named tests. Package manifests are Vedant's exception.
Do not edit authorization, XRPL, web, root configuration or central records.

## Input and acceptance

Inputs: Nick's exact lender rules, Vedant's network/asset/account/broker/schedule contract,
and the final PRD. Evidence can be synthetic but must be labeled and attributable.

- [ ] Shared `AssetRef` `{ currency, issuer }` on mandate, offer, and evidence exposure.
- [ ] Observation period or history months so Lender B’s ≥12-month rule is computable.
- [ ] Same evidence produces lender A approval and B decline with precise reasons.
- [ ] Matching selects an approved offer within the principal mandate without inventing terms.
- [ ] Reservation and nonce/idempotency updates are atomic under the accepted contract.
- [ ] Two 2,500 reservations against 4,000 headroom yield at most one success.
- [ ] Exact retry returns existing state. Changed key payload or consumed nonce fails.
- [ ] Vedant reproduces the fixture and consumes registry exports without ad hoc fields.

Use current `reserveFacility` and `settleReservation` stubs as observed starting points,
not accepted final signatures. Authorization will call reserve **before** ALLOW;
origination consumes the reservation.

## Checks and result

Existing checks: `pnpm test -- tests/schemas.fixtures.test.ts`, `pnpm test`,
`pnpm typecheck`. New behavioral tests need real implementation.
Ask Gita (sponsor) before install if dependencies are missing.
Result: NOT AVAILABLE for runtime product checks; lane not started.
No commit/push/deploy authorized by this record alone.

## Handoff and stop

Return accepted schema version, fixture, exports, patch/base identity, checks and
TODO counts, remaining gaps, release state and Vedant's exact consumer action.
Keep unresolved execution reserved. Apply verified outcomes idempotently in the next
acknowledged slice. Full repayment UX remains deferred.

**Next action:** Publish C0 fixture + registry contract (AssetRef + observation period)
and request Vedant’s acceptance in a GitHub PR comment. Stop for consumer acceptance
before expanding into the next slice. Editing this file does not claim work.
