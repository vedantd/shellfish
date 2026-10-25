# `@shellfish/api`

**Owner:** You (orchestration). Gita’s handlers are mounted here but implemented in her packages.

Fastify REST backend. Sequence the flow; keep packages thin.

## What this service handles

- HTTP contracts from PRD §7.1
- Persistence (SQLite via `src/db/schema.sql`)
- Ordering: evidence → evaluate → match → authorize → **reserve** → sign → submit → reconcile → receipt

## Build steps

1. Keep `/health` returning `networkMode`.
2. Replace TODO bodies by calling packages:

| Route | Call |
|-------|------|
| `POST /v1/mandates` | `@shellfish/authorization` `verifyMandate` + store |
| `GET /v1/evidence/:id` | `@shellfish/evidence` |
| `POST /v1/lenders/:id/evaluate` | `@shellfish/compatibility` `evaluateLender` |
| `POST /v1/offers/match` | `@shellfish/compatibility` `matchOffers` |
| `POST /v1/authorizations` | `@shellfish/authorization` `authorizeExactAction` |
| `POST /v1/loans/originate` | registry `reserveFacility` → xrpl `originateLoan` → settle |
| `GET /v1/loans/:id` | local state + chain Loan ID |
| `GET /v1/receipts/:id` | assembled receipt transitions |
| `POST /v1/demo/repay` | xrpl repay + evidence `recordPerformanceEvent` |

3. Parse request bodies with Zod schemas at the edge.
4. Map package errors → stable denial codes + one human explanation.
5. Idempotency keys: `request_id` + `facility_id` + `proposal_hash`.
6. State machine (do not skip):  
   `REQUESTED → UNDERWRITING → MATCHED → AUTHORIZED → RESERVED → SIGNED → SUBMITTED → VALIDATED_ACTIVE`  
   (or `DENIED` / `RECONCILING` / `RELEASED`).

## Orchestration rule

```
ALLOW from authorization
  → reserveFacility (Gita)   // before any signature
  → controlled sign (You)
  → submit LoanSet
  → on validated success: settleReservation COMMITTED
  → on failure/timeout: RECONCILING then RELEASED if confirmed failed
```

## Done when

- Fresh clone: `pnpm install && pnpm db:init && pnpm dev` runs stubs, then real handlers as packages land.
- Happy path + three denials work end-to-end without UI.
