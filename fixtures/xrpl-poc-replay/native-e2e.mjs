import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { APPROVED_REP_POLICY_HASH, assertSupportedSqliteRuntime, contentHash,
  createRegistry, createExecutionStore, createReturnStore, projectMptPayment, quoteRepBondU } from "../../packages/registry/dist/index.js";
import { createRepIssuance, issueRep, redeemRep, restoreRep, readRepState } from "./native-rep.mjs";
import { getValidatedTx, nativeEvidence, ledgerUnix, createdNode,
  mptBalanceChange, loanPrincipalChange, completeLoanHistory } from "./native-ledger.mjs";

const requireXrpl = createRequire(new URL("../../packages/xrpl/package.json", import.meta.url));
const requireApi = createRequire(new URL("../../services/api/package.json", import.meta.url));
const xrpl = requireXrpl("xrpl");
const folder = fileURLToPath(new URL("./", import.meta.url));
const endpoint = "wss://s.devnet.rippletest.net:51233";
const epoch = Date.UTC(2000, 0, 1) / 1000;
const principalUnits = "1000";
const principalMinor = "100000";
const bondU = "240000000";

export const nativePlan = {
  scope: "Standalone native REP, loan and registry E2E fixture. No production adapter or UI acceptance.",
  network: "devnet", network_id: 2, endpoint,
  accounts: "Four fresh faucet-funded test accounts, independent of Vedant's POC",
  assets: "Own test USD MPT and separate nontransferable REP MPT",
  principal_native_units: principalUnits, principal_minor: principalMinor,
  original_bond_u: bondU, seed_rep_u: "1000000000",
  rate_native: 5500, payment_total: 1, payment_interval_seconds: 2592000,
  origination_fee_native_units: "100", service_fee_native_units: "10",
  repayment_maximum_native_units: "2000",
  signing: "Fixture-only exact-action gate, borrower and broker signatures, no Vedant keys",
  persistence: "Private wallets and signed attempts in ignored data/run-id with restricted permissions",
  release: "No commit, push, deployment, Mainnet transaction or existing wallet use",
};

async function validatedLedger(client) {
  const { result } = await client.request({ command: "ledger", ledger_index: "validated", transactions: false });
  assert.equal(result.validated, true);
  return { index: Number(result.ledger_index ?? result.ledger.ledger_index),
    rippleTime: Number(result.ledger.close_time), unixTime: Number(result.ledger.close_time) + epoch };
}

function issuanceId(tx) {
  const id = tx.meta.mpt_issuance_id;
  assert.match(id ?? "", /^[A-Fa-f0-9]{48}$/, "Validated creation must identify the MPT issuance");
  return id.toUpperCase();
}

function txJson(tx) { return tx.tx_json ?? tx; }
function normalizedSnapshot(registry, binding) {
  const { portfolioKey: _key, ...state } = registry.getPortfolio(binding);
  return state;
}

/** Stateful Devnet test. The CLI requires --run-native. Never imports Vedant's application adapter. */
export async function runNativeE2e({ progress = message => process.stdout.write(`${message}\n`), resume } = {}) {
  assertSupportedSqliteRuntime();
  assert.equal(requireXrpl("xrpl/package.json").version, "5.3.0");
  if (resume) assert.match(resume, /^\d{4}-\d{2}-\d{2}T[0-9TZ-]+-[a-f0-9]{8}$/);
  const runId = resume ?? new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8);
  const privateDir = resolve(folder, "data", runId);
  const reportFile = resolve(folder, `native-result-${runId}.json`);
  const previous = resume ? JSON.parse(readFileSync(reportFile, "utf8")) : null;
  // Resume a known pre-loan state with the retained database. Never reconstruct a burned reservation.
  if (resume) {
    assert.equal(previous.pending_attempt, null, "An unresolved signed attempt needs reconciliation, not setup replay");
    assert.equal(previous.transactions.some(t => t.label === "loan-originate"), false,
      "Resume after origination requires explicit servicing reconciliation");
    if (previous.transactions.some(t => t.label === "rep-redeem")) {
      assert.ok(existsSync(resolve(privateDir, "registry.db")), "A redeemed stake requires its retained registry database");
    }
  }
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  const secretFile = resolve(privateDir, "secrets.json");
  const savedWallets = resume ? JSON.parse(readFileSync(secretFile, "utf8")) : null;
  const wallets = Object.fromEntries(["broker", "usdIssuer", "borrower", "repIssuer"].map(role =>
    [role, savedWallets ? xrpl.Wallet.fromSeed(savedWallets[role].seed) : xrpl.Wallet.generate()]));
  if (!resume) writeFileSync(secretFile, JSON.stringify(Object.fromEntries(Object.entries(wallets)
    .map(([role, wallet]) => [role, { address: wallet.classicAddress, seed: wallet.seed }]))), { mode: 0o600, flag: "wx" });
  const client = new xrpl.Client(endpoint, { connectionTimeout: 15000, timeout: 30000 });
  const report = previous ?? { run_id: runId, plan: nativePlan, mode: "LIVE_DEVNET", result: "RUNNING",
    accounts: Object.fromEntries(Object.entries(wallets).map(([role, wallet]) => [role, wallet.classicAddress])),
    transactions: [], snapshots: [], native_signing_gate: "NOT_TESTED", pending_attempt: null };
  if (resume) {
    report.recovery_events ??= [];
    report.recovery_events.push({ at: new Date().toISOString(), prior_result: report.result, error: report.error });
    delete report.error;
    report.result = "RUNNING";
  }
  const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  let db;
  let registry;
  let execution;
  let returns;
  let returnGuard;
  let guard;
  let phase;
  let phaseCommitment;
  let requestHash;
  let request;
  let registryClock;
  let requiredSignerCalls = 0;
  const nativeProofs = new Map();
  const journal = new Map();

  async function executeSigned(signed, prepared, label) {
    assert.equal(journal.has(label), false, "Do not sign a replacement for an unresolved attempt");
    const attempt = { label, hash: signed.hash, blob: signed.tx_blob, prepared, status: "PERSISTED" };
    journal.set(label, attempt);
    writeFileSync(resolve(privateDir, `${label}.json`), JSON.stringify(attempt), { mode: 0o600, flag: "wx" });
    if (phase) execution.persistAttempt(guard, { phase, attemptHash: signed.hash, signedBlob: signed.tx_blob,
      sequence: prepared.Sequence, lastLedgerSequence: prepared.LastLedgerSequence, commitment: phaseCommitment });
    report.pending_attempt = { label, hash: signed.hash, last_ledger_sequence: prepared.LastLedgerSequence };
    save();
    progress(`Submitting ${label}`);
    try {
      if (phase) execution.markAttemptState(guard, phase, "SUBMITTED");
      await client.submitAndWait(signed.tx_blob);
      const tx = await getValidatedTx(client, signed.hash);
      attempt.status = "VALIDATED";
      writeFileSync(resolve(privateDir, `${label}.json`), JSON.stringify(attempt), { mode: 0o600 });
      if (phase) execution.markAttemptState(guard, phase, "VALIDATED");
      report.transactions.push({ label, ...nativeEvidence(tx), ledgerHash: tx.ledger_hash,
        closeTime: tx.close_time_iso, explorer: `https://devnet.xrpl.org/transactions/${tx.hash}`, evidence: tx });
      report.pending_attempt = null;
      save();
      progress(`${label}: validated tesSUCCESS ${tx.hash}`);
      return tx;
    } catch (error) {
      attempt.status = "RECONCILING";
      writeFileSync(resolve(privateDir, `${label}.json`), JSON.stringify(attempt), { mode: 0o600 });
      if (phase) execution.markAttemptState(guard, phase, "RECONCILING");
      throw error;
    }
  }

  async function submit(wallet, transaction, label) {
    const existing = resolve(privateDir, `${label}.json`);
    if (resume && existsSync(existing)) {
      const attempt = JSON.parse(readFileSync(existing, "utf8"));
      assert.equal(attempt.status, "VALIDATED", "Only conclusively validated setup steps can be reused");
      const confirmed = await getValidatedTx(client, attempt.hash);
      const old = txJson(confirmed);
      for (const [key, value] of Object.entries(transaction)) {
        const observed = key === "Amount" && old.TransactionType === "Payment" ? old.DeliverMax ?? old.Amount : old[key];
        assert.deepEqual(observed, value, `Saved setup differs: ${label}.${key}`);
      }
      progress(`Reusing validated ${label} ${confirmed.hash}`);
      return confirmed;
    }
    const tx = structuredClone(transaction);
    if (label === "rep-redeem") tx.Memos = [{ Memo: { MemoType: xrpl.convertStringToHex("shellfish-request"), MemoData: xrpl.convertStringToHex(requestHash) } }];
    if (label === "rep-restore") {
      assert.ok(returnGuard?.acquired, "Issuer return requires the credit's durable lane");
      const instruction = returns.getReturnInstruction(returnGuard.creditId);
      assert.deepEqual(projectMptPayment(tx), { sender: instruction.issuer, destination: instruction.destination,
        issuanceId: instruction.repAsset.mpt_issuance_id, amountU: instruction.amountU });
      assert.equal(wallet.classicAddress, instruction.issuer);
      // This harness refuses post-origination resume. Recovery uses the saved store
      // and never signs a new return for an unresolved credit.
      assert.equal(returns.getReturnAttempt(returnGuard.creditId), null, "Reconcile the existing return, never sign a replacement");
      const first = await validatedLedger(client);
      const filled = JSON.parse(JSON.stringify(await client.autofill(tx)));
      const prepared = returns.prepareReturnPayment(returnGuard, { sequence: filled.Sequence,
        lastLedgerSequence: filled.LastLedgerSequence, feeDrops: filled.Fee,
        signingPubKey: wallet.publicKey, networkId: 2 });
      const signed = wallet.sign(prepared);
      const { TxnSignature, ...projection } = xrpl.decode(signed.tx_blob);
      assert.ok(TxnSignature);
      assert.deepEqual(projection, prepared);
      assert.equal(xrpl.hashes.hashSignedTx(signed.tx_blob), signed.hash);
      const saved = returns.persistReturnAttempt(returnGuard, { attemptHash: signed.hash, signedBlob: signed.tx_blob,
        firstLedgerSequence: first.index, preparedFields: prepared });
      returns.markReturnUncertain(returnGuard, saved.attemptHash, "SUBMITTED");
      try {
        return await executeSigned({ hash: saved.attemptHash, tx_blob: saved.signedBlob }, saved.preparedFields, label);
      } catch (error) {
        returns.markReturnUncertain(returnGuard, saved.attemptHash, "RECONCILING");
        throw error;
      }
    }
    const prepared = await client.autofill(tx);
    return executeSigned(wallet.sign(prepared), prepared, label);
  }

  async function verifyNativeEvent(event, binding) {
    const tx = await getValidatedTx(client, event.native.txHash);
    assert.deepEqual(event.native, nativeEvidence(tx));
    assert.equal(event.occurredAt, ledgerUnix(tx));
    assert.equal(binding.network, "devnet");
    assert.equal(binding.borrowerAccount, wallets.borrower.classicAddress);
    const proof = nativeProofs.get(tx.hash);
    assert.ok(proof, "Native event needs an independently checked fixture proof");
    const json = txJson(tx);
    if (event.kind === "STAKE_VALIDATED") {
      assert.equal(proof.kind, "STAKE");
      assert.equal(json.Account, binding.borrowerAccount);
      assert.equal(json.Destination, binding.repAsset.issuer);
      assert.deepEqual(json.DeliverMax ?? json.Amount, { mpt_issuance_id: binding.repAsset.mpt_issuance_id, value: bondU });
      assert.equal(json.Memos[0].Memo.MemoData, xrpl.convertStringToHex(requestHash));
      assert.equal(event.stake.requestHash, requestHash);
      assert.equal(proof.after.holderAmountU, "760000000");
    } else if (event.kind === "ORIGINATION_VALIDATED") {
      assert.equal(proof.kind, "ORIGIN");
      for (const [key, value] of Object.entries(proof.prepared)) assert.deepEqual(json[key], value, `Changed authorized field: ${key}`);
      const loan = createdNode(tx, "Loan");
      assert.equal(event.loan.loanId, loan.id);
      assert.equal(loan.fields.Borrower, binding.borrowerAccount);
      assert.equal(loan.fields.PrincipalOutstanding, principalUnits);
    } else if (event.kind === "REPAYMENT") {
      assert.equal(proof.kind, "REPAYMENT");
      const change = loanPrincipalChange(tx, event.loanId);
      assert.equal(event.repayment.principalReductionMinor, (BigInt(change.reduction) * 100n).toString());
      assert.equal(event.repayment.fullContractualRepayment, change.fullContractualRepayment);
      const history = await completeLoanHistory(client, event.loanId, proof.originTx, tx);
      assert.equal(history.coverage.complete, true);
      assert.equal(history.events.length, 2);
      assert.equal(history.previousEventHash, proof.originTx.hash);
      assert.equal(event.history.originHash, proof.originTx.hash);
      assert.equal(event.history.previousEventId, `devnet:${proof.originTx.hash}`);
      assert.equal(event.repayment.onTime, ledgerUnix(tx) <= proof.maturity);
    } else if (event.kind === "RETURN_VALIDATED") {
      assert.equal(proof.kind, "RETURN");
      const credit = registry.getReturnCredits(binding).find(c => c.creditId === event.creditId);
      assert.ok(credit);
      assert.equal(json.Account, binding.repAsset.issuer);
      assert.equal(json.Destination, binding.borrowerAccount);
      assert.deepEqual(json.DeliverMax ?? json.Amount, { mpt_issuance_id: binding.repAsset.mpt_issuance_id, value: credit.amountU });
      assert.equal(event.returned.amountU, credit.amountU);
      assert.ok(binding.returnAttempt, "Return needs the persisted issuer attempt");
      assert.equal(binding.returnAttempt.attemptHash, tx.hash);
      assert.equal(binding.returnCredit.creditId, credit.creditId);
      for (const [field, value] of Object.entries(binding.returnAttempt.preparedFields)) {
        const observed = field === "Amount" ? json.DeliverMax ?? json.Amount : json[field];
        assert.deepEqual(observed, value, `Changed issuer-return field: ${field}`);
      }
    } else assert.fail(`Unsupported native fixture event: ${event.kind}`);
  }

  async function apply(kind, tx, details, binding, label) {
    registryClock = Math.max(registryClock, ledgerUnix(tx));
    const event = { eventId: `devnet:${tx.hash}`, kind, occurredAt: ledgerUnix(tx), native: nativeEvidence(tx), ...details };
    await registry.applyEvent(event);
    const after = normalizedSnapshot(registry, binding);
    await registry.applyEvent(event);
    assert.deepEqual(normalizedSnapshot(registry, binding), after, "Duplicate native delivery changed balances");
    report.snapshots.push({ step: label, ...after });
    save();
    return event;
  }

  try {
    save();
    await client.connect();
    const server = (await client.request({ command: "server_info" })).result.info;
    assert.equal(server.network_id, 2, "Only Devnet network ID 2 is permitted");
    report.server = { network_id: server.network_id, build_version: server.build_version };
    const features = Object.values((await client.request({ command: "feature" })).result.features);
    for (const name of ["MPTokensV1", "SingleAssetVault", "LendingProtocol", "LendingProtocolV1_1", "DynamicMPT"]) {
      assert.equal(features.find(f => f.name === name)?.enabled, true, `Missing native feature: ${name}`);
    }
    if (!report.faucet_funded) {
      progress("Funding one fresh Devnet account through the faucet");
      await client.fundWallet(wallets.broker, { faucetHost: "faucet.devnet.rippletest.net", faucetPath: "/accounts",
        amount: "1000", usageContext: "Shellfish isolated REP and native loan E2E fixture" });
    }
    report.faucet_funded = true;
    save();
    for (const role of ["usdIssuer", "borrower", "repIssuer"]) {
      await submit(wallets.broker, { TransactionType: "Payment", Account: wallets.broker.classicAddress,
        Destination: wallets[role].classicAddress, Amount: xrpl.xrpToDrops("25") }, `fund-${role}`);
    }
    const usdCreate = await submit(wallets.usdIssuer, { TransactionType: "MPTokenIssuanceCreate", Account: wallets.usdIssuer.classicAddress,
      AssetScale: 0, MaximumAmount: "1000000", Flags: 32 }, "usd-create");
    const usdId = issuanceId(usdCreate);
    report.loan_asset = { mpt_issuance_id: usdId, issuer: wallets.usdIssuer.classicAddress, asset_scale: 0 };
    for (const role of ["broker", "borrower"]) {
      await submit(wallets[role], { TransactionType: "MPTokenAuthorize", Account: wallets[role].classicAddress,
        MPTokenIssuanceID: usdId }, `usd-authorize-${role}`);
      await submit(wallets.usdIssuer, { TransactionType: "Payment", Account: wallets.usdIssuer.classicAddress,
        Destination: wallets[role].classicAddress, Amount: { mpt_issuance_id: usdId, value: role === "broker" ? "100000" : "2500" } }, `usd-fund-${role}`);
    }
    const rep = await createRepIssuance({ client, issuer: wallets.repIssuer, borrower: wallets.borrower, submit });
    const seeded = await issueRep({ client, issuer: wallets.repIssuer, borrower: wallets.borrower, issuanceId: rep.issuanceId, submit });
    report.rep_asset = { mpt_issuance_id: rep.issuanceId, issuer: wallets.repIssuer.classicAddress, asset_scale: 6 };
    const ledger = await validatedLedger(client);
    const savedVaultFile = resolve(privateDir, "vault-create.json");
    const subscription = resume && existsSync(savedVaultFile)
      ? JSON.parse(readFileSync(savedVaultFile, "utf8")).prepared.SubscriptionDate : ledger.rippleTime + 90;
    const vaultTx = await submit(wallets.broker, { TransactionType: "VaultCreate", Account: wallets.broker.classicAddress,
      Asset: { mpt_issuance_id: usdId }, VaultKind: 1, SubscriptionDate: subscription,
      RedemptionDate: subscription + 60 * 86400, Flags: 0 }, "vault-create");
    const vault = createdNode(vaultTx, "Vault");
    await submit(wallets.broker, { TransactionType: "VaultDeposit", Account: wallets.broker.classicAddress,
      VaultID: vault.id, Amount: { mpt_issuance_id: usdId, value: "100000" } }, "vault-deposit");
    const brokerTx = await submit(wallets.broker, { TransactionType: "LoanBrokerSet", Account: wallets.broker.classicAddress,
      VaultID: vault.id, ManagementFeeRate: 0, CoverRateMinimum: 0, CoverRateLiquidation: 0 }, "broker-create");
    const broker = createdNode(brokerTx, "LoanBroker");
    report.vault_id = vault.id;
    report.broker_id = broker.id;
    progress("Waiting for this test vault's Investment phase");
    const investmentDeadline = Date.now() + 180000;
    let current;
    do {
      assert.ok(Date.now() < investmentDeadline, "Devnet did not reach Investment within the test deadline");
      current = await validatedLedger(client); if (current.rippleTime < subscription) await delay(2000);
    } while (current.rippleTime < subscription);
    registryClock = current.unixTime;
    const Database = requireApi("better-sqlite3");
    db = new Database(resolve(privateDir, "registry.db"));
    registry = createRegistry(db, { now: () => new Date(registryClock * 1000), verifyNativeEvent,
      verifyNativePortfolio: async (seed, borrower, evidence) => {
        assert.equal(evidence.seed_tx_hash, seeded.tx.hash);
        assert.equal(borrower, wallets.borrower.classicAddress);
        assert.equal(seed.rep_asset.mpt_issuance_id, rep.issuanceId);
        const state = await readRepState({ client, issuanceId: rep.issuanceId, issuer: wallets.repIssuer, holder: wallets.borrower });
        assert.equal(state.holderAmountU, seed.opening.reputation.available_u);
        const objects = (await client.request({ command: "account_objects", account: borrower, ledger_index: "validated" })).result;
        assert.equal(objects.marker, undefined, "Fresh borrower inventory must be fully covered");
        assert.equal(objects.account_objects.filter(o => o.LedgerEntryType === "Loan").length, 0);
      } });
    const principalId = `devnet:${wallets.borrower.classicAddress}`;
    const facilityId = `devnet:${broker.id}`;
    const binding = { principalId, network: "devnet", asset: { mpt_issuance_id: usdId } };
    const opening = { active_principal_minor: "0", reserved_principal_minor: "0", defaulted_principal_minor: "0",
      facility_committed_minor: "0", facility_reserved_minor: "0", reputation: { seed_u: "1000000000", available_u: "1000000000",
        reserved_u: "0", bonded_u: "0", pending_return_u: "0", growth_u: "0", forfeited_u: "0", suspended: false, version: 1 } };
    let installed = false;
    try { registry.getPortfolio(binding); installed = true; } catch (error) { if (error.code !== "NOT_FOUND") throw error; }
    if (!installed) await registry.initializeNativePortfolio({ contract_version: "C0-REP-1", model_version: "REP-CURVE-v0.2", network: "devnet",
      mode: "LIVE_DEVNET", scenario_id: runId, clock: new Date(registryClock * 1000).toISOString(), money_scale: 100, rep_scale: 1000000,
      principal_id: principalId, loan_asset: binding.asset, rep_asset: report.rep_asset, policy_hash: APPROVED_REP_POLICY_HASH,
      evidence_version: runId, facility: { facility_id: facilityId, lender_id: wallets.broker.classicAddress,
        asset: binding.asset, limit_minor: "10000000", version: 1 }, opening, opening_loans: [] }, wallets.borrower.classicAddress,
    { seed_tx_hash: seeded.tx.hash });
    const terms = { principal: principalUnits, rate: 5500, payment_total: 1, interval: 2592000,
      origination_fee: "100", service_fee: "10", broker_id: broker.id, asset: binding.asset };
    request = { request_id: `devnet:request:${runId}`, idempotency_key: runId, contract_version: "C0-REP-1", mode: "LIVE_DEVNET",
      principal_id: principalId, agent_id: `fixture:${runId}`, mandate_id: `fixture:mandate:${runId}`, nonce: randomUUID(),
      offer_id: `fixture:offer:${runId}`, facility_id: facilityId, network: "devnet", asset: binding.asset,
      mandate_hash: contentHash({ borrower: wallets.borrower.classicAddress, terms, max_stake_u: bondU }),
      rep_asset: report.rep_asset, evidence_hash: contentHash({ seed: seeded.tx.hash, principal: principalId }),
      commercial_terms_hash: contentHash(terms), model_version: "REP-CURVE-v0.2", policy_hash: APPROVED_REP_POLICY_HASH,
      principal_minor: principalMinor, max_stake_u: bondU, expires_at: new Date((registryClock + 600) * 1000).toISOString() };
    try { request = registry.getRequest(request.request_id).request; } catch (error) { if (error.code !== "NOT_FOUND") throw error; }
    requestHash = contentHash(request);
    assert.equal(quoteRepBondU(0n, BigInt(principalMinor), 100n).toString(), bondU);
    const reservation = registry.reserveRequest(request);
    assert.equal(reservation.originalBondU, bondU);
    report.snapshots.push({ step: "reserved", ...normalizedSnapshot(registry, binding) });
    execution = createExecutionStore(db, { now: () => new Date(registryClock * 1000) });
    returns = createReturnStore(db);
    guard = execution.claimExecution(request.request_id, `fixture:${runId}`);
    assert.equal(guard.acquired, true);
    phase = "STAKE";
    phaseCommitment = requestHash;
    const redeemed = await redeemRep({ client, issuer: wallets.repIssuer, borrower: wallets.borrower, issuanceId: rep.issuanceId, amountU: bondU, submit });
    nativeProofs.set(redeemed.tx.hash, { kind: "STAKE", ...redeemed });
    await apply("STAKE_VALIDATED", redeemed.tx, { requestId: request.request_id, stake: { amountU: bondU,
      repAsset: report.rep_asset, sender: wallets.borrower.classicAddress, destination: wallets.repIssuer.classicAddress,
      requestHash, partialPayment: false } }, binding, "rep-redeemed");
    phase = undefined;
    const prepared = JSON.parse(JSON.stringify(await client.autofill({ TransactionType: "LoanSet", Account: wallets.broker.classicAddress,
      Counterparty: wallets.borrower.classicAddress, LoanBrokerID: broker.id, PrincipalRequested: principalUnits,
      InterestRate: 5500, PaymentTotal: 1, PaymentInterval: 2592000, GracePeriod: 604800,
      LoanOriginationFee: "100", LoanServiceFee: "10", Flags: 0 })));
    function authorizeLoan(fields) {
      const r = registry.getRequest(request.request_id);
      assert.equal(r.state, "STAKE_VALIDATED");
      assert.equal(r.stakeHash, redeemed.tx.hash);
      assert.equal(registry.getPortfolio(binding).reputation.suspended, false);
      assert.deepEqual(fields, prepared, "Exact prepared loan must match the approved action");
      assert.equal(fields.PrincipalRequested, principalUnits);
      assert.equal(fields.LoanBrokerID, broker.id);
      assert.equal(fields.Counterparty, wallets.borrower.classicAddress);
      assert.ok(registryClock * 1000 < Date.parse(request.expires_at));
      const commitment = execution.freezePreparedAction(guard, { commercialTermsHash: request.commercial_terms_hash, preparedFields: fields });
      requiredSignerCalls += 1;
      return { signed: xrpl.signLoanSetByCounterparty(wallets.borrower, wallets.broker.sign(fields).tx_blob), commitment };
    }
    assert.throws(() => authorizeLoan({ ...prepared, PrincipalRequested: "2000" }), /Exact prepared loan/);
    assert.equal(requiredSignerCalls, 0);
    const authorized = authorizeLoan(prepared);
    phase = "LOAN";
    phaseCommitment = authorized.commitment;
    const originTx = await executeSigned(authorized.signed, prepared, "loan-originate");
    phase = undefined;
    const loan = createdNode(originTx, "Loan");
    const maturity = loan.fields.NextPaymentDueDate + epoch;
    nativeProofs.set(originTx.hash, { kind: "ORIGIN", prepared });
    const originEvent = await apply("ORIGINATION_VALIDATED", originTx, { requestId: request.request_id,
      loan: { loanId: loan.id, maturityAt: maturity, nextPaymentDueAt: maturity, graceSeconds: 604800 } }, binding, "loan-originated");
    report.loan_id = loan.id;
    report.native_signing_gate = "PASS_CHANGED_PRINCIPAL_DENIED_BEFORE_SIGNATURE";
    report.required_signer_calls = requiredSignerCalls;
    const start = loan.fields.StartDate;
    const loanStartDeadline = Date.now() + 60000;
    do {
      assert.ok(Date.now() < loanStartDeadline, "Devnet did not reach the loan start within the test deadline");
      current = await validatedLedger(client); if (current.rippleTime < start + 4) await delay(1000);
    } while (current.rippleTime < start + 4);
    const payTx = await submit(wallets.borrower, { TransactionType: "LoanPay", Account: wallets.borrower.classicAddress,
      LoanID: loan.id, Amount: { mpt_issuance_id: usdId, value: "2000" }, Flags: 0 }, "loan-repay");
    const change = loanPrincipalChange(payTx, loan.id);
    const borrowerChange = mptBalanceChange(payTx, wallets.borrower.classicAddress, usdId);
    assert.equal(change.reduction, principalUnits);
    assert.equal(change.fullContractualRepayment, true);
    const history = await completeLoanHistory(client, loan.id, originTx, payTx);
    nativeProofs.set(payTx.hash, { kind: "REPAYMENT", originTx, maturity });
    await apply("REPAYMENT", payTx, { requestId: request.request_id, loanId: loan.id,
      repayment: { principalReductionMinor: (BigInt(change.reduction) * 100n).toString(), fullContractualRepayment: true,
        onTime: ledgerUnix(payTx) <= maturity }, history: { complete: true, originHash: originTx.hash, previousEventId: originEvent.eventId } }, binding, "loan-repaid-return-pending");
    const credits = registry.getReturnCredits(binding);
    assert.equal(credits.length, 1);
    const credit = credits[0];
    assert.equal(credit.state, "OWED");
    assert.equal(registry.getPortfolio(binding).reputation.available_u, "760000000");
    returnGuard = returns.claimReturn(credit.creditId, `fixture-return:${runId}`);
    assert.equal(returnGuard.acquired, true);
    const restored = await restoreRep({ client, issuer: wallets.repIssuer, borrower: wallets.borrower,
      issuanceId: rep.issuanceId, amountU: credit.amountU, submit });
    nativeProofs.set(restored.tx.hash, { kind: "RETURN", ...restored });
    await apply("RETURN_VALIDATED", restored.tx, { requestId: request.request_id, loanId: loan.id, creditId: credit.creditId,
      returned: { amountU: credit.amountU, repAsset: report.rep_asset, sender: wallets.repIssuer.classicAddress,
        destination: wallets.borrower.classicAddress, partialPayment: false } }, binding, "rep-restored");
    const final = registry.getPortfolio(binding);
    assert.equal(final.active_principal_minor, "0");
    assert.equal(final.reserved_principal_minor, "0");
    assert.equal(final.reputation.pending_return_u, "0");
    assert.equal(final.reputation.available_u, restored.after.holderAmountU);
    assert.equal(registry.getRequest(request.request_id).state, "REPAID");
    assert.equal(returns.getReturnAttempt(credit.creditId).state, "VALIDATED");
    report.issuer_return_queue = "PERSISTED_BEFORE_SUBMISSION_AND_SETTLED_ATOMICALLY";
    report.repayment = { submitted_maximum_native_units: "2000", actual_debit_native_units: (-BigInt(borrowerChange.delta)).toString(),
      principal_reduction_native_units: change.reduction, elapsed_ledger_seconds: ledgerUnix(payTx) - ledgerUnix(originTx),
      original_bond_u: bondU, growth_u: credit.growthU, returned_u: credit.amountU, history_coverage: history.coverage };
    report.final = normalizedSnapshot(registry, binding);
    report.duplicate_delivery = "PASS";
    report.result = "PASS";
    report.acceptance_boundary = "Fresh native REP issuance/redemption/return, native LoanSet/LoanPay, exact fixture signing gate and Gita registry. Lender underwriting, production mandate verification, Vedant adapter and UI remain outside this check.";
    execution.releaseExecution(guard);
    save();
    progress(`Native E2E PASS. Public result: ${reportFile}`);
    return { reportFile, report };
  } catch (error) {
    report.result = report.pending_attempt ? "RECONCILING" : "FAIL";
    report.error = String(error.message).replace(/s[A-Za-z0-9]{20,}/g, "[redacted]");
    save();
    progress(`Native E2E ${report.result}. Public result: ${reportFile}`);
    throw error;
  } finally {
    if (returnGuard?.acquired) returns.releaseReturnWorker(returnGuard);
    if (db) db.close();
    if (client.isConnected()) await client.disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--run-native")) process.stdout.write(JSON.stringify(nativePlan, null, 2) + "\n");
  else {
    try { await runNativeE2e({ resume: process.argv.includes("--resume") ? process.argv[process.argv.indexOf("--resume") + 1] : undefined }); }
    catch { process.stderr.write("Native test stopped. Inspect its public result and retain private attempts for reconciliation.\n"); process.exitCode = 1; }
  }
}
