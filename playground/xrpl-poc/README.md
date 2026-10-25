# Shellfish XRPL Devnet loan playground

Devnet LoanSet / LoanPay spike for Shellfish. Own `package.json` (not a pnpm workspace member). Run from this folder; do not commit `.wallets/` seeds.

## Why Devnet only

Gita’s amendment check (see repo `mathematical-model.md`): Devnet has MPTs, SingleAssetVault, LendingProtocol, LendingProtocolV1_1, and DynamicMPT. **Testnet has MPTs but not lending/vaults** — the complete demo cannot run there. Scripts refuse Testnet WS URLs.

## SDK pin

This playground pins **`xrpl@5.3.0`** (LoanSet counterparty signing + ImmutableFlags). Requires **Node ≥ 20.19**.

The monorepo still declares `xrpl: ^4.0.0` under `@shellfish/xrpl`. Bumping that is a **separate reviewed Vedant** manifest/lockfile change — do not mix it into this POC.

## Setup

```bash
cd playground/xrpl-poc
# xrpl@5.3.0 needs Node >= 20.19 (nvm use 22 works if default is older)
npm install   # or pnpm install — local to this folder only
cp .env.example .env   # optional overrides
```

## Run sequence

```bash
pnpm feature-check    # required amendments on Devnet
pnpm setup-lending    # fund wallets, MPT, private vault, LoanBroker; wait ~30s for Investment
pnpm execute-loan     # dual-sign LoanSet → submitAndWait → artifacts/last-loan.json
pnpm repay-loan       # optional stretch: LoanPay against last artifact
```

Seeds live in `.wallets/lendingSetup.json` (addresses logged; do not paste seeds). Success artifact: `artifacts/last-loan.json` (network, `tesSUCCESS`, tx hash, Loan ID).

### InterestRate trap

`InterestRate` is **1/10th of a basis point**. `5500` → 5.5% APR. (`500` in the official tutorial is 0.5%.)

### PaymentInterval

Seconds between payments (e.g. `2592000` ≈ 30 days). Final scheduled payment must be ≥ 60s before vault `RedemptionDate` (setup uses a long closed-ended vault).

## Copy into `@shellfish/xrpl` later

Reusable pieces:

1. Feature probe → `LIVE_DEVNET` vs `SIMULATED_LOAN`
2. Broker signs LoanSet first; borrower via `signLoanSetByCounterparty`
3. `submitAndWait` + parse Loan ID from meta — never invent a hash
4. Only after Shellfish ALLOW + REP stake (not in this playground)

Official tutorial: [Create a Loan](https://xrpl.org/docs/tutorials/defi/lending/use-the-lending-protocol/create-a-loan)
