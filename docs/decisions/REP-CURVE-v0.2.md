# REP-CURVE-v0.2 approved reputation bond policy

- Status: APPROVED, mathematical and product policy.
- Approvers: Nick and Gita, as confirmed by Gita.
- Approval attribution: Gita directly requested this approval record. Nick's approval is reported through Gita, not a separately observed signature.
- Recorded: 2026-10-25 03:09 UTC, 2026-10-24 23:09 New York.
- Canonical model: [mathematical-model.md](../../mathematical-model.md).
- Related coordination: [B-0001](../agent/CURRENT-BATON.md).
- Engineering acceptance: C0 contract acceptance and implementation claims remain with Vedant and the two named lane owners.
- Implementation status: not implemented by this documentation change.

## Decision

Use a convex borrower-exposure curve C(E) = 0.2E + 0.00004E squared.
Each new loan commits the exact incremental bond C(E + P) minus C(E).
Reserve active plus pending exposure atomically across participating lenders.

Freeze each quoted bond until full repayment. Default forfeits that original bond
and suspends new borrowing pending review. Partial principal repayment changes
exposure and reward accrual, but does not release part of the bond.

Appreciation uses base principal-time exposure at 1% per 30 days.
It does not reward the convex leverage surcharge. Keep the 20 REP rolling reward
budget, 1,200 REP maximum and six-decimal integer accounting.

## Rejected options

- AMM pricing: does not implement principal-specific debt accounting and conflicts with nontransferable REP.
- Transaction-count penalties: punish completed borrowing and invite splitting.
- Repricing active bonds: adds cross-loan reallocation and issuer transactions.
- Rewarding the full convex bond: rewards higher leverage.
- Zero principal as repayment proof: native default can zero principal too.

## Scope and authority

This approves the equations, parameters, fixed-bond lifecycle, simulation and agent
pseudocode. It does not authorize dependency installation, product implementation,
native submissions, commits, pushes or deployment. It does not replace lender
underwriting or claim financial collateral value.

Gita's instruction was: "confirm the algorithm as a approved decision from Nick and
Gita and inform Vedant's agent baton about this". The source is the direct user
request in the Codex chat Assess XLS-0066 creditworthiness on 24 October 2026.

The same request explicitly authorizes the model files and an incoming notice to
the coordinator baton. This is a narrow human-directed notice, not a transfer of
coordinator ownership or authority to allocate another baton ID.

## Handoff and validation

Gita owns application policy, contracts and registry. Vedant owns the required
signer and native adapter. No XRPL consensus or AMM workstream is added.

The canonical model contains pseudocode, units, native transaction mapping,
amendment observations and acceptance cases. The simulation is an explanatory
fresh-portfolio view, not production accounting. Native acceptance remains open.
