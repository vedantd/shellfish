# `@shellfish/schemas`

**Owner:** Gita (sole writer). **Vedant** accepts execution-related contracts before freeze.

Zod contracts for mandate, evidence, offer, receipt, and denial codes. **Everything else depends on this.**

## What this module is for

Single source of truth for payload shapes. If a field is not here, do not invent it in another package. Vedant sends a requested diff; he does not edit this tree in parallel.

## Build steps

1. Keep `EvidencePassport`, `BorrowingMandate`, `LenderFacilityOffer`, `AuthorizationReceipt` aligned with PRD §6 and the accepted C0 example.
2. Keep `DenialCode` aligned with PRD §9.1 (`DENY_AMOUNT`, `DENY_RATE`, `DENY_REPLAY`, …).
3. **C0 required (not done yet):** one `AssetRef` `{ currency, issuer }` on mandate, offer, and evidence exposure; add observation period or history months for Lender B’s ≥12 month rule.
4. Export types + Zod parsers; other packages call `.parse()` at API boundaries.
5. Run `pnpm --filter @shellfish/schemas build` after changes so dependents see updated `dist/`.

## Done when

- `pnpm test` fixture schema tests pass against `fixtures/*.json`.
- No other package defines duplicate mandate/evidence/offer types.
- Vedant has accepted the C0 contract version in the claim channel (GitHub PR comments).
