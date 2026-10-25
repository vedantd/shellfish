# Shellfish authorization ledger

This records attributable scope. It does not grant filesystem access or verify identity.
Maintainer: acknowledged coordinator **Vedant** (B-0001).

| ID | Human and source | Status | Scope |
| --- | --- | --- | --- |
| AUTH-SETUP-001 | Gita, direct Codex request on 24 October 2026 New York time | APPROVED | Local two-party baton documentation setup only |
| AUTH-ALIGN-001 | Vedant, PRD alignment + setup-r1 ACK on 25 October 2026 | APPROVED | Docs reconcile + coordinator ACK; no product code |
| AUTH-REP-ENG-001 | Vedant, engineering accept of REP-CURVE-v0.2 | APPROVED | C0 design acceptance only; not implementation |
| AUTH-GITA-HANDOFF-001 | Gita, producer delivery 2026-10-25 | APPROVED | Producer implementation + handoff records |
| AUTH-C0-CONSUMER-001 | Vedant, C0-REP-1 consumer ACK 2026-10-25 | APPROVED | Accept C0 package; allocate B-0002; baton docs only |
| Product implementation (B-0002 code) | Claimed for Vedant on B-0002 | APPROVED (bounded) | Auth/XRPL/API/UI wiring to accepted C0; no Gita path edits |
| B-0002 LIVE product wiring (PR #5) | Vedant, Cursor session 2026-10-25 | APPROVED (bounded) | LIVE adapter/API/UI + baton/board update; mocked tests only |
| Dependency installation | Gita-locked pins already on main | SUPERSEDED for verify | Consumer used Node 24.21 / pnpm 9.15 against existing lockfile |
| Commit/push of this ACK | Vedant request to record baton | APPROVED when Vedant pushes | Baton/board/ledger/SETUP-VEDANT only unless separately asked |
| AUTH-GITA-CENTRAL-SYNC-002 | Gita, direct Codex request on 25 October 2026 | APPROVED (bounded) | Sync current baton, board, own work record and this grant to verified delivery and UI/backend dependencies |
| AUTH-DEVNET-001 | Vedant, Cursor 2026-10-25 11:54 UTC | APPROVED (bounded) | Stateful XRPL Devnet submit for B-0002 LIVE smoke |

The setup-pass absence of a grant below is historical. AUTH-GITA-HANDOFF-001
records Gita's later direct implementation and delivery authority for this checkpoint.

NOT GRANTED describes the absence of a grant, not a historical rejection.
For actual approvals use APPROVED, PROPOSED, REJECTED, REVOKED, SUPERSEDED or EXPIRED.

## AUTH-SETUP-001

- Requester and approver: Gita, repository setup sponsor.
- Source: direct user instruction in the Codex session for XRP Hackathon, 24 October 2026.
- Request: "can you setup the two party ... baton-protocol ... for Vedant and me in the shellfish repository".
- Subject: setup-r1 for this repository, based on the final PRD and inspected scaffold.
- Allowed: inspect local Git and source, add `AGENTS.md` and the seven agent records,
  append a root README pointer, and run documentation checks.
- File scope: `AGENTS.md`, `README.md`, `docs/agent/PROJECT-PROFILE.md`,
  `docs/agent/BATON-PROTOCOL.md`, `docs/agent/CURRENT-BATON.md`,
  `docs/agent/WORK-BOARD.md`, `docs/agent/AUTHORIZATIONS.md`,
  `docs/agent/work/SETUP-GITA.md`, `docs/agent/work/SETUP-VEDANT.md`.
- Excludes application changes, fixtures, dependency installation, keys, database writes,
  product implementation, commit, push, publication, deployment and Devnet submissions.
- Stop: verified local setup and handoff. Completed by Gita's session; adoption by Vedant is AUTH-ALIGN-001.

## AUTH-ALIGN-001

- Requester and approver: Vedant (tech lead / coordinator).
- Source: Cursor session, PRD vs baton alignment plan execute, 25 October 2026 UTC.
- Allowed: record PRD alignment evidence; ACK setup-r1; allocate B-0001; set claim channel
  to GitHub PR comments and clone mode to separate; reconcile ownership and
  reserve-before-ALLOW wording in scaffold docs (`HOW_TO_BUILD`, architecture, schemas/
  authorization/api READMEs, root README, AGENTS, fixtures README C0 pointers).
- Excludes: fixture JSON / Zod field changes, package implementation, dependency install,
  Devnet, and push unless separately requested.
- Stop: docs aligned; next action is Gita’s C0 fixture publish for Vedant accept.

Platform permission to write is separate from this ledger.
Reuse later explicit grants within their exact scope. Do not reopen unchanged covered
approvals or treat a proposal, preselected choice, silence or agent claim as consent.

## AUTH-REP-MATH-001

- Status: APPROVED for policy documentation and this scoped handoff.
- Approver: Gita directly. Nick's mathematical-policy approval is confirmed by Gita.
- Recorded: 2026-10-25 03:09 UTC.
- Source: direct user request in Assess XLS-0066 creditworthiness, 24 October 2026.
- Approved subject: REP-CURVE-v0.2 as specified in [the decision record](../decisions/REP-CURVE-v0.2.md).
- Requested actions: save mathematical-model.md, include the simulation HTML, append XRP/XRPL pseudocode and amendment requirements, record approval, and inform Vedant's agent baton.
- Authorized paths: root mathematical-model.md, docs/simulations/rep-exposure-curve.html,
  docs/simulations/rep-exposure-curve.fragment.html, docs/decisions/REP-CURVE-v0.2.md,
  the incoming notice in CURRENT-BATON.md, this ledger entry and Gita's work-record handoff.
- Central-record exception: this direct human instruction permits the narrow incoming
  notice and approval entry. It does not transfer coordinator ownership.
- Excludes product implementation, schema/fixture changes, installs, native transactions,
  database writes, commits, pushes and deployment.
- Engineering acceptance: completed separately as AUTH-REP-ENG-001 (C0 design only).
  Product math approval and engineering acceptance remain separate facts.
- Nick attribution: approval reported by Gita. No direct Nick message or signature invented.
- Stop: verified local files and durable baton notice. No remote delivery is implied.

## AUTH-REP-ENG-001

- Status: APPROVED for C0 engineering acceptance of REP-CURVE-v0.2.
- Approver: Vedant (tech lead / coordinator), 2026-10-25 03:35 UTC.
- Source: Vedant reviewed `mathematical-model.md` and `docs/decisions/REP-CURVE-v0.2.md`
  after Gita's `cf601b4` pull; instructed Cursor to record acceptance.
- Meaning: C0 contracts and future implementation **will follow** REP-CURVE-v0.2.
  Reserve facility + REP before ALLOW; validated REP redemption before LoanSet signature;
  no AMM or consensus work.
- Allowed paths: `docs/agent/CURRENT-BATON.md`, `docs/agent/WORK-BOARD.md`,
  `docs/agent/AUTHORIZATIONS.md`, `docs/decisions/REP-CURVE-v0.2.md`,
  `docs/agent/work/SETUP-VEDANT.md`, and a GitHub PR for attributable claim-channel notice.
- Excludes: product package/fixture implementation, dependency install, Devnet, deployment.
- Stop: acceptance recorded; Gita still publishes C0 fixtures including REP fields.

## AUTH-GITA-HANDOFF-001

- Status: APPROVED. Sponsor: Gita, direct instructions in this Codex chat on 2026-10-25 10:45 UTC.
- Source: Gita requested verification against the baton, pause at the Vedant dependency,
  commit and push, then a WhatsApp draft for her to send. She explicitly requested updates
  to both contributors' batons reflecting completed work, decisions and dependencies.
- Authorized delivery: the reviewed Gita producer implementation, C0 fixtures/contracts,
  previously approved runtime/SDK pins and the narrow handoff records to existing origin/main.
- Narrow central-record exception: CURRENT-BATON, WORK-BOARD and this grant entry may
  record producer evidence and pending dependencies. SETUP-VEDANT receives an incoming
  consumer handoff. No coordinator takeover, new baton ID or Vedant ACK is granted
  by this entry alone (consumer ACK is AUTH-C0-CONSUMER-001).
- Earlier implementation/install approvals are scoped to Gita's direct coding request,
  locked dependencies, Node 24/SQLite 12.10.1 test and requested XRPL.js stable update.
- Excludes new native transactions, deployment, force-push, unrelated work, new installs
  and sending WhatsApp. The requested message is a draft for Gita.
- Stop: verify delivery, report actual commit/remote ref and pause pending Vedant feedback.

This later direct grant supersedes the initial setup-only absence of delivery authority
for this exact checkpoint. It does not create standing release or installation authority.

## AUTH-C0-CONSUMER-001

- Status: APPROVED for C0-REP-1 consumer acceptance and B-0002 allocation.
- Approver: Vedant (tech lead / coordinator), 2026-10-25 11:07 UTC.
- Source: Vedant pulled Gita's `08397b5` handoff; instructed Cursor to verify and record baton ACK.
- Reproduced: `pnpm build` PASS, `pnpm typecheck` PASS, `pnpm test` 128 PASS / 6 todo,
  `node --test fixtures/xrpl-poc-replay/{replay,native-helpers}.test.mjs` 37 PASS.
- Accepted: C0-REP-1 fixtures/schemas/registry/evidence/compatibility/Gita routes for
  first integration in **`SIMULATED_LOAN`**. SDK pin xrpl **5.3.0**, Node **24.21.0**.
- Allocated: **B-0002** — Vedant authorization, XRPL adapter, API bootstrap injection,
  receipts/UI against Gita exports. Preserve reserve-before-ALLOW and stake-before-LoanSet.
- Allowed paths for this ACK record: `docs/agent/CURRENT-BATON.md`, `WORK-BOARD.md`,
  `AUTHORIZATIONS.md`, `docs/agent/work/SETUP-VEDANT.md`, and a GitHub PR comment/PR for
  the claim channel.
- Excludes: editing Gita package sources, LIVE_DEVNET submission, deployment, force-push.
- Does not mark LIVE_DEVNET ready until `fixtures/network-signing-contract.json` is filled
  and separately accepted.
- Stop: acceptance on baton; Vedant proceeds with B-0002 implementation in his scopes.

## AUTH-DEVNET-001

- Status: **APPROVED** for bounded stateful XRPL Devnet execution (B-0002 LIVE smoke).
- Approver: Vedant (tech lead / coordinator), 2026-10-25 11:54 UTC.
- Source: Vedant instructed Cursor to grant stateful Devnet execution after PR #5 merge.
- Allowed: connect to XRPL Devnet; use local env seeds (never commit); submit REP redeem /
  LoanSet / LoanPay for product LIVE smoke; record PASS/FAIL/SKIP + real public hashes on
  baton/SETUP-VEDANT; update board evidence rows.
- Allowed paths for this grant record: `docs/agent/AUTHORIZATIONS.md`,
  `docs/agent/CURRENT-BATON.md`, `docs/agent/WORK-BOARD.md`,
  `docs/agent/work/SETUP-VEDANT.md`.
- Runtime: `NETWORK_MODE=LIVE_DEVNET` with env from `services/api/.env.live.example`
  (seeds local-only). Prefer reuse of playground / Gita native E2E public identifiers.
- Excludes: Mainnet; committing seeds or private keys; force-push; deployment; flipping
  `fixtures/network-signing-contract.json` `native_ready` without Gita schema allocation;
  editing Gita package sources; inventing synthetic live hashes.
- Stop: smoke recorded; next is env fill + LIVE run, then optional Gita schema request.

## AUTH-GITA-CENTRAL-SYNC-002

- Status: APPROVED for the requested central status and dependency sync.
- Approver/source: Gita's direct request, "update the central baton, and tell me what to do next to finish out the backend so that the UI can start".
- Recorded: 2026-10-25 08:30 America/New_York (12:30 UTC).
- Allowed: CURRENT-BATON, WORK-BOARD, Gita's own work record and this attributable grant. Record delivered code `9fad690`, actual checks and the next UI/backend dependency plan.
- Narrow central-record exception only. Vedant remains coordinator. No new implementation baton ID, coding claim, native success or Vedant consumer ACK is invented.
- Earlier direct instruction, "so just do that in the main codebase", authorized the tested eight-file consumer binding repair delivered in `9fad690`.
- Excludes application changes, dependency installation, new stateful network execution and deployment in this documentation sync.
- Delivery follows Gita's standing request to commit and push the finished handoff. Preserve unknown changes and verify the remote ref.

## AUTH-GITA-UI-PERSIST-003

- Source: Gita directly requested SQLite storage, API implementation, the joined credit view and an OpenAPI source of truth for the frontend.
- Allowed: existing SQLite DB helpers/schema, API bootstrap/context/read routes and atomic authorization storage, focused regression fixtures, OpenAPI JSON/generator/checks and frontend API guide. Central record sync remains AUTH-GITA-CENTRAL-SYNC-002.
- This extends the earlier direct application repair grant to the necessary persistence/API files. Vedant remains coordinator and owns remaining execution/UI integration.
- Excludes dependency installation, secret ingestion, new stateful ledger submissions, deployment, invented underwriting or native verification claims.
- Deliver the reviewed changes, validation and dependency handoff through the existing commit/push workflow.
