# `@shellfish/evidence`

**Owner:** Gita

Evidence passport + known-exposure. **Not** a credit approval. **Not** a universal score.

## What this module handles

- Versioned, attributable repayment history
- Known exposure with coverage label (`participating_sources_only`)
- Freshness / expiry of the passport
- Optional tier label that must **never** change facility headroom

## Build steps

1. Implement `getEvidencePassport(subjectId)` — load from `fixtures/evidence-passport.json` first.
2. Validate with `EvidencePassport` from `@shellfish/schemas`.
3. Reject / flag stale passports (`expires_at` in the past) so authorization can emit `DENY_EVIDENCE_STALE`.
4. Always return issuer id, signature, evidence hash, and coverage — never strip provenance.
5. Implement `recordPerformanceEvent` for repay/default feedback (can stay stub until after H18).
6. Wire API: `GET /v1/evidence/:id` in `services/api` to call this package.

## Do **not** do here

- Lender approve/decline (that’s `compatibility`)
- Facility reservation (that’s `registry`)
- ALLOW/DENY on a loan (that’s `authorization`)

## Done when

- Same subject returns the same fixture-correct passport.
- Optional tier present or absent does not imply credit limit.
