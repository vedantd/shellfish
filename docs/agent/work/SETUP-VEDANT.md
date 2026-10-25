# Vedant initial work record

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

**Next action:** After Gita publishes C0 fixtures (including REP fields), publish the
network/signing contract and accept the shared example in a GitHub PR comment. Begin
only a separately claimed bounded slice. Stop at the first consumer-accepted checkpoint
before expanding scope.
