# Shellfish operating profile

- Revision: setup-r1, prepared at 2026-10-25 00:19 UTC.
- Sponsor: Gita. Setup editor: Codex in Gita's session.
- Adoption: documentation setup requested by Gita. Vedant coordinator acknowledgement pending.
- Hub: this Shellfish repository. Inspected branch: `main`.
- Inspected base: `5c31d618b82adf29db102161efbd7a888ef3c521`. Initial worktree was clean.
- Product reference: [PRD v1.1](../Shellfish_Agentic_Credit_Gateway_PRD_v1_1_Team_Allocation.pdf).
- PRD SHA-256: `1ee77372d9cc27a587055ccceb123e66177346e925523bc63355d86824d34787`.

## Outcome and authority

Build one controlled borrowing flow: evidence, two lender decisions, compatible offer,
exact authorization, atomic facility reservation, required signing, execution and receipt.
Target Devnet where supported. Labeled simulation is the agreed fallback.

| Role | Person | Scope and current evidence |
| --- | --- | --- |
| Sponsor and dependency approval | Gita | Direct setup request and supplied agent instructions |
| Tech lead | Vedant | Gita identified him as tech lead and author of the final spec |
| Coordinator and integration owner | Vedant, proposed | Acknowledge setup-r1 and name the shared claim channel before allocation |
| Credit/evidence engineer | Gita | PRD sections 11.4 to 11.4.2 |
| Execution engineer | Vedant | PRD's `You` role, mapped by Gita's identification |
| Product/policy reviewer | Nick | Policy matrix, expected decisions, narrative. No coding |
| Security reviewer | Shell | Signing assumptions and manual negative tests. No coding |
| Release operator | Not appointed | No commit, push, publication, or deployment grant in this setup |

The coordinator can allocate existing scope and integrate evidence. Material product or
trust-boundary changes need Gita and Vedant's recorded agreement. Nick and Shell provide
bounded review findings. They do not acquire implementation or release authority.
Routine in-scope decisions do not need repeated approval.

## Sources and current facts

Read `AGENTS.md`, this profile, the current baton and protocol, then the architecture,
accepted decisions, PRD, active code and tests. Product scope follows the final PRD.
The work board contains a proposed compressed 12-hour execution order, not a PRD rewrite.
Resolve a contract conflict explicitly. Chat suggestions are not accepted schema changes.

Observed scaffold: Zod contracts and fictional fixtures exist. Evidence, compatibility,
registry, authorization and XRPL core operations are mostly stubs. API routes return TODO
payloads. Tests contain fixture parsing, a rate conversion check and six security TODOs.
No `node_modules`, local `.env`, or database directory was present at inspection.
No test, build, database initialization, Devnet operation, or remote fetch ran during setup.

## Exclusive file scopes after acknowledged claims

The following allocation is proposed for adoption. All code remains unclaimed now.
Existing records are [Gita](work/SETUP-GITA.md) and [Vedant](work/SETUP-VEDANT.md).

| Scope | Sole writer | Consumer or review |
| --- | --- | --- |
| `packages/schemas/` except package manifests | Gita | Vedant accepts execution-related contracts before freeze |
| `packages/evidence/`, `packages/compatibility/`, `packages/registry/` except manifests | Gita | Vedant consumes their exports |
| `services/api/src/routes/gita.ts`, `services/api/src/db/`, `fixtures/` | Gita | Vedant requests fixture/schema changes through her |
| `tests/schemas.fixtures.test.ts`, new `tests/evidence.test.ts`, `tests/compatibility.test.ts`, `tests/registry.test.ts` | Gita | File names prefixed `new` here are planned, not present |
| `packages/authorization/`, `packages/xrpl/` except manifests | Vedant | Gita reviews shared contract/accounting effects |
| `apps/web/`, remaining `services/api/` except the Gita paths above | Vedant | `demo.ts` is Vedant's facade. Gita exports evidence update functions |
| `tests/invariants.placeholder.test.ts`, new `tests/authorization.test.ts`, `tests/xrpl.test.ts`, `tests/integration.test.ts` | Vedant | Replace TODOs with real checks without claiming unrun acceptance |
| All `package.json` files, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, root `tsconfig.base.json`, root `vitest.config.ts`, `.nvmrc`, `.gitignore`, `.env.example` | Vedant | Gita sends a diff request. Install approval remains separate |
| Root instructions, root README, central `docs/agent/*.md` | Acknowledged coordinator | Bootstrap editor may create this setup only |
| Each `docs/agent/work/SETUP-*.md` | Named owner | Coordinator records acknowledgement on the board |
| PRD, architecture changes, all other paths | Unallocated | Assign before editing. Preserve supplied PRD |

The package-manifest exception takes precedence over directory ownership.
Package `tsconfig.json` files follow their package owner. Vedant owns web/API config.
Do not rename existing `you.ts` or change executable code as part of setup.

## Claims across people and clones

Shared-checkout versus separate-clone mode is not yet confirmed. Treat cross-person
claims as requiring acknowledgement in one shared channel. Vedant names the team's
existing chat or repository PR as that channel at adoption. Do not create a new service.
Record a message permalink, PR comment, or sanitized attributable acknowledgement.
A local branch or file write alone does not establish an accepted claim.

Vedant allocates sequential `B-0001` IDs after adopting the setup. `SETUP-DRAFT` and
lane labels are temporary labels, not reserved baton IDs. Each claim records owner,
sponsor/session, base commit plus any uncommitted contract patch, scope revision,
contract version, acceptance and stop boundary. Do not start another owner's work.
No automatic expiry or takeover exists. Transfer requires release and acknowledgement.

The bootstrap exception permits this documentation draft. It does not make Codex
the coordinator, acknowledge Vedant's role, or authorize product implementation.

## Checks and permissions

These commands are defined in the inspected repository. Runtime checks have not run.

| Check | Existing command | Prerequisite and owner |
| --- | --- | --- |
| Documentation whitespace | `git diff --check` | No install. Setup editor or coordinator |
| Fixture/schema checks | `pnpm test -- tests/schemas.fixtures.test.ts` | Installed dependencies. Gita |
| Current test suite | `pnpm test` | Installed dependencies. Both engineers inspect TODO/skipped counts |
| Type checks | `pnpm typecheck` | Dependencies and required workspace builds. Both engineers |
| Workspace build | `pnpm build` | Installed dependencies. Vedant integrates |
| Local SQLite initialization | `pnpm db:init` | Writes configured DB. Not run or authorized by setup |
| API/web development | `pnpm dev` | Dependencies and explicit implementation scope. Vedant |

Use repository-pinned `pnpm@9.15.0` after installation authority is established.
No dependency installation is needed for these Markdown records. Missing dependencies
leave application checks NOT AVAILABLE without blocking documentation setup.

Secrets belong in ignored local storage chosen for implementation, never in these
records. `.env` is ignored. No secret values were read or configured during setup.
Read-only checks and local scoped edits follow the active task. Install, commit,
push, publication, deployment, destructive work and stateful Devnet submissions
need their own grant. See [authorization ledger](AUTHORIZATIONS.md).

## Checkpoint and release

Vedant integrates only reviewed diffs against their accepted base. Run affected combined
checks once after integration. Standalone passing modules do not prove the complete flow.
Keep local, mocked, simulated, native validated, committed, pushed and deployed states separate.
Archive actual outcomes under `docs/agent/history/` when a checkpoint ends. Create that
directory only for real evidence. Preserve unfinished acceptance on the work board.
Setup stops at verified local documentation. There is no implementation or release in this task.
