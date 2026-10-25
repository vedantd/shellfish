# Current Shellfish baton

- Label: SETUP-DRAFT. No sequential baton ID allocated.
- State: READY.
- Coordinator: Vedant, proposed. Acknowledgement pending.
- Objective owner: unassigned. Sponsor: Gita.
- Updated: 2026-10-25 00:19 UTC. Started: not started.
- Profile: setup-r1. Claim receipt: none.
- Repository: Shellfish. Inspected branch: `main`.
- Baseline: `5c31d618b82adf29db102161efbd7a888ef3c521`.
- Setup state: local documentation only. No implementation claim or release grant.

## Next bounded outcome

Adopt the two-person ownership map and freeze the first producer/consumer contract.
The first working checkpoint is the shared valid fixture plus the reservation and
execution interfaces. It is not the complete 12-hour product milestone.

## Acceptance

- [ ] Vedant acknowledges coordinator role, setup-r1, shared claim channel and clone mode.
- [ ] Coordinator allocates actual IDs and records each owner/base/scope acknowledgement.
- [ ] Gita and Vedant accept one evidence, offer, match, reservation and outcome example.
- [ ] Decide the single reservation call point and retry/replay behavior.
- [ ] Bind full asset identity, evidence observation period, rates, fees and schedule.
- [ ] Separate approved-terms commitment from final signed transaction hash.
- [ ] Name the next check for each work lane and the hour-4 integration gate.

## Scope

Use the [profile's exact allocation](PROJECT-PROFILE.md#exclusive-file-scopes-after-acknowledged-claims).
Both initial assignments remain READY: [Gita](work/SETUP-GITA.md), [Vedant](work/SETUP-VEDANT.md).
Only the bootstrap documentation edits are covered by [AUTH-SETUP-001](AUTHORIZATIONS.md#auth-setup-001).
No product implementation starts from this setup record alone.

## Fixed product boundaries

Final PRD v1.1 controls product scope. Two engineers code. Nick and Shell provide
bounded non-coding review. Lenders own underwriting. Known exposure is partial.
Reservation precedes required signing. Unknown execution retains capacity.
Simulation remains labeled. Full repayment UX and secondary trading are outside
the first 12-hour slice.

## Inspected evidence

| Check | Result | Scope |
| --- | --- | --- |
| Git baseline and status | PASS, clean before setup | Local main at inspected baseline |
| Repo PRD equals Gita's final PDF | PASS, matching SHA-256 | Source identity only |
| Code and route inventory | PASS, scaffold and TODOs confirmed | Static inspection, not runtime acceptance |
| Existing package scripts | PASS, commands defined | Static inspection, not execution |
| Tests/typecheck/build | NOT AVAILABLE, dependencies absent | No install attempted |
| Native loan and repayment | SKIP, outside setup | No network execution |

Documentation link/placeholder/diff validation is reported in the setup delivery.
No fixture parse, security TODO, or rate conversion has been presented as full acceptance.

## Open decisions

Vedant must name the existing shared claim channel and confirm checkout/clone mode.
Both engineers must accept the first contract delta before implementation.
The current scaffold lacks a history period and uses inconsistent asset representations.
Reservation state/API ordering, nonce scope, exact cost/schedule mapping, and verified
outcome payload remain open. Proposed defaults appear on the board, not as accepted code.
Dependencies are not installed. Dependency approval is not required for this Markdown setup.

## Release and operations

Only the nine documentation paths in setup-r1 are in this task's write scope.
No application source, fixtures, package files, database, keys or PRD changed.
No commit, push, publication, deployment or Devnet submission is authorized or performed.
No setup-owned server or external job is running.

## Exact next action

Vedant reads this record and the profile, then posts an attributable setup-r1 acknowledgement
in the existing team channel. He names that channel and clone mode, records the accepted
base/contract, allocates the first IDs and grants the two scopes. Gita then publishes the
agreed fixture and registry contract. Vedant publishes the network/signing contract.
Stop at the shared-contract checkpoint before expanding either assignment.
