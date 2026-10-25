# How to build Shellfish (module steps)

This is the working guide for the two coding engineers. Each module README repeats the same checklist in place.

**Flow to implement (happy path):**

```
1. schemas     → freeze shapes
2. fixtures    → seed HarborSupply / Lender A+B
3. evidence    → passport API
4. compatibility → lender evaluate + Nick match
5. registry    → facility reserve/release
6. authorization → mandate verify + ALLOW/DENY
7. xrpl        → LoanSet / LoanPay (or labeled sim)
8. api         → wire routes in order
9. web         → three screens + one denial
```

| Package | Owner | Start here |
|---------|-------|------------|
| [`packages/schemas`](../packages/schemas/README.md) | Shared | Do not change fields without both engineers agreeing |
| [`fixtures`](../fixtures/README.md) | Gita | Seed data both sides use |
| [`packages/evidence`](../packages/evidence/README.md) | Gita | FR-03 |
| [`packages/compatibility`](../packages/compatibility/README.md) | Gita | FR-04–06 |
| [`packages/registry`](../packages/registry/README.md) | Gita | FR-08 |
| [`packages/authorization`](../packages/authorization/README.md) | You | FR-02, FR-07 |
| [`packages/xrpl`](../packages/xrpl/README.md) | You | FR-09–10, FR-13 |
| [`services/api`](../services/api/README.md) | You (+ mount Gita) | Wire HTTP |
| [`apps/web`](../apps/web/README.md) | You | Screens A/B/C |

**Rules both of you follow**

1. Import types only from `@shellfish/schemas` — no ad-hoc JSON field names.
2. Use `fixtures/` until the other person’s API is ready.
3. Denial codes must be the enum in schemas (`DENY_AMOUNT`, `DENY_RATE`, …).
4. Never invent a fake `tx_hash` and call it on-chain.
5. Agent never holds unrestricted borrower/broker master keys.
