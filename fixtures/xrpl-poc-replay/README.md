# Isolated REP and native loan fixture

This folder contains an offline replay and a separate native Devnet test.
Both use Gita's existing curve and registry. The native test creates its own accounts,
loan asset, REP issuance, vault and broker. It imports the installed XRPL SDK directly.
It does not import or replace Vedant's application adapter.

Gita requested this separate fixture directly in this chat on 25 October 2026.
The base is `b495e255be10cbe2aab3d6d33128e888d6534d9b` plus the existing local C0 and
registry changes. This folder is a local test artifact. Consumer acceptance of the
current draft event interfaces remains pending. No coordinator claim or ACK is invented.

## Run

Use the installed runtime selected by the repository's `.nvmrc`, currently Node 24.21.0.
The current registry checks the installed `better-sqlite3` 12.10.1 binding.
Use installed dependencies. These commands perform no package installation.

From the repository root:

```sh
nvm use
node node_modules/typescript/bin/tsc -b packages/schemas packages/registry
node --test fixtures/xrpl-poc-replay/replay.test.mjs fixtures/xrpl-poc-replay/native-helpers.test.mjs
node fixtures/xrpl-poc-replay/replay.mjs
```

The test command uses Node's test runner. The root Vitest configuration does not discover
this separate folder. Run this command with the normal repository checks.

Print the native execution plan without creating accounts or submitting transactions:

```sh
node fixtures/xrpl-poc-replay/native-e2e.mjs
```

Run a fresh native Devnet test:

```sh
node fixtures/xrpl-poc-replay/native-e2e.mjs --run-native
```

This command creates four fresh wallets. The Devnet faucet funds the broker wallet.
The broker funds the other three test accounts with XRP. The test issues its own demo
loan asset. No existing wallet, real USD or Vedant signing key is required.

The native result is written to `native-result-<run-id>.json` in this folder.
It contains public addresses, validated transaction records, accounting snapshots and
the exact test boundary. A submitted transaction does not count as a successful result.

## Files

| File | Purpose |
| --- | --- |
| `native-evidence.json` | Unchanged saved evidence from Vedant's earlier POC |
| `scenario.json` | A new synthetic portfolio with zero opening exposure and 1,000 REP |
| `events.json` | Scripted replay, retained commitment inputs and source references |
| `expected.json` | Expected snapshots, credit states and original bond |
| `replay.mjs` | Offline fixture validation and registry execution |
| `replay.test.mjs` | Accounting, retry, amount, history, reward and default checks |
| `native-e2e.mjs` | Standalone fresh Devnet execution and registry check |
| `native-rep.mjs` | Test-only REP creation, redemption and return with ledger checks |
| `native-ledger.mjs` | Validated lookups, metadata extraction and complete ledger coverage |
| `native-helpers.test.mjs` | Regression checks for native evidence interpretation |
| `verify-native-result.mjs` | Read-only public-ledger recheck with no wallet-key loading |

Re-query the latest completed native result without signing or submitting:

```sh
node fixtures/xrpl-poc-replay/verify-native-result.mjs
```

Pass a public result path as the first argument to check an earlier run.

## Offline replay

The offline replay reads saved transactions and opens an in-memory database. It makes
no network request and needs no funded wallet. It preserves these recorded quantities:

| Quantity | Native loan-asset units | Registry minor units |
| --- | --- | --- |
| Gross principal | 1,000 | 100,000 |
| Borrower receives | 900 | 90,000 |
| Submitted repayment maximum | 2,000 | 200,000 |
| Actual borrower debit | 1,015 | 101,500 |
| Principal reduction | 1,000 | 100,000 |

The saved MPT has AssetScale 0. One whole native unit maps to 100 registry minor units.
The original bond is 240 REP, represented by `240000000` micro-REP.
The principal, facility and REP asset in the replay are separate synthetic records.
They do not assert the real borrower's enrollment, total liabilities or REP balance.

The replay follows seed, dual reservation, simulated redemption, unknown outcome,
origination, full repayment and simulated return. It checks every expected snapshot.
Repeated enrollment, reservation and event delivery change accounting once.
Unknown origination retains both holds. A pending return remains unavailable.

The saved evidence SHA-256 is pinned in `replay.mjs`:

```text
f5e5a1403016b00f05086a1fd986138da2255d694314d956a9f6fcdee56fcd96
```

Native source hashes remain references outside simulated registry events. Every replay
event omits native proof. Native signing stays false. The internal draft event names
`STAKE_VALIDATED` and `RETURN_VALIDATED` describe simulation transitions in this mode.
They do not claim a validated REP transaction.

The replay uses zero elapsed synthetic principal exposure. Its simulated growth is zero.
Native appreciation remains `NOT_EVALUATED`. The original POC records loan close times
of 04:35:40Z and 04:35:42Z, but its Loan StartDate converts to 04:35:43Z.
The fixture does not convert that mismatch into a native reward claim.

Separate synthetic tests check a 30-day reward of 2 REP for principal 1,000, a partial
repayment reward of 1.5 REP, and default forfeiture with borrowing suspension.

## Native test boundary

The native run pins Devnet network ID 2 and checks all required amendments.
It creates a transferable demo USD MPT at scale 0 and a separate REP MPT at scale 6.
REP requires holder authorization and permits no peer transfer, trade, escrow, lock or
clawback. Its six core capability choices use ImmutableFlags 126.

The run performs these steps:

1. Create and fund the isolated wallets and loan asset.
2. Create REP, authorize the borrower and issue 1,000 REP.
3. Create and fund a closed vault, then create its broker.
4. Wait for the validated ledger to enter the vault's Investment phase.
5. Initialize a verified empty registry portfolio and reserve 1,000 principal plus 240 REP.
6. Redeem 240 REP to its issuer and verify holder and supply reductions.
7. Reject an altered 2,000-unit loan before the fixture's required signer runs.
8. Freeze the exact approved LoanSet fields, obtain both signatures and originate.
9. Repay the one scheduled payment using ordinary LoanPay with a 2,000-unit maximum.
10. Derive actual debit and principal reduction from validated metadata.
11. Scan every validated ledger from origination through repayment.
12. Record the original bond and permitted reward as a pending return credit.
13. Send the exact issuer return, verify its effects and make REP available once.

The native terms mirror the earlier POC: principal 1,000, nominal annual rate 5.5%,
one 30-day payment, origination fee 100 and service fee 10. Actual repayment debit and
elapsed reward come from the new run. They are not copied from the old capture.

The test uses the approved curve unchanged. It verifies native REP, native lending,
the fixture's exact-action signing gate and registry accounting. It does not establish
production custody, lender underwriting, principal-mandate verification, Vedant's adapter
acceptance or UI behavior.

Default needs no second REP burn. The pre-loan holder Payment to the REP issuer already
burns the original bond. The registry's bonded balance tracks a conditional restoration
right. Confirmed default moves that amount into forfeited REP, cancels restoration and
suspends new borrowing. The issuer sends no REP return and awards no growth.

For this 240 REP example, default leaves 760 REP in the wallet and records 240 REP
forfeited in the registry. Remaining native supply stays reduced by the earlier burn.
Defaulted principal remains in liability and recovery records. Later recovery does not
restore REP or borrowing permission automatically.

The registry default test passes with a synthetic event. The native harness currently
tests clean repayment only. Its verifier rejects default or impairment as repayment proof.
A native default test needs its own unpaid loan and a validated broker LoanManage
default after the native due date and grace period. No native default is claimed here.

## Private state and recovery

Wallet secrets and immutable signed attempts stay under ignored `data/<run-id>`.
The run directory uses mode 0700. Private files use mode 0600. Public results contain
no seeds or private keys. Preserve the private directory for any unfinished run.

Setup interpretation failures can reuse already validated steps:

```sh
node fixtures/xrpl-poc-replay/native-e2e.mjs --run-native --resume <run-id>
```

This bounded resume re-queries each saved setup hash and checks its original fields.
A redeemed stake requires its retained database, reservation and immutable stake attempt.
The resume reuses that stake hash. It does not burn another bond or create a second hold.
It refuses unresolved signed attempts and runs that already originated a loan.
Those cases require servicing reconciliation through the retained records.
The harness never signs a replacement for an unresolved action.

## Observed runs on 25 October 2026

| Run | Result | Loan close interval | Growth | Final native REP |
| --- | --- | --- | --- | --- |
| `08-41-34-002Z-a7f02f58` | PASS after two local interpretation fixes and preserved-state resume | 19 seconds | 0.000014 REP | 1,000.000014 REP |
| `08-52-39-891Z-c8c11959` | PASS from fresh accounts with no resume | 11 seconds | 0.000008 REP | 1,000.000008 REP |

Run identifiers use UTC. The clean run began at 04:52:39 New York time.
Each run used distinct accounts and assets. Both returned to zero active principal,
zero reserved principal and zero pending REP return credit.
All five core transactions in each run validated with `tesSUCCESS`.

The recovered run exposed API v2's `DeliverMax` Payment alias, then an undefined field
in the SDK's prepared object. The harness now accepts the documented alias and normalizes
prepared fields to their serialized JSON representation before commitment.
Saved recovery records retain both failures. Validated setup steps and the redeemed bond
were reused rather than submitted again.

The clean run charged 1,015 loan-asset units against a submitted maximum of 2,000.
Principal fell by 1,000. Its checked history covers five consecutive validated ledgers,
6,401,351 through 6,401,355. Reward uses those ledger close times under REP-CURVE-v0.2.
The final issuer Payment returned 240.000008 REP, including the original 240 REP bond.

| Clean-run step | Validated Devnet transaction | Ledger |
| --- | --- | --- |
| Seed 1,000 REP | [AF3E57FB…BE69127D](https://devnet.xrpl.org/transactions/AF3E57FBEF12B8BEE432A20F903069F6F2050829A16F050549646958BE69127D) | 6,401,320 |
| Redeem 240 REP | [61E3ED04…6937D98C](https://devnet.xrpl.org/transactions/61E3ED040E470F7B50C1A41FE463397A2FC1E2C8BFD905AC15936C146937D98C) | 6,401,349 |
| Originate | [2846EC91…71A9DCC9](https://devnet.xrpl.org/transactions/2846EC91AA071877923B29178CA1F020C3D73403130785AAB854B1B771A9DCC9) | 6,401,351 |
| Repay | [C23DA798…8F7F53ED](https://devnet.xrpl.org/transactions/C23DA7980AEAFD52E77567EED0203140CD853CD6CFDDC3CC5172C83C8F7F53ED) | 6,401,355 |
| Return REP | [362D204C…70A14A9A](https://devnet.xrpl.org/transactions/362D204C63433DC4D35390A4B11BEA8CC21F7096379D82BB077CFF6F70A14A9A) | 6,401,357 |

The corresponding `native-result-*.json` files contain full public transaction records.
The clean run's `native-verification-*.json` records a separate read-only ledger recheck.
The recheck verifies holder and issuance balances against the registry's final state.
It loads no wallet secrets and submits no transaction.

Checks: 37 fixture tests PASS with no skips or TODOs. The existing repository suite
reports 96 PASS and six existing TODOs. The workspace TypeScript build and whitespace
check PASS. Real native default, production crash recovery and multi-process signer
contention remain outside this native happy-path result.

## Parallel work

All additions live in this folder. The existing C0 scenario remains separate.
Vedant's adapter, authorization package, API entry points, UI, integration tests,
manifests, lockfile and coordinator records are outside this fixture's write scope.

Vedant can review the public results and choose how to consume the draft registry
interface in his own implementation. These tests do not publish or merge that interface.

Protocol references: [Create a Loan](https://xrpl.org/docs/tutorials/defi/lending/use-the-lending-protocol/create-a-loan),
[LoanSet](https://xrpl.org/docs/references/protocol/transactions/types/loanset),
[LoanPay](https://xrpl.org/docs/references/protocol/transactions/types/loanpay),
[VaultCreate](https://xrpl.org/docs/references/protocol/transactions/types/vaultcreate),
[MPTs](https://xrpl.org/docs/concepts/tokens/fungible-tokens/multi-purpose-tokens),
[Payment API field names](https://xrpl.org/docs/references/protocol/transactions/types/payment).

## Integration after the completed native session

Gita requested incorporation of this session's results into the application architecture.
The registry now exports `projectMptPayment` for the Amount/DeliverMax boundary and a
durable issuer return queue. Devnet ID 2 stays in the connection context. Its signed
Payment omits NetworkID, as required for all network IDs through 1024.

The harness's `rep-restore` step now claims its credit's issuer lane, builds the exact
credit-bound Payment, validates its signed projection and persists its blob in the
registry before submission. Unknown outcomes retain the credit and lane. Native return
verification checks every prepared field, including the credit memo. Registry settlement
marks the credit PAID and attempt VALIDATED in the same transaction.

The two public native runs above used the prior standalone private attempt journal for
their return. They remain valid evidence for REP and lending behavior. They do not prove
the newer shared return-queue integration. A fresh native run of the updated harness is
NOT RUN in this integration pass. No stateful ledger command was repeated.

The root suite now includes tests against the completed clean-run public capture.
Run the 37 separate fixture tests with the normal build/type checks. Native default,
Vedant's required signer and UI acceptance remain open.
