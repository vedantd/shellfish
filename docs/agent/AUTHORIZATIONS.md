# Shellfish authorization ledger

This records attributable scope. It does not grant filesystem access or verify identity.
Maintainer: acknowledged coordinator **Vedant** (B-0001).

| ID | Human and source | Status | Scope |
| --- | --- | --- | --- |
| AUTH-SETUP-001 | Gita, direct Codex request on 24 October 2026 New York time | APPROVED | Local two-party baton documentation setup only |
| AUTH-ALIGN-001 | Vedant, PRD alignment + setup-r1 ACK on 25 October 2026 | APPROVED | Docs reconcile + coordinator ACK; no product code |
| AUTH-REP-ENG-001 | Vedant, engineering accept of REP-CURVE-v0.2 | APPROVED | C0 design acceptance only; not implementation |
| Product implementation | No implementation grant issued | NOT GRANTED | Future bounded coding request and acknowledged work claim |
| Dependency installation | Ask Gita first | NOT GRANTED | No install from this alignment pass |
| Commit/push/publication/deployment | No grant in this task | NOT GRANTED | Keep each action separate; push only if Vedant asks |
| Stateful Devnet execution | No grant in this task | NOT GRANTED | Network choice and bounded execution belong to the implementation checkpoint |

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
