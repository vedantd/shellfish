# Shellfish two person baton protocol

Status: setup-r1 prepared under Gita's documentation request. Coordinator adoption pending.

## Canonical records

- [Profile](PROJECT-PROFILE.md): authority, scopes, commands and permissions.
- [Current baton](CURRENT-BATON.md): one coordinating objective and next action.
- [Work board](WORK-BOARD.md): dependencies, milestones and acknowledged claims.
- [Authorizations](AUTHORIZATIONS.md): attributable grants and their limits.
- [Gita work record](work/SETUP-GITA.md) and [Vedant work record](work/SETUP-VEDANT.md).

Only the acknowledged coordinator edits central records and allocates baton IDs.
Contributors maintain their own scoped records. The coordinator can use an agent
acting in their session. Other agents submit proposed central-record diffs.

## Bootstrap and claims

Gita requested this setup. The setup editor can draft central records under that request.
Vedant is the proposed coordinator, not an acknowledged active owner. No product claim exists.
Vedant adopts setup-r1, names one existing shared claim channel and confirms clone mode.
He then allocates IDs and acknowledges each owner, base, contract and exclusive scope.

Example acknowledgement, completed with real evidence at adoption:

```text
ACK setup-r1. Coordinator: Vedant. Claim channel: name the existing shared channel.
Accepted base: exact commit and any contract patch. Contract: accepted version.
Allocate B-0001 to the current objective and record each scoped owner acknowledgement.
```

Do not paste the example as evidence of a real acknowledgement. A claim record must
include an attributable source and actual time. Setup approval does not start coding.

## States

| State | Meaning |
| --- | --- |
| READY | Bounded work is queued and unclaimed |
| ACTIVE | Acknowledged owner works inside the accepted scope |
| REVIEW | The named acceptance check or decision awaits its actual reviewer |
| BLOCKED | A concrete external fact prevents the remaining required work |
| PAUSED | A human explicitly stopped the work |

Completed work is archived with COMPLETE, DEFERRED or SUPERSEDED disposition.
The current baton then names the next READY objective. Do not use DONE for active state.
Complexity or an optional environment does not block independent work.

## Work loop

1. Reconcile Git, current records, approvals and the accepted base.
2. Confirm the owner, bounded outcome, exclusive scope, check and stop boundary.
3. Build the usable slice. Preserve unknown edits. Use fixtures only with clear labels.
4. Run the narrow check for the changed boundary. Broaden for integration or new failures.
5. Return the handoff packet. The consumer runs its check against the combined revision.
6. Update current status and archive the true outcome. Carry unfinished gates forward.

Gita publishes contracts and credit/registry exports. Vedant consumes them in authorization
and execution. Vedant returns verified execution outcomes. Gita applies accounting once.
The [board](WORK-BOARD.md) defines the four handoff payloads and proposed 12-hour targets.

## Handoff packet

```text
Work ID, owner, sponsor/session:
Base revision and accepted contract version:
Changed paths and patch/commit identity:
Runnable fixture/check and expected result:
Observed result: PASS / FAIL / SKIP / NOT AVAILABLE:
Unmet acceptance and risk:
Dirty paths and running operations:
Committed / pushed / deployed status:
Next exact action and consumer:
Ownership released or retained, with acknowledgement:
```

A handoff passes after the consumer reproduces the agreed result. "Locally finished"
does not establish combined acceptance. Do not send seeds or raw sensitive logs.

## Conflict and transfer

Shared schemas have one writer, Gita. Root configuration and manifests have one writer,
Vedant. Route and database boundaries follow the profile. Unallocated paths need allocation.
Send a requested diff to the owner rather than editing their scope in parallel.
No stale timestamp, branch or Markdown file provides a distributed lock.
Contact the owner, inspect their state, then acknowledge release and transfer.
Preserve dirty work. Never reset or delete it to resolve a conflict.

## Evidence and authority

PASS means the check ran and passed. FAIL means it ran and failed. SKIP states why it
was omitted. NOT AVAILABLE states the missing tool, access or evidence. Record the
revision, environment, fixture/simulation/native mode and skipped/TODO counts.
No mock proves native validation. No submission proves settlement.

Check the authorization ledger before gated actions. No setup text grants installs,
commit, push, deployment, publication or stateful network submissions. Reuse a valid
scoped grant without asking again. Material changes reopen only the affected decision.

## Recovery and stopping

After interruption, read records and reconcile Git, claims, pending signed executions
and running operations. Do not release unresolved credit or blindly retry submissions.
Continue independent authorized work. On an explicit human pause, record the resumable
point and stop new work. Do not cancel another owner's process without authority.
