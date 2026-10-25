# Shellfish demo scope (for product / design agents)

**Audience:** agents or humans designing product UX, copy, or flows around the
working demo — not inventing greenfield lending features.

**Code base:** `main` after UI Slice 3 + LIVE smoke (merge of PR #9, ~`9dd30aa`).
**Contract:** OpenAPI at `GET /openapi.json` / `services/api/src/openapi.json`.
**Deeper API rules:** [API.md](./API.md). **Architecture:** [architecture.md](./architecture.md).

This document describes **what is actually available today**. Do not design as if
full production custody, KYC, secondary markets, or Mainnet are in scope.

---

## One-sentence product

Shellfish is an **agentic credit gateway**: a principal’s signed mandate + lender
decisions → **atomic reservation** → **exact approved** XRPL `LoanSet` (or a
clearly labeled simulation). Lenders own underwriting. Shellfish does not invent
credit scores or replace XRPL consensus.

---

## Fixed demo commercial terms (do not redesign these away)

Locked C0 / native selection for the demo path:

| Field | Value |
| --- | --- |
| Requested principal | `2,000.00` (`principal_minor` `200000`, money scale 2) |
| Mandate ceiling | `2,500.00` · ≤ `600` bps · `90` days · purpose `working_capital` |
| Firm offer (Lender A) | `2,000.00` @ `550` bps / `90` days |
| Fees | Zero origination / service fees on selected path |
| Loan asset | MPT (scale **6** on LIVE); SIM uses demo USD asset refs |
| Schedule | Single payment interval `7_776_000` s (90 days) |
| REP stake | Curve-quoted bond reserved before ALLOW; redeemed before LoanSet |

Editable commercial terms in the UI would require a **new firm offer** through the
producer path — not free-form edits on Screen B/C.

---

## Network modes (must stay honest in UX)

| Mode | Badge / copy | Origination result |
| --- | --- | --- |
| `SIMULATED_LOAN` | Labeled simulation | `simulated: true`, `txHash: null`, no explorer as live proof |
| `LIVE_DEVNET` | Live Devnet | Real validated `LoanSet` hash + explorer link only when hash is real |

- `GET /v1/network` → `mode`, `live_ready`, public signing IDs, `explorer_base`.
- `live_ready` means **handles configured**, not “loan proved on ledger.”
- Never show a synthetic hash as a live receipt.
- Local web: `http://localhost:5173` · API: `http://127.0.0.1:3001`.

### Back-to-back judge reset

Header **Reset demo** calls `POST /v1/demo/reset` (gated by `SHELLFISH_DEMO_RESET=1` on the API).

| Mode | What reset does |
| --- | --- |
| `SIMULATED_LOAN` | Wipe/reopen local SQLite fixture backend |
| `LIVE_DEVNET` | Provision a **new empty** Devnet borrower (faucet + MPT/REP), wipe live DB, reopen backend |

LIVE reset takes tens of seconds. Response returns public `borrower_account` only — **never** seeds. Without the env gate the API returns **403**. After success the UI clears session state and returns to Screen A.

---

## Demo UI — available now (3 screens)

App shell: brand **Cobb** / Shellfish gateway, step nav A→B→C, `NetworkBadge` from
`GET /v1/network`, header **Reset demo**. Session state is in-memory across the three screens
(refresh clears UI only — use Reset demo for a clean LIVE borrower).

### Screen A — Borrower workspace (`/borrower`)

**Job:** Confirm the principal mandate before credit evaluation.

| Available | Notes |
| --- | --- |
| Show mandate principal, agent, ceiling, asset, requested terms, mandate hash | LIVE replaces sim demo IDs with Devnet-bound mandate |
| **Validate mandate** | SIM: `POST /v1/mandates` with fixed C0 mandate |
| | LIVE: `POST /v1/credit-intents` then mandate validate |
| Continue to Screen B after success | No reservation created on this screen |

**Not on this screen:** wallet connect UI, KYC, editing ceiling/APR/term, multi-agent roster.

### Screen B — Credit & lenders (`/credit`)

**Job:** One evidence passport → two lender outcomes → one unedited firm match → informational quote.

| Available | Notes |
| --- | --- |
| Load evidence · evaluate · match | Single button runs the chain |
| Evidence passport | Known exposure, coverage `participating_sources_only`, observation window |
| Lender A **APPROVE** | Firm offer (principal / APR / term / offer id) |
| Lender B **DECLINE** | Reason codes / human explanation (e.g. history months) |
| Compatible firm offer (unedited) | Match must not rewrite terms |
| Facility credit-status + quote | Quote is **informational only** — grants no borrow permission |
| Continue to Screen C | Requires matched offer in session |

**Not on this screen:** lender marketplace, competing rate shopping, editing the offer, universal credit score.

### Screen C — Authorization & receipt (`/receipt`)

**Job:** Reserve → ALLOW → stake → originate; show receipt honesty; demo bounded denials.

| Available | Notes |
| --- | --- |
| Happy path button | SIM: “Run simulated ALLOW → originate” |
| | LIVE: “Run LIVE ALLOW → stake → LoanSet” |
| ALLOW receipt fields | `request_id`, `reservation_id`, `proposal_hash`, `quote_bond_u`, mode |
| Originate panel | SIM: null hash · LIVE: `loanId`, real `txHash`, explorer link |
| Joined request view | `GET /v1/requests/:id` after ALLOW (source of truth for persisted state) |
| Denial demos | Amount over ceiling · rate over mandate · replay nonce |

**Flow integrity (product must preserve):**

1. Authorization **reserves** facility capacity + REP **before** ALLOW.
2. LIVE: REP stake proof **before** dual-sign `LoanSet`.
3. Exact approved bytes only — UI must not “nudge” principal/APR after match.
4. Unresolved / timed-out execution **retains** capacity (no silent release).

**Not on this screen (yet):** repay UX, default UX, REP-return UX, operator recover, multi-loan portfolio dashboard.

---

## Backend capabilities vs UI coverage

Use this table when deciding what a redesign can surface vs what must stay API-only for now.

### Wired in the demo UI

| Capability | Routes used by UI |
| --- | --- |
| Mode / public signing | `GET /v1/network` |
| Mandate / credit intent | `POST /v1/mandates`, `POST /v1/credit-intents` (LIVE) |
| Evidence | `GET /v1/evidence/{id}` |
| Lender evaluate | `POST /v1/lenders/{id}/evaluate` (A + B) |
| Offer match | `POST /v1/offers/match` |
| Facility status / quote | `GET …/credit-status`, `POST …/quote` |
| Authorize | `POST /v1/authorizations` |
| Originate | `POST /v1/loans/originate` |
| Joined request | `GET /v1/requests/{id}` |

### Implemented in API, **not** in demo screens yet

Safe to design **later** screens against OpenAPI; do not assume polished UX exists.

| Capability | Routes |
| --- | --- |
| Loan / receipt reads | `GET /v1/loans/{id}`, `GET /v1/receipts/{id}` |
| Bounded repay demo | `POST /v1/demo/repay` |
| Native repay / default | `POST /v1/loans/{id}/repay`, `…/default` |
| Operation poll / reconcile | `GET|POST /v1/operations/{id}` (+ reconcile) |
| REP return read / process | `GET|POST /v1/rep-returns/{id}` |
| Operator recover (token) | `POST /v1/operator/recover` |
| Facility detail | `GET /v1/facilities/{id}` |

Lifecycle routes return **503** if the native lifecycle backend is unavailable.
HTTP **202** = pending/busy — never show success or release capacity from 202 alone.

---

## Explicitly out of demo / MVP product scope

Do **not** design these into the first product surface as if they ship with this demo:

- Mainnet, production custody, or production KYC
- Micro-bond trading, secondary loan markets, new liquidity pools
- Universal credit scoring / Shellfish-as-underwriter
- AMM or XRPL consensus changes
- Auto-restoring credit after default or write-off
- Presenting simulation as on-chain lending
- Free-form editing of firm offer terms in the borrower UI

Participating-lender **known exposure only** — partial coverage must stay visible in copy.

---

## Personas the demo already encodes

| Role | What they do in the demo |
| --- | --- |
| **Principal** | Issues the mandate ceiling (Screen A) |
| **Agent** | Acts within mandate (shown on mandate; not a separate login) |
| **Lender A** | Approves with a firm offer |
| **Lender B** | Declines with reasons |
| **Gateway (Shellfish)** | Match → reserve → authorize → stake → sign exact LoanSet → receipt |
| **Operator** | Exists in API for recover/default — **not** in current UI |

---

## Design constraints (non-negotiable for a redesign)

1. **One happy path, three steps** is the current mental model (A mandate → B credit → C authorize). Expanding screens is fine; collapsing reserve-before-sign is not.
2. **Mode honesty:** SIM vs LIVE must never share the same “success” visual language for hashes.
3. **Quote ≠ permission.** Facility quote is preview only.
4. **Firm offer is immutable** in the borrower flow after match.
5. **Explorer links** only for real validated hashes.
6. **No seed / private key** surfaces in UI, fixtures, or marketing screenshots.
7. Visual system today: cool paper + teal, Familjen Grotesk / IBM Plex — redesign may restyle, but keep brand **Shellfish** as the hero product name on the first viewport.

---

## Suggested brief for a design agent

> Design a polished product experience for Shellfish’s **existing** A→B→C demo:
> mandate validation, dual-lender evidence/match, and authorize→originate with
> honest SIM vs LIVE_DEVNET receipts. Stay inside [DEMO-SCOPE.md](./DEMO-SCOPE.md)
> and [API.md](./API.md). Do not invent Mainnet custody, score marketplaces, or
> editable loan shopping. Prefer clearer hierarchy, trust cues for reservation and
> on-chain proof, and optional later screens for repay/default only as wireframes
> labeled “API exists / UI not shipped.”

---

## Evidence that the current path works

- SIM: authorize → reserve → originate with null `txHash` (labeled).
- LIVE_DEVNET UI smoke (AUTH-DEVNET-001): ALLOW → stake → `LoanSet` `tesSUCCESS`
  with public explorer hash recorded on Vedant’s work baton
  (`docs/agent/work/SETUP-VEDANT.md`, UI Slice 3 checkpoint).

Full backend acceptance (return-worker runtime, restart/unknown-debt audit, C4
rehearsal) is **still open** — design for the demo path above, not for “production complete.”
