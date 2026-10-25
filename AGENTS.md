# Shellfish contributor instructions

Shellfish is an Agentic Credit Gateway. Read the repository records before editing.
The scaffold's owner label `You` means **Vedant**, the tech lead. Gita is the other engineer.
Nick owns product and policy review. Shell owns security review and manual QA.
Neither Nick nor Shell has an implementation assignment.

## Read first

1. Inspect `git status --short --branch` and preserve unknown changes.
2. Read [project profile](docs/agent/PROJECT-PROFILE.md).
3. Read [current baton](docs/agent/CURRENT-BATON.md) and [protocol](docs/agent/BATON-PROTOCOL.md).
4. Read your scoped record on the [work board](docs/agent/WORK-BOARD.md).
5. Read [architecture](docs/architecture.md), the linked PRD, and relevant code/tests.
6. Check [authorizations](docs/agent/AUTHORIZATIONS.md) for any gated action.

The current setup is READY and unclaimed. Vedant is the proposed coordinator.
His acknowledgement adopts the allocation and claim channel. Setup does not start product coding.

## Two person ownership

- Gita owns schemas, evidence, lender adapters, compatibility, registry, fixtures,
  Gita routes, database schema/init, and the named tests in the profile.
- Vedant owns authorization, XRPL, orchestration, receipts, web, root configuration,
  dependency manifests/lockfile, and the named tests in the profile.
- Only the acknowledged coordinator edits the central baton, profile, protocol,
  board, authorization ledger, root instructions, and root README.
- Each contributor edits their own work record. A transfer needs acknowledgement.
- Root `package.json`, all package manifests, `pnpm-lock.yaml`, and shared entrypoints
  have one owner, Vedant. Gita sends a requested diff for these files.
- Unlisted or overlapping paths need an allocation. Do not infer ownership from proximity.

Use the exact scopes in the profile. Read access does not grant another owner's write scope.
A branch, local Markdown edit, or stale timestamp is not a cross-clone lock.
Record the accepted base revision, contract version, owner, and claim receipt before implementation.

## Working rules

- Build one bounded usable slice and run checks for its actual risks.
- Use independent agents for substantial separate work with explicit scopes.
  Keep small or dependent edits with one owner.
- Show substantive changes as a focused diff. Preserve human edits and current code.
- Ask Gita before dependency, package, CLI, or system-tool installation.
  Name the missing item, exact command/version, need, work unlocked, and fallback.
  Existing manifests and README setup commands are not install approval.
- Commit, push, deployment, publication, destructive cleanup, and stateful network
  execution need their own applicable authority. Read the ledger first.
- Keep keys and raw sensitive payloads out of logs, fixtures, receipts, and batons.
- Record PASS, FAIL, SKIP, or NOT AVAILABLE with revision and environment.
  Placeholder tests, fixture parses, ALLOW, and submission do not prove native lending.
- Return changed paths, checks, remaining gaps, release state, and one exact next action.

## Product constraints

Participating lenders own underwriting. A principal remains accountable for the agent.
Known exposure covers participating sources only. A required signer must enforce the
exact approved transaction. Atomic reservation precedes signing. Unresolved execution
retains capacity. Default or write-off never restores credit automatically.

Keep simulation explicit. No synthetic transaction hash is a live receipt.
Micro-bond trading, universal scoring, production custody/KYC, and new liquidity pools
are outside the agreed MVP. Do not start them through a baton update.
