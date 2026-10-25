# Architecture (scaffold)

Shellfish is an interoperability and authorization layer around XRPL lending primitives (XLS-65/66). It does **not** replace lender underwriting or XRPL consensus.

## Control flow

```
Principal + agent
  → signed mandate + credit intent
Gita evidence
  → versioned passport / known exposure
Lender A / Lender B adapters
  → approve or decline (lender-owned)
Nick compatibility
  → bounded permitted envelope
Shellfish authorization
  → ALLOW/DENY + facility reservation
Controlled signer
  → exact approved LoanSet bytes
XRPL adapter
  → submitAndWait / reconcile
Receipts + exposure registry
```

## Packages

| Package | Owner | Role |
|---------|-------|------|
| `@shellfish/schemas` | Shared | Zod contracts (mandate, evidence, offer, receipt) |
| `@shellfish/authorization` | You | Mandate verify + policy gate |
| `@shellfish/xrpl` | You | LoanSet / LoanPay adapter |
| `@shellfish/evidence` | Gita | Passport + known-exposure |
| `@shellfish/compatibility` | Gita | Nick matcher + lender policies |
| `@shellfish/registry` | Gita | Facilities / reservations |

## Network modes

- `LIVE_DEVNET` — real LoanSet validation and Loan ID
- `SIMULATED_LOAN` — labeled simulation; never present as on-chain lending

See the PRD in this folder for the full build contract.

For per-module implementation steps, see [`HOW_TO_BUILD.md`](HOW_TO_BUILD.md).
