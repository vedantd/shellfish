# `@shellfish/compatibility`

**Owner:** Gita

Two bounded lender adapters and an exact firm-offer matcher for C0-REP-1.

## What this module handles

- The same accepted evidence produces Lender A approval and Lender B decline.
- Lender A approval is seeded and bound to borrower, evidence hash/version, asset and context.
- Lender B requires twelve accepted history months. Meeting that rule alone creates no offer.
- Matching preserves each firm's quoted amount, nominal annual rate, fee and schedule.
- Currency issuers and MPT issuance IDs form part of exact asset identity.

## Build steps

### Lender adapters

Construct `createCompatibilityService({ approvedOffers, hash, now })`.
Each approved entry is `{ offer, evidenceHash, evidenceVersion }`.
`hash` is the canonical content hasher supplied by the API. The clock is explicit.

```ts
const credit = createCompatibilityService({
  approvedOffers: [{ offer, evidenceHash: passport.evidence_hash,
    evidenceVersion: passport.evidence_version }],
  hash: contentHash,
  now: () => fixtureClock,
});
const result = await credit.evaluateLender("lender-A", passport);
```

Unknown borrowers, changed evidence and missing seeded approvals return a decline.
Expired offers and stale or altered evidence return their exact reason code.
This demo does not define a generalized Lender A scoring model.

### Nick match

Use `matchOffers({ mandate, offers, evidence? })` on the service.
Pass evidence from the evidence service to check its identity and freshness here.
The final authorization gate independently checks evidence before signing.
The matcher checks borrower, context, full asset identity, lender/purpose restrictions,
expiry, exact principal, nominal annual interest, fees and term.
A valid match returns the unchanged offers and a canonical `envelope_hash`.
Input order selects the first compatible firm offer for the displayed permitted terms.
A different lender's rejection does not erase a compatible approved offer.

Content commitments detect changed payloads. They do not authenticate a lender or
principal signature. Vedant's source adapters and final signing gate own those checks.
The legacy `apr_bps` name means nominal annual interest in this contract.
No all-in APR, new rate, smaller principal or altered schedule is synthesized here.

`configureCompatibilityService(options)` supplies the same service to the existing
module-level `evaluateLender` and `matchOffers` exports. Unconfigured calls fail closed.

### API

Wire `POST /v1/lenders/:id/evaluate` and `POST /v1/offers/match` to explicit factories.
Final ALLOW, REP/facility reservation, signature release and XRPL submission are separate
responsibilities. The matcher does not perform these actions.

## Done when

- Identical evidence yields A approval and B decline.
- The fixture match reproduces the accepted exact terms and envelope commitment.
- Unknown borrowers, issuer swaps, changed commitments and mandate excesses fail.
- `tests/compatibility.test.ts` exercises these behaviors with exact monetary strings.
