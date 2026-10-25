# Gita initial work record

- Label: SETUP-GITA, temporary lane label. Sequential work ID not allocated.
- State: READY. Proposed owner and human sponsor: Gita.
- Coordinator: Vedant, proposed. Claim acknowledgement: none.
- Prepared: 2026-10-25 00:19 UTC. Started: not started.
- Inspected base: `5c31d618b82adf29db102161efbd7a888ef3c521`, local `main`.
- Parent: [current contract checkpoint](../CURRENT-BATON.md).
- Contract: scaffold only. First accepted interface version is pending C0.
- This record is a queued assignment, not implementation authorization.

## First bounded outcome

Publish one accepted evidence/offer/match example and a callable atomic registry
interface. Then prove the first credit/registry slice against that contract.
Target the first two to four hours after acknowledged start.

## Scope

Own the Gita paths listed in the [profile](../PROJECT-PROFILE.md#exclusive-file-scopes-after-acknowledged-claims).
That includes schemas, evidence, compatibility, registry, fixtures, Gita routes,
database schema/init and named tests. Package manifests are Vedant's exception.
Do not edit authorization, XRPL, web, root configuration or central records.

## Input and acceptance

Inputs: Nick's exact lender rules, Vedant's network/asset/account/broker/schedule contract,
and the final PRD. Evidence can be synthetic but must be labeled and attributable.

- [ ] Shared asset representation and observation period support both lender rules.
- [ ] Same evidence produces lender A approval and B decline with precise reasons.
- [ ] Matching selects an approved offer within the principal mandate without inventing terms.
- [ ] Reservation and nonce/idempotency updates are atomic under the accepted contract.
- [ ] Two 2,500 reservations against 4,000 headroom yield at most one success.
- [ ] Exact retry returns existing state. Changed key payload or consumed nonce fails.
- [ ] Vedant reproduces the fixture and consumes registry exports without ad hoc fields.

Use current `reserveFacility` and `settleReservation` stubs as observed starting points,
not accepted final signatures. Update them only through the C0 contract agreement.

## Checks and result

Existing checks: `pnpm test -- tests/schemas.fixtures.test.ts`, `pnpm test`,
`pnpm typecheck`. New behavioral tests need real implementation.
Dependencies were absent during setup. No install is authorized by this record.
Result: NOT AVAILABLE for runtime checks, not started. No changed implementation paths.
No commit, push, deployment or native transaction. No running implementation process.

## Handoff and stop

Return accepted schema version, fixture, exports, patch/base identity, checks and
TODO counts, remaining gaps, release state and Vedant's exact consumer action.
Keep unresolved execution reserved. Apply verified outcomes idempotently in the next
acknowledged slice. Full repayment UX remains deferred.

Next action: after coordinator allocation and a bounded implementation request,
agree C0 with Vedant and publish the fixture plus registry contract. Stop for consumer
acceptance before expanding into the next slice. Editing this file does not claim work.
