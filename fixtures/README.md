# Fixtures

**Owner:** Gita (seed data); both engineers consume these payloads.

Fictional HarborSupply borrower, Lender A approve / Lender B decline, expected denials (PRD §6 / §10.2).

## What this folder is for

Deterministic demo inputs so Vedant and Gita can code in parallel without waiting on live services.

## C0 gaps (do not treat current JSON as frozen)

Tracked on [WORK-BOARD.md](../docs/agent/WORK-BOARD.md) and [B-0001](../docs/agent/CURRENT-BATON.md):

1. **Asset identity FAIL:** `mandate.json` uses `{ currency, issuer }`; `offer-lender-a.json`
   and evidence `known_exposure.asset` use string `"RLUSD"`. Unify on `AssetRef`.
2. **Observation period FAIL:** history is counts only (`on_time` / `late` / `default`).
   Lender B needs ≥12 months — add observation dates or history months.

## Build steps

1. Keep `mandate.json` at max **2500** principal, **600** bps, 90 days, Lender A only.
2. Keep `offer-lender-a.json` at **2000** @ **550** bps / 90 days (happy path).
3. Keep `lender-b-decline.json` as DECLINE (≥12 months history rule).
4. Keep `evidence-passport.json` with known exposure **3000**, coverage `participating_sources_only`.
5. Keep `expected-denials.json` cases: over-amount 3000 → `DENY_AMOUNT`, 900 bps → `DENY_RATE`, replay → `DENY_REPLAY`.
6. When APIs land, load these files in adapters/tests instead of hardcoding objects.
7. After C0 schema fix, update every fixture to match `@shellfish/schemas` and get Vedant’s PR-comment accept.

## Done when

- Schema tests parse every fixture JSON against the **accepted** C0 schema version.
- Demo script can replay happy path + three denials from these files alone.
