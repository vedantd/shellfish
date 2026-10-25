# How to build Shellfish (module steps)

This is the working guide for the two coding engineers. Each module README repeats the same checklist in place.

Ownership and claims follow [AGENTS.md](../AGENTS.md) and [docs/agent/PROJECT-PROFILE.md](agent/PROJECT-PROFILE.md). Current objective: [B-0001](agent/CURRENT-BATON.md).

**Flow to implement (happy path):**

```
1. schemas     → Gita freezes shapes; Vedant accepts
2. fixtures    → seed HarborSupply / Lender A+B
3. evidence    → passport API
4. compatibility → lender evaluate + Nick match
5. registry    → facility reserve/release
6. authorization → verify + reserve then ALLOW/DENY
7. xrpl        → LoanSet / LoanPay (or labeled sim); originate consumes reservation
8. api         → wire routes in order
9. web         → three screens + one denial
```

| Package | Owner | Start here |
|---------|-------|------------|
| [`packages/schemas`](../packages/schemas/README.md) | **Gita** (Vedant accepts before freeze) | Sole writer; no parallel schema edits |
| [`fixtures`](../fixtures/README.md) | Gita | Seed data both sides use |
| [`packages/evidence`](../packages/evidence/README.md) | Gita | FR-03 |
| [`packages/compatibility`](../packages/compatibility/README.md) | Gita | FR-04–06 |
| [`packages/registry`](../packages/registry/README.md) | Gita | FR-08 |
| [`packages/authorization`](../packages/authorization/README.md) | Vedant | FR-02, FR-07; reserve before ALLOW |
| [`packages/xrpl`](../packages/xrpl/README.md) | Vedant | FR-09–10, FR-13 |
| [`services/api`](../services/api/README.md) | Vedant (+ mount Gita) | Wire HTTP |
| [`apps/web`](../apps/web/README.md) | Vedant | Screens A/B/C |

**Orchestration rule**

`authorizeExactAction` calls `reserveFacility` and only then returns **ALLOW**.
`POST /v1/loans/originate` **consumes** that reservation — it does not reserve again.

**Rules both of you follow**

1. Import types only from `@shellfish/schemas` — no ad-hoc JSON field names.
2. Use `fixtures/` until the other person’s API is ready.
3. Denial codes must be the enum in schemas (`DENY_AMOUNT`, `DENY_RATE`, …).
4. Never invent a fake `tx_hash` and call it on-chain.
5. Agent never holds unrestricted borrower/broker master keys.
6. C0 must use one `AssetRef` (currency + issuer) everywhere and an evidence observation period for Lender B’s 12-month rule (not implemented yet — see work board).
