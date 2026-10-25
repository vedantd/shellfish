# Shellfish operating profile

- Revision: setup-r1, **adopted** 2026-10-25 00:41 UTC by Vedant.
- Sponsor: Gita. Setup editor: Codex in Gita's session; adoption by Vedant.
- Adoption: coordinator acknowledgement recorded on [CURRENT-BATON](CURRENT-BATON.md) (B-0001).
- Hub: this Shellfish repository. Branch: `main`.
- Accepted base: `7fbcfc718b5f7d8b9cb63ebd3f1f6eb9787486b8`.
- Product reference: [PRD v1.1](../Shellfish_Agentic_Credit_Gateway_PRD_v1_1_Team_Allocation.pdf).
- PRD SHA-256: `1ee77372d9cc27a587055ccceb123e66177346e925523bc63355d86824d34787`.
- Claim channel: **GitHub PR comments** on `vedantd/shellfish`.
- Clone mode: **separate clones**.

## Outcome and authority

Build one controlled borrowing flow: evidence, two lender decisions, compatible offer,
exact authorization, atomic facility reservation, required signing, execution and receipt.
Target Devnet where supported. Labeled simulation is the agreed fallback.

| Role | Person | Scope and current evidence |
| --- | --- | --- |
| Sponsor and dependency approval | Gita | Direct setup request and supplied agent instructions |
| Tech lead | Vedant | Author of the final spec; acknowledged coordinator |
| Coordinator and integration owner | **Vedant, acknowledged** | B-0001; allocates IDs and integrates reviewed diffs |
| Credit/evidence engineer | Gita | PRD sections 11.4 to 11.4.2; lane READY |
| Execution engineer | Vedant | PRD's `You` role; lane READY |
| Product/policy reviewer | Nick | Policy matrix, expected decisions, narrative. No coding |
| Security reviewer | Shell | Signing assumptions and manual negative tests. No coding |
| Release operator | Not appointed | No blanket commit/push/deploy grant; ask per action |

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
PRD alignment audit (2026-10-25): product thesis PASS; scaffold ownership/reserve docs
reconciled; fixture AssetRef + observation period still FAIL pending C0.

## Exclusive file scopes after acknowledged claims

Allocation **adopted**. Code lanes remain unclaimed until each owner starts a bounded slice.
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
| Root instructions, root README, central `docs/agent/*.md` | Acknowledged coordinator | Vedant |
| Each `docs/agent/work/SETUP-*.md` | Named owner | Coordinator records acknowledgement on the board |
| PRD binary | Unallocated preserve | Do not rewrite the supplied PDF |
| `docs/architecture.md`, `docs/HOW_TO_BUILD.md` | Coordinator | Keep aligned with profile |

The package-manifest exception takes precedence over directory ownership.
Package `tsconfig.json` files follow their package owner. Vedant owns web/API config.
Do not rename existing `you.ts` without an explicit allocation.

## Claims across people and clones

**Confirmed:** separate-clone mode. Cross-person claims require acknowledgement in
**GitHub PR comments** on `vedantd/shellfish`. Record a PR comment permalink or
sanitized attributable acknowledgement. A local branch or file write alone does not
establish an accepted claim.

Baton **B-0001** is the current coordinating objective. Further sequential IDs
(`B-0002`…) are allocated by Vedant when a lane claims implementation work.
Each claim records owner, sponsor/session, base commit plus any uncommitted contract
patch, scope revision, contract version, acceptance and stop boundary.
No automatic expiry or takeover exists. Transfer requires release and acknowledgement.

## Checks and permissions

These commands are defined in the inspected repository. Runtime checks have not run
for product acceptance in this adoption pass.

| Check | Existing command | Prerequisite and owner |
| --- | --- | --- |
| Documentation whitespace | `git diff --check` | No install. Coordinator |
| Fixture/schema checks | `pnpm test -- tests/schemas.fixtures.test.ts` | Installed dependencies. Gita |
| Current test suite | `pnpm test` | Installed dependencies. Both engineers inspect TODO/skipped counts |
| Type checks | `pnpm typecheck` | Dependencies and required workspace builds. Both engineers |
| Workspace build | `pnpm build` | Installed dependencies. Vedant integrates |
| Local SQLite initialization | `pnpm db:init` | Writes configured DB. Needs explicit grant when first used |
| API/web development | `pnpm dev` | Dependencies and explicit implementation scope. Vedant |

Use repository-pinned `pnpm@9.15.0` after installation authority is established.
Ask Gita before dependency installation. Secrets belong in ignored local storage.
Read [authorization ledger](AUTHORIZATIONS.md) before install, commit, push, deploy,
or stateful Devnet work.

## Checkpoint and release

Vedant integrates only reviewed diffs against their accepted base. Run affected combined
checks once after integration. Standalone passing modules do not prove the complete flow.
Keep local, mocked, simulated, native validated, committed, pushed and deployed states separate.
Archive actual outcomes under `docs/agent/history/` when a checkpoint ends. Create that
directory only for real evidence. Preserve unfinished acceptance on the work board.
Adoption does not grant product implementation or release.
