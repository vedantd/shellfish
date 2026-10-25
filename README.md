# Shellfish — Agentic Credit Gateway

**Portable credit evidence · Lender-owned underwriting · Deterministic authorization · Native XRPL loan execution**

An accountable business can delegate bounded borrowing authority to an AI agent; participating lenders keep their own underwriting rules; Shellfish verifies the exact approved loan before a required signer participates in XRPL execution.

> Internal hackathon build contract (PRD v1.1 · 24 Oct 2026). All example identities and credit data are fictional.

## Who codes what

| Person | Codes? | Owns |
|--------|--------|------|
| **You** | Yes | Shellfish authorization, controlled signing, XRPL adapter, API orchestration, demo UI |
| **Gita** | Yes | Evidence passport, lender policy adapters, Nick matching, facility registry, fixtures/tests |
| **Nick** | No | Lender policy semantics, pitch, judge Q&A |
| **Shell** | No | Security review, denial scenarios, claim review |

Nick and Shell do **not** merge implementation code. Module names (“Nick”, “Shellfish”) do not imply who codes them.

## Repo layout

```
apps/web/                    # You — screens A / B / C
services/api/                # You — Fastify orchestrator
packages/schemas/            # Shared — Zod contracts (PRD §6)
packages/authorization/      # You — mandate verify + policy gate
packages/xrpl/               # You — LoanSet / LoanPay adapter
packages/evidence/           # Gita — passport + known exposure
packages/compatibility/      # Gita — Nick matcher + lender policies
packages/registry/           # Gita — facilities / reservations
fixtures/                    # HarborSupply / Lender A+B seed data
tests/                       # Invariant + fixture schema tests
docs/                        # PRD + architecture note
```

## Prerequisites

- Node.js **20+** (see `.nvmrc`; 22 recommended)
- [pnpm](https://pnpm.io) 9+ (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm db:init          # creates SQLite schema (no reservation logic yet)
pnpm --filter @shellfish/schemas build
pnpm --filter @shellfish/authorization build
pnpm --filter @shellfish/xrpl build
pnpm --filter @shellfish/evidence build
pnpm --filter @shellfish/compatibility build
pnpm --filter @shellfish/registry build
pnpm dev              # API :3001 + web :5173
```

Or start pieces separately:

```bash
pnpm --filter @shellfish/api dev
pnpm --filter @shellfish/web dev
```

Health check: `GET http://127.0.0.1:3001/health` (includes `networkMode`).

If port `3001` is already in use locally, set `API_PORT` in `.env` (and update the Vite proxy in `apps/web/vite.config.ts` if needed).

```bash
pnpm test
```

## Network modes

| Mode | Meaning |
|------|---------|
| `LIVE_DEVNET` | Real LoanSet validation and Loan ID when features support it |
| `SIMULATED_LOAN` | Labeled simulation — **never** present as on-chain lending |

Set `NETWORK_MODE` in `.env`. Every displayed tx hash must be queryable on the configured network; never fabricate a hash as “real”.

## Seeded happy path & denials

Fixtures under `fixtures/` (HarborSupply):

| Path | Expected |
|------|----------|
| Request **2,000** @ **550 bps** / 90 days | Lender A APPROVE · Lender B DECLINE · Nick compatible · Shellfish **ALLOW** |
| Request **3,000** | **DENY_AMOUNT** (mandate max 2,500) |
| Offer **9%** vs max **6%** | **DENY_RATE** |
| Replay same nonce + proposal | **DENY_REPLAY** |

## Non-negotiable invariants

1. The agent is **not** the legal borrower; a verified principal remains accountable.
2. Evidence / reputation is **not** a lender commitment; approval is issuer- and facility-specific.
3. An AI output cannot change policy, limits, signatures, or authorized transaction bytes.
4. Authorization is **not** settlement; only validated XRPL state establishes on-chain success.
5. Known exposure covers participating sources only — never claim global debt completeness.

## Explicit non-goals (hackathon)

No micro-bond / secondary debt marketplace, no universal credit score, no production custody / KYC provider, no original lender liquidity pool, no self-modifying LLM policy engine.

## API stubs (PRD §7.1)

| Endpoint | Owner |
|----------|-------|
| `POST /v1/mandates` | You |
| `POST /v1/authorizations` | You |
| `POST /v1/loans/originate` | You |
| `GET /v1/loans/:id` | You |
| `GET /v1/receipts/:id` | You |
| `GET /v1/evidence/:id` | Gita |
| `POST /v1/lenders/:id/evaluate` | Gita |
| `POST /v1/offers/match` | Gita |
| `POST /v1/demo/repay` | You + Gita |

Handlers currently return TODO placeholders. Implement against `@shellfish/schemas` and `fixtures/`.

## Milestone gates

| Gate | Checkpoint |
|------|------------|
| **H03** | Native lending go/no-go; schema interfaces frozen |
| **H10** | Gita / lender / Shellfish APIs return fixture-correct payloads |
| **H18** | Full authorized flow locally (real signing or controlled stub) |
| **H26** | E2E demo: one ALLOW + three DENYs with evidence + receipt |
| **H31** | Live XRPL hash **or** simulation badge correct; no scope expansions |
| **H36** | README, repo, video/presentation, deterministic fixture script |

### Hour 0–3 interface freeze

Before parallel work: You prove Devnet loan path + signing boundary; Gita freezes evidence / offer / compatibility response schemas; agree on API shapes. Until then, each engineer may use local fixtures — integration must consume canonical schemas, not ad-hoc fields.

## References

- Full PRD: [`docs/Shellfish_Agentic_Credit_Gateway_PRD_v1_1_Team_Allocation.pdf`](docs/Shellfish_Agentic_Credit_Gateway_PRD_v1_1_Team_Allocation.pdf)
- Architecture sketch: [`docs/architecture.md`](docs/architecture.md)
- XRPL Lending Protocol: https://xrpl.org/docs/concepts/tokens/lending-protocol
- Create a Loan tutorial: https://xrpl.org/docs/tutorials/defi/lending/use-the-lending-protocol/create-a-loan

---

**Judge one-liner:** Shellfish lets lenders keep their underwriting and lets AI agents access XRPL credit only within verified, lender-approved and owner-delegated limits.
