# Shellfish authorization ledger

This records attributable scope. It does not grant filesystem access or verify identity.
Maintainer: acknowledged coordinator **Vedant** (B-0001).

| ID | Human and source | Status | Scope |
| --- | --- | --- | --- |
| AUTH-SETUP-001 | Gita, direct Codex request on 24 October 2026 New York time | APPROVED | Local two-party baton documentation setup only |
| AUTH-ALIGN-001 | Vedant, PRD alignment + setup-r1 ACK on 25 October 2026 | APPROVED | Docs reconcile + coordinator ACK; no product code |
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
