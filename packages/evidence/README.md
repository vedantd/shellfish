# `@shellfish/evidence`

**Owner:** Gita

Versioned evidence passports and participating-source exposure. Lenders make their own credit decisions.

## What this module handles

- Explicit seeded passport lookup with detached return values.
- Shared schema and content commitment validation.
- Freshness checked at an injected clock on every lookup.
- Observation dates and accepted history months checked for consistency.
- Trusted performance-attestation updates with event deduplication and per-subject serialization.

## Build steps

The usable source is `createEvidenceService({ passports, hash, now, attestPerformance? })`.
The API supplies the fixture or attestor feed. `hash` is the shared canonical SHA-256
content hasher supplied by the caller. No file, network, clock or issuer key is hidden here.

```ts
const evidence = createEvidenceService({
  passports: [acceptedPassport],
  hash: contentHash,
  now: () => fixtureClock,
});
const passport = await evidence.getEvidencePassport(principalId);
```

`configureEvidenceService(options)` supplies the same service to the existing module-level
`getEvidencePassport` and `recordPerformanceEvent` exports. Unconfigured calls fail closed.
The fixed fixture clock belongs to simulation. Native requests need current signed evidence.

`recordPerformanceEvent` requires `eventId`, `subjectId`, `loanId`, `eventType`, an exact
monetary string and `observedAt`. It requires a trusted `attestPerformance(event, current)`
callback that returns a fresh attested passport. The callback verifies and persists its
source evidence. Reusing an event ID with changed content fails.
The service checks identity/context and the expected counter change. It never adds
accepted history months or REP from a raw payment notification.
No public HTTP history-mutation endpoint should call this with unverified input.

The service is an in-memory read model. Durable source history and outcome IDs belong
to the attestor/registry. A process restart does not create a verified ledger history.
Content hashes prove content consistency. Cryptographic attestor signature verification
belongs to the trusted source adapter and final authorization boundary.

The registry exposes current portfolio state through `getCreditStatus` and Gita's
`GET /v1/facilities/:id/credit-status` route. That live read is separate from a signed
passport. Reserving or repaying a loan does not silently rewrite an attestor signature
or reissue a lender approval. Show each source's observation time. Use the trusted
attestor callback to publish a new signed version when the demo requires that step.

## Boundaries

Lender decisions live in `compatibility`. Reservations and REP accounting live in
`registry`. Final loan authorization and required signatures belong to Vedant's gate.
The optional tier does not set facility headroom.

## Done when

- Same subject returns the seeded passport with provenance preserved.
- Unknown, expired, altered or internally inconsistent evidence fails.
- Trusted updates apply once in this service and reject altered event replays.
- API wires `GET /v1/evidence/:id` to the explicit service.

Checks: `tests/evidence.test.ts` exercises actual lookup, freshness, content integrity,
observation windows, trusted updates, concurrency and replay behavior.
