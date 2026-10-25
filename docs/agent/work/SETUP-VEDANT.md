# Vedant initial work record

- Label: SETUP-VEDANT, temporary lane label. Sequential work ID not allocated.
- State: READY. Proposed owner and human sponsor: Vedant.
- Coordinator: Vedant, proposed. Claim acknowledgement: none.
- Prepared: 2026-10-25 00:19 UTC. Started: not started.
- Inspected base: `5c31d618b82adf29db102161efbd7a888ef3c521`, local `main`.
- Parent: [current contract checkpoint](../CURRENT-BATON.md).
- Contract: scaffold only. First accepted interface version is pending C0.
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
- [ ] Successful atomic reservation precedes required signature. Denial issues no signature.
- [ ] Persist the final signed blob/hash and reconciliation details before submission.
- [ ] Timeout retains capacity. Verified outcome flows to Gita exactly once.
- [ ] Gita reproduces the agreed execution-result payload and updates accounting.

The scaffold's `originateLoan` is a stub. Rate conversion is not proof of origination.
Do not equate application proposal hash with the final signed transaction hash.
Bind all non-signature fields before signing. No autofill may silently alter the approved action.

## Checks and result

Existing commands: `pnpm test`, `pnpm typecheck`, `pnpm build`.
Their scripts exist. Dependencies were absent during setup and none were installed.
Native validation needs an explicitly scoped implementation/execution grant and exact
endpoint evidence. No stateful network operation is authorized by this work record.

Result: NOT AVAILABLE for runtime checks, not started. No implementation changes,
commits, pushes, deployments, keys configured or native transactions from setup.
No running implementation process was started by the setup editor.

## Handoff and stop

Return mode/network, prepared-transaction contract, fixture result, final execution event,
patch/base identity, checks, remaining gaps and Gita's exact accounting action.
Time-box the native spike. Use labeled simulation if blocked without weakening the
authorization or registry checks. No synthetic native hash or inferred settlement.

Next action: acknowledge setup-r1 and the coordination channel, allocate work IDs,
record the scoped claims, and agree C0 with Gita. Begin only the separately authorized
bounded slice. Stop at the first consumer-accepted checkpoint before expanding scope.
