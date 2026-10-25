# @shellfish/registry

Owner: Gita. Implementation follows REP-CURVE-v0.2 and the C0-REP-1 fixture patch.
Consumer acceptance and native adapter integration remain with Vedant.

## Implemented boundary

- Exact BigInt bond quotations, capacity search and principal-time rewards.
- SQLite immediate transactions for joint facility/REP reservation and nonce consumption.
- Exposure across all participating facilities for one principal, network and asset.
- One initial REP allocation per enrolled principal/network and wallet.
- Persistent requests, original per-loan bonds, events, reward awards and return credits.
- Stake binding, origination, repayment, impairment, default and issuer-return transitions.
- Exact retry/conflict handling and ordered loan-history requirements.
- Single-executor claims, fencing, immutable signed STAKE/LOAN attempts and prepared-field commitments.
- Durable REP return attempts, issuer-wide serialization, verified replacement and atomic return settlement.

No function here signs, submits or fetches native transactions. Native portfolio sync and
outcomes fail closed until the trusted adapter callbacks are installed. They are internal
service boundaries. Do not expose caller-provided verification Booleans over HTTP.

## Runtime and storage

The selected runtime is Node 24.21.0 with better-sqlite3 12.10.1 and XRPL.js 5.3.0.
Node 20 reached end of life on 2026-04-30. It was used only to isolate the old binding
failure during development. The old locked SQLite 11.10.0 crashed under Node 24.
The reviewed SQLite 12.10.1 pairing passes the same registry tests under Node 24.
The runtime guard checks the selected Node line and binding version before SQL work.
Tests use real temporary HTTP servers and avoid the old test-injector mismatch.
Runtime, SDK and database pins are local changes for coordinator review. No native
transaction or release is implied by the version update.

`createRegistry(db, options)` initializes the owned credit tables. Legacy API tables remain
intact. `services/api/src/db/init.ts` initializes both. Use the explicit
`openCreditRegistry(path, options)` helper in the API's `src/db/registry.ts` for bootstrap.
The caller owns close, clock and trusted native verifiers. No user database is initialized
by importing a package. Tests use in-memory and temporary file databases.

All economic values are exact integer strings in storage. The curve functions use BigInt.
Amounts are never calculated with SQLite REAL or JavaScript floating point.

## Consumer API

```ts
const { registry, execution, returns, close } = openCreditRegistry(dbPath, { now });
registry.seedScenario(scenario, mandate.xrpl_borrower); // explicit synthetic setup only

// Vedant verifies mandate, signatures, evidence, firm offer and exact commercial terms.
const reservation = registry.reserveRequest(verifiedRequest);
const guard = execution.claimExecution(reservation.requestId, uniqueExecutorId);
if (!guard.acquired) return registry.getRequest(reservation.requestId);

// Build/sign outside SQL. Decode and verify before persistence. Submit only the saved blob.
const savedStake = execution.persistAttempt(guard, signedStakeAttempt);
await registry.applyEvent(verifiedStakeEvent);

// Autofill LoanSet after the stake Payment, then freeze every non-signature field.
const commitment = execution.freezePreparedAction(guard, {
  commercialTermsHash: verifiedRequest.commercial_terms_hash,
  preparedFields: finalizedLoanSetFields,
});
const savedLoan = execution.persistAttempt(guard, { ...signedLoanAttempt, commitment });
await registry.applyEvent(verifiedOriginationEvent);
execution.releaseExecution(guard);
```

The snippet shows interfaces, not a transaction runner. In production, release the guard
in a finally path after persisting the actual outcome or unresolved state. Another worker
cannot take over an active claim by timeout. A recovery needs an explicitly acknowledged
release or restoration of the same executor identity, with the former worker stopped.
Native blob decoding, transaction hash correctness and exact approved-field projection
remain Vedant's adapter responsibilities. Signing must use the same frozen projection.

An exact request key/payload retry returns the existing state, including after expiry.
A changed payload under the key fails. New requests cannot reuse a consumed nonce or
one-use mandate. Origination consumes the existing reservation. It never reserves twice.

A saved signed attempt is immutable. A resumed executor returns the same hash/blob after
expiry or lifecycle progress. Marking it FAILED/RECONCILING changes no facility or REP
balance. Only a conclusive verified accounting event releases or commits capacity.
Signed blobs stay internal. The Gita HTTP routes expose no signing or event-mutation API.

## Native adapter requirements

`initializeNativePortfolio(seed, borrowerAccount, evidence)` requires
`verifyNativePortfolio`. The adapter verifies the principal mapping, loan asset, REP
issuance and flags, exact holder balance, facility, opening loans and original bonds.
This initial native sync supports a verified empty portfolio. Existing native obligations
are rejected until a verified opening-history contract is agreed. Never omit that exposure
or invent synthetic original bonds for native loans. Synthetic fixtures retain their
explicit opening loans for accounting tests.

`applyEvent(event)` calls `verifyNativeEvent(event, binding)` outside the database transaction
for native final events. The callback verifies the network, transaction result, parties,
actual delivered REP, native Loan ID, principal reduction and event time. It must verify
complete ordered ledger history and the next relevant event, not merely a Boolean.
`history.previousEventId` and `originHash` must match the persisted loan cursor.
Final repayment must include all contractual principal, interest and fees.

Persist next payment due time separately from maturity. Default waits until the verified
due date plus grace has passed. A validated origination is recorded after another loan
suspends the principal. Suspension prevents new authorization, not recording a real liability.

Native `IMPAIRMENT` and `UNIMPAIRMENT` events require `servicing.nextPaymentDueAt` in
Unix seconds. The trusted adapter verifies it against the post-LoanManage Loan state
and the complete ordered history. The registry persists that due date before processing
later default events. Synthetic legacy impairment events can omit the schedule.
Unimpairment needs a prior impairment and an explicit revised due date in every mode.
Neither event changes the original bond or appreciation maturity. `ever_impaired` stays
true after restoration, so it cannot erase the policy's permanent reward restriction.
This contract has local regression coverage. Native impairment/default execution is
still NOT RUN and remains an adapter integration check.

Default moves the original bond to forfeiture and preserves defaulted principal. Partial
repayment reduces exposure without releasing the bond. Return credits remain unavailable
until an exact issuer Payment is verified. Pending appreciation counts toward both caps.
Reward accrual uses ledger times. The rolling award budget uses registry credit-creation
time, so historical backfill cannot create several windows of rewards in one current day.

## REP issuer return queue

`createReturnStore(db, { verifyReturnFailure })` and the API bootstrap's `returns` export
persist return Payments before submission. The lane key covers mode, network and issuer
account across every REP issuance. Simulation and native mode use separate lanes.
One worker claims a credit. Other credits wait for that issuer's unresolved signed Payment.

```ts
const guard = returns.claimReturn(creditId, uniqueWorkerInstanceId);
if (!guard.acquired) return; // Another credit or worker owns this issuer lane.
try {
  let saved = returns.getReturnAttempt(creditId);
  if (!saved) {
    // Adapter verifies current validated account sequence, fee, network and ledger.
    const fields = returns.prepareReturnPayment(guard, {
      sequence: verifiedAccountSequence,
      lastLedgerSequence: validatedLedgerIndex + 4,
      feeDrops: verifiedFeeDrops,
      networkId: verifiedNetworkId,
    });
    const signed = trustedIssuerSigner(fields); // In Vedant's adapter, outside SQL.
    // Decode the blob, verify its hash and every field against fields before persistence.
    saved = returns.persistReturnAttempt(guard, {
      attemptHash: signed.hash,
      signedBlob: signed.tx_blob,
      firstLedgerSequence: validatedLedgerIndex,
      preparedFields: fields,
    });
  }
  // Reconcile existing attempts first. Resubmission uses this exact persisted blob.
  // NOT_APPLIED requires an explicit bounded replacement. VALIDATED is already settled.
  await trustedSubmitOrReconcile(saved);
  await registry.applyEvent(verifiedReturnEvent);
} finally {
  returns.releaseReturnWorker(guard); // false after settlement or identical cleanup.
}
```

The snippet names trusted adapter operations. It is not a transaction runner.
`prepareReturnPayment` binds issuer, borrower, exact atomic REP amount and a deterministic
credit memo. `persistReturnAttempt` commits all finalized non-signature fields plus the
credit instruction. Partial payments, paths, SendMax, DeliverMin, tickets and delegation
are rejected. The minimal projection permits Fee, Sequence, LastLedgerSequence,
SigningPubKey and NetworkID. Keep its signed blob internal.
Pass the verified numeric network ID to the builder. It omits the serialized NetworkID
for IDs 0 through 1024, including Devnet ID 2. IDs 1025 and above include it. The SDK's
basic validator alone does not establish this consensus rule. See
[transaction common fields](https://xrpl.org/docs/references/protocol/transactions/common-fields#networkid-field).

Releasing a worker preserves the lane for an unresolved attempt. A recovery can reclaim
that credit with a new fence after an acknowledged release. It cannot create a second
transaction. `SUBMITTED` and `RECONCILING` change no REP balances. Claims never expire
automatically. A missing worker needs an acknowledged recovery, not a timed takeover.

`resolveNotApplied(guard, attemptHash, evidence)` permits replacement only after the
trusted native verifier authenticates a validated `tec` failure, or expiry plus gap-free
historical absence through the saved LastLedgerSequence. The absence proof includes
the current validated ledger and unchanged issuer account sequence. A missing transaction
response or local timeout is insufficient. Unexpected sequence advancement fails closed.
The callback runs outside SQL. The final transaction rechecks credit, attempt and fence.
This follows [XRPL reliable submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission).

A validated `tec` failure consumes its account sequence and fee. Metadata still needs
verification. See [XRPL tec results](https://xrpl.org/docs/references/protocol/transactions/transaction-results/tec-codes).
After a conclusive failure, other reconciled credits can use the issuer. A replacement
reads the current validated account sequence and respects the stored sequence floor.
Keep all old attempts. At most three signed attempts are permitted per credit. Exhaustion
keeps the credit OWED for explicit operator review. It never credits available REP.

Native `RETURN_VALIDATED` requires the latest persisted attempt hash. Its verifier receives
`binding.returnCredit` and `binding.returnAttempt` with the exact prepared projection.
Verify actual delivered REP, issuer, borrower, credit memo, network and ledger result.
One immediate SQL transaction marks the credit PAID and attempt VALIDATED, moves pending
REP to available REP, records the event and clears the issuer lane. Replaying that same
event changes nothing. A return cannot predate its credit. Synthetic accounting vectors
without a saved return remain available only in explicit simulation.

The issuer signer must honor this queue for every transaction from the issuer account,
or use a dedicated issuer account. SQLite fencing cannot stop external use of its key.
No signing, ledger fetching or submission occurs in this package. Vedant owns those
operations and native failure verification. Full repayment UI stays outside this slice.

## Completed native fixture and integration boundary

The separate [native E2E report](../../fixtures/xrpl-poc-replay/RUN-REPORT.md) records a
fresh Devnet run with isolated accounts. At zero opening exposure, 1,000 units of gross
principal required 240 REP. Redemption preceded LoanSet. Full LoanPay closed the loan,
then the issuer returned 240.000008 REP after 11 seconds of principal exposure.
The final native wallet and registry each held 1,000.000008 REP. A read-only ledger
recheck is saved beside the report. Native default was not executed.

These results support the burn-and-conditional-restoration architecture. They establish
neither production authorization nor acceptance of Vedant's adapter. The principal,
30-day schedule and fees are separate from the 2,000/90-day/zero-fee C0 example.
The captured loan asset uses AssetScale 0, mapped to 100 registry minor units per native
unit. REP uses AssetScale 6 and atomic integer quantities. Never confuse these scales.

`projectMptPayment(transactionJson)` is the shared parsing boundary for an exact MPT
Payment. It accepts signed `Amount` and API v2 `DeliverMax`, rejects conflicting aliases,
partial or routed delivery and non-integer REP amounts. It returns parties, issuance
and atomic quantity. It does not authenticate a ledger event or establish delivery.
The trusted verifier still checks validated metadata plus holder and supply changes.
It rejects LoanPay, whose Amount is a maximum rather than principal reduction.

SDK-prepared objects must be normalized to their serialized JSON projection before
commitment. Optional undefined properties are not signed fields. The adapter still
checks every required commercial field and the actual decoded signed bytes.

The native harness now consumes `createReturnStore`, persists the exact issuer blob,
binds its credit memo and checks the attempt projection in `verifyNativeEvent`.
The recorded successful native runs precede that harness update. Its new return path
has passed syntax/offline checks, and the store has SQLite/SDK regression coverage.
A fresh native execution of the updated harness remains NOT RUN. Historical capture
files and private run state are preserved. No old transaction is submitted again.

## Live status and read-only quotes

`getCreditStatus(facilityId)` reads the selected facility and the principal's entire
participating portfolio in one SQLite read transaction. It returns mode, asset identities,
scales, policy, observation time, facility limits, active/reserved/defaulted principal
and every REP bucket. `exposure_for_curve_minor` equals active plus unresolved reserved
principal across all facilities. The selected facility's headroom stays separate from
the portfolio's aggregate commitments. Coverage remains participating sources only.

`quoteCredit(facilityId, { principal_minor, max_stake_u? })` computes the approved curve
from that snapshot. It reports all failed registry limits, the exact bond and the largest
additional principal within facility headroom, free REP and the optional stake cap.
Suspension returns zero borrowable principal. Bonded, reserved, pending-return and
forfeited REP never count as available REP.

```ts
const status = registry.getCreditStatus("facility-A-001");
const quote = registry.quoteCredit("facility-A-001", {
  principal_minor: "200000", // 2,000 monetary units at money_scale 100
  max_stake_u: "720000000", // 720 REP at rep_scale 1,000,000
});
// quote.bond_u === "720000000" under the initial C0 snapshot.
// quote.grants_permission === false. It reserves nothing and consumes no nonce.
```

Gita's routes expose these functions after the entrypoint injects the same registry:

| Route | Input | Output |
| --- | --- | --- |
| `GET /v1/facilities/:id/credit-status` | Facility ID | `CreditStatus` |
| `POST /v1/facilities/:id/quote` | `CreditQuoteRequest` | `CreditQuote` |

Missing registry injection returns 503. Unknown facility returns 404. Native/simulation
mode mismatch fails, including on the older facility read route. These endpoints grant
no signature, underwriting approval or reservation. The clock is the registry observation
clock. It does not assert fresh native ledger synchronization.

`fits_registry_limits` checks registry limits only. Vedant still checks mandate,
signatures, evidence, offer and exact commercial terms. Final `reserveRequest` reprices
inside an immediate transaction. A quote hash and version identify a read snapshot and
are not accepted as permission to sign. A concurrent reservation can change the bond.

The signed evidence passport stays an attested historical snapshot. The new live status
does not rewrite its content hash, issuer signature, history months or lender approval.
The UI should display the observation time for both sources. An attestor must issue a
new version before updated registry data can be presented as newly signed evidence.

## Checks and handoff

Run the workspace build before tests that start separate Node workers. Those workers use
built exports. Registry tests include two simultaneous SQLite writers, file reopen,
original-bond accounting, ordered history, failure compensation and executor fencing.
Return checks cover two competing issuer workers, reopen, unchanged retries, issuer
serialization across issuances, exact Payment binding, failure evidence, replacement
limits, asynchronous fencing and atomic final accounting.
A fixture parse or simulated event is never reported as native validation.

Vedant's next consumption points are `AtomicReservationRequest`, `reserveRequest`,
`applyEvent`, `createExecutionStore` and the two verifier hooks. His authorization and
XRPL code stays in his ownership scope. The remaining shared decisions are the native
asset/accounts/REP issuance, exact offer/schedule, signature domains and SDK/runtime pin.
