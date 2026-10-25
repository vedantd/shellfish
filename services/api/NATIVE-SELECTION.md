# Native selection draft (Vedant Priority 1)

Recorded: 2026-10-25. Owner: Vedant. No seeds. No Devnet submit.

## Locked commercial terms (product C0, not playground POC)

| Field | Value |
| --- | --- |
| term_days | 90 |
| payment_total | 1 |
| payment_interval_seconds | 7776000 |
| fees | 0.00 (origination/service env `"0"`) |
| apr_bps | 550 |
| principal_minor | 200000 (2000.00) |
| sdk_pin | 5.3.0 |
| network / mode | devnet / LIVE_DEVNET |

## Files

| Path | Purpose |
| --- | --- |
| [`native-selection.draft.json`](native-selection.draft.json) | Public IDs + locked terms |
| [`public-network-snapshot.draft.json`](public-network-snapshot.draft.json) | Shape of `GET /v1/network` for preflight |
| [`native-preflight-report.json`](native-preflight-report.json) | Latest offline preflight output |
| [`.env.live.example`](.env.live.example) | Env defaults aligned to the same terms |

Public accounts/MPT/broker IDs are taken from Gita’s recorded native E2E result
`fixtures/xrpl-poc-replay/native-result-2026-10-25T08-52-39-891Z-c8c11959.json`
(addresses and issuance IDs only).

## Preflight result

Command (from `fixtures/native-preflight`):

```sh
node native-preflight.mjs --repo <repo> \
  --selection ../../services/api/native-selection.draft.json \
  --runtime ../../services/api/public-network-snapshot.draft.json \
  --output ../../services/api/native-preflight-report.json
```

- Exit: **2**
- `configuration.status`: **CONFIGURATION_INCOMPLETE**
- Selection↔runtime schedule/route/asset shape: checked (runtime `CHECKED_UNVERIFIED`)
- Findings: all **SOURCE_*** / sim-fixture mismatches (expected). Default repo fixtures remain `SIMULATED_LOAN` and must not be relabeled.

## Exact Gita ask (Priority 2)

Produce matching **LIVE_DEVNET** source documents for this selection (not hashes alone):

1. Native portfolio seed (zero opening debt)
2. Borrowing mandate + lender facility offer (90d / 0 fees / 550 bps / principal 2000.00)
3. Atomic reservation request
4. Evidence passport for the selected borrower/subject
5. `native_asset_metadata` binding loan/REP assets and `loan_asset_scale: 6`

Then Vedant injects nonempty evidence/approved-offer services in `live-backend.ts`.
