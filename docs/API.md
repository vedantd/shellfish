# Shellfish frontend API contract

The source of truth is `services/api/src/openapi.json`. The running API serves that same
document at `GET /openapi.json`. Import it into an OpenAPI client or generate frontend
types from it with an already-approved tool. No client generator is required to use it.

The local base URL is `http://127.0.0.1:3001`. The frontend reads `VITE_API_BASE_URL`.
The document covers runtime/mode, mandates, evidence, lender decisions, offer matching,
facility state, REP quotes, authorization, origination, loan and receipt reads, joined
request views and the bounded repayment demo.

## Rough native lifecycle facade

The HTTP document is version `0.3.0`. The shared C0 contract remains `C0-REP-1`.
These routes are native-only and return 503 if the native lifecycle backend is unavailable.
This delivery is a rough implementation handoff. Full testing and hardening remain with
Vedant. The route inventory/schema check does not establish native lifecycle acceptance.

| Route | Frontend use |
| --- | --- |
| `POST /v1/credit-intents` | Optional `{idempotency_key}` returns `{mandate,offer,reservationRequest,evidence}`. Reuse the key for the same intent |
| `POST /v1/loans/{id}/repay` | Send `operation_id`, positive integer `maximum_amount_native` and optional `payment_mode` (`FULL`, `REGULAR`, `OVERPAYMENT`, `LATE`) |
| `POST /v1/loans/{id}/default` | Operator-only default with `operation_id`. The backend derives the request from the saved loan |
| `GET /v1/operations/{id}` | Poll the stored public repayment/default operation |
| `POST /v1/operations/{id}/reconcile` | Reconcile the same saved operation without replacing its transaction fields |
| `GET /v1/rep-returns/{id}` | Read `{instruction,attempt}`. Attempt is null until persisted, and excludes signed bytes |
| `POST /v1/rep-returns/{id}/process` | Process the exact owed REP return through its issuer queue |
| `POST /v1/operator/recover` | Explicitly recover an already stopped worker using its exact kind, ID, owner and fence |

The native flow is credit intent, lender/evidence views, authorization, then origination.
The intent response uses `reservationRequest`. Pass that object as `reservation_request`
to authorization. Preserve its mandate, offer and evidence commitments. A repayment's
maximum native amount is a spending cap. Ledger metadata supplies actual debt reduction.
Read `public_signing.loan_asset_scale` from the network response. At loan asset scale 6,
`2000.00` units becomes `maximum_amount_native:"2000000000"`. REP has its own scale 6.
Do not substitute the REP scale for the selected loan asset scale.

HTTP 202 means pending or busy. Keep the same request/operation ID and reconcile the saved
attempt. Do not show success or release REP/capacity from an HTTP 202 response. A lifecycle
operation exposes state, hash/sequence bounds and failure class, without signed bytes.
A return remains OWED until its Payment validates and the registry settles it once.

Default and worker recovery require `X-Shellfish-Operator-Token`, matching the configured
operator token. Recovery requires `{kind,id,expected_owner,expected_fence,
acknowledge_worker_stopped:true}`. Kind is `EXECUTION`, `LIFECYCLE` or `RETURN`. It does
not release economic holds or replace an unresolved attempt. The operator must stop the
old worker before acknowledging recovery.

Use `GET /v1/requests/{id}` after authorization to recover the joined UI state. The
response joins the persisted receipt, approved offer, current loan and credit state,
recorded transaction references and safe attempt summaries. It survives application
restart through SQLite. Unknown requests return 404. Missing configured sources return
503. No raw signed transaction blob is part of the public contract.
The nullable `lender_decision` projects approval from the stored firm offer. It does
not run underwriting again or manufacture another lender's decline. A request context
or mode mismatch returns 409.

Read the mode from the API. `SIMULATED_LOAN` has null native transaction hashes and no
explorer links. `LIVE_DEVNET` transaction references use recorded registry evidence.
`ledger_requeried:false` states that this read endpoint did not query the ledger again.
A pending saved attempt is separate from a recorded successful event. `live_ready` in
the network response reports configured application handles, not completed ledger proof.

The evidence passport and lender offer remain separate from ledger references. A hash
does not state the mandate limits, lender decision or aggregate known exposure. Display
those fields from their source records and the credit status. Coverage is limited to
participating sources.

All atomic money and REP amounts are decimal strings. Use `money_scale` for monetary
units and `rep_scale:1000000` for REP. Display calculations must not replace backend
permission checks. `POST /v1/facilities/{id}/quote` is informational and grants no
borrowing permission. Authorization reserves capacity and REP before signing.

Retain the authorization's request, reservation and proposal identity for retries.
An exact retry reuses the existing action. A new request with a consumed mandate nonce
is rejected. Do not manufacture another nonce in the UI. The current editable fields
must match the saved approved offer. A changed commercial request needs a newly issued
firm offer and coherent commitments through the existing producer path.

The OpenAPI models mirror the current shared Zod models. Zod refinements and registry
transactions retain cross-field checks such as REP conservation and native stake/signing
requirements. `fixtures/openapi/check.mjs` checks the route inventory, schema references,
component schemas and examples. Keep that check with any route/model change.
The HTTP document version is independent from the C0 contract version. Its
`x-source-schema-hashes` bind all four shared schema files. A model change fails the
contract check until the document and metadata are refreshed together.

Examples in the contract are explicitly synthetic C0 examples. They are not native
ledger receipts. Contract checks do not establish authenticated native execution,
default or issuer-return acceptance.

To refresh the frontend contract after an API/model change, run `node fixtures/openapi/generate.mjs .`, then `node fixtures/openapi/check.mjs --repo .`. The served JSON and source JSON are the same artifact. The generator uses existing source schemas and synthetic examples. No new dependency is required.
