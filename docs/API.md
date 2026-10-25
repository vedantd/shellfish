# Shellfish frontend API contract

The source of truth is `services/api/src/openapi.json`. The running API serves that same
document at `GET /openapi.json`. Import it into an OpenAPI client or generate frontend
types from it with an already-approved tool. No client generator is required to use it.

The local base URL is `http://127.0.0.1:3001`. The frontend reads `VITE_API_BASE_URL`.
The document covers runtime/mode, mandates, evidence, lender decisions, offer matching,
facility state, REP quotes, authorization, origination, loan and receipt reads, joined
request views and the bounded repayment demo.

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
