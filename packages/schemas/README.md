# `@shellfish/schemas`

**Owner:** Shared (both engineers)

Zod contracts for mandate, evidence, offer, receipt, and denial codes. **Everything else depends on this.**

## What this module is for

Single source of truth for payload shapes. If a field is not here, do not invent it in another package.

## Build steps

1. Keep `EvidencePassport`, `BorrowingMandate`, `LenderFacilityOffer`, `AuthorizationReceipt` aligned with PRD §6.
2. Keep `DenialCode` aligned with PRD §9.1 (`DENY_AMOUNT`, `DENY_RATE`, `DENY_REPLAY`, …).
3. Add new fields only when both You and Gita agree (Hour 0–3 freeze, then only with a short note in the PR).
4. Export types + Zod parsers; other packages call `.parse()` at API boundaries.
5. Run `pnpm --filter @shellfish/schemas build` after changes so dependents see updated `dist/`.

## Done when

- `pnpm test` fixture schema tests pass against `fixtures/*.json`.
- No other package defines duplicate mandate/evidence/offer types.
