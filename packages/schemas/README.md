# `@shellfish/schemas`

**Owner:** Gita (sole writer). **Vedant** accepts execution-related contracts before freeze.

Zod contracts for mandate, evidence, offer, receipt, and denial codes. **Everything else depends on this.**

## What this module is for

Single source of truth for payload shapes. If a field is not here, do not invent it in another package. Vedant sends a requested diff; he does not edit this tree in parallel.

## Build steps

1. Keep `EvidencePassport`, `BorrowingMandate`, `LenderFacilityOffer`, `AuthorizationReceipt` aligned with PRD §6 and the accepted C0 example.
2. Keep `DenialCode` aligned with PRD §9.1 (`DENY_AMOUNT`, `DENY_RATE`, `DENY_REPLAY`, …).
3. **C0-REP-1 implemented for review:** shared `AssetRef` supports currency/issuer, XRP and MPT issuance IDs. Evidence has observation dates and accepted history months. REP consent, exact-unit snapshots, reservation and synthetic outcome vectors live in `src/c0.ts`.
4. Export types + Zod parsers; other packages call `.parse()` at API boundaries.
5. Run `pnpm --filter @shellfish/schemas build` after changes so dependents see updated `dist/`.

## Done when

- `pnpm test` fixture schema tests pass against `fixtures/*.json`.
- No other package defines duplicate mandate/evidence/offer types.
- Vedant has accepted the C0 contract version in the claim channel (GitHub PR comments).

Current fixture status: review pending. See [`fixtures/README.md`](../../fixtures/README.md).
The native signing/network/schedule contract remains open. Schema parses and fixture
arithmetic do not prove runtime reservation, signature or XRPL execution behavior.

`src/credit.ts` adds `CreditStatus`, `CreditQuoteRequest` and `CreditQuote` for the
registry read API. All amounts are exact integer strings. Status binds context, asset,
facility, aggregate portfolio, scales and observation time. Quotes include exposure
and facility versions, the bond, each failed registry limit and a content hash.
`grants_permission` is always false and `reservation_required` is always true.
These read contracts are local additions for consumer review. They do not change the
accepted REP math, signed passports, offer terms or authorization contract.
