# Durable UI backend checks

The backend stores receipts and approved offer snapshots in the same SQLite file as credit requests, loans and ledger event references. GET /v1/requests/:id joins those records for the frontend. GET /openapi.json serves services/api/src/openapi.json.

Build the workspace before the HTTP restart test. With existing Node 24.21 dependencies installed, run:

```sh
SOURCE_REPO="$PWD" node --test fixtures/ui-backend/*.test.mjs
node fixtures/openapi/check.mjs --repo . --output /tmp/shellfish-openapi-check.json
```

The tests use disposable databases and local API processes. The HTTP test restarts the process twice, reads the same saved receipt, originates its existing reservation without reauthorization, returns the joined view and checks exact retry without new events. It uses SIMULATED_LOAN to test application recovery without ledger submissions.

Native-shaped unit rows use explicit trusted verifier doubles. They test public hash persistence and filtering, not native ledger acceptance. Public views expose recorded transaction references and safe attempt summaries. They never expose signed blobs or treat a hash as a lender decision.

The earlier XRPL native fixture ran real Devnet transactions. Its captured proof remains in fixtures/xrpl-poc-replay. These UI/backend tests do not rerun or relabel that proof.
