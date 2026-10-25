# Fixtures

**Owner:** Gita (seed data); both engineers consume these payloads.

Fictional HarborSupply borrower, Lender A approve / Lender B decline, expected denials (PRD §6 / §10.2).

## What this folder is for

Deterministic demo inputs so You and Gita can code in parallel without waiting on live services.

## Build steps

1. Keep `mandate.json` at max **2500** principal, **600** bps, 90 days, Lender A only.
2. Keep `offer-lender-a.json` at **2000** @ **550** bps / 90 days (happy path).
3. Keep `lender-b-decline.json` as DECLINE (≥12 months history rule).
4. Keep `evidence-passport.json` with known exposure **3000**, coverage `participating_sources_only`.
5. Keep `expected-denials.json` cases: over-amount 3000 → `DENY_AMOUNT`, 900 bps → `DENY_RATE`, replay → `DENY_REPLAY`.
6. When Gita’s APIs land, load these files in adapters/tests instead of hardcoding objects.

## Done when

- Schema tests parse every fixture JSON.
- Demo script can replay happy path + three denials from these files alone.
