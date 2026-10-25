import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  affectedNodes, completeLoanHistory, createLedgerNativeVerifiers, deriveLoanOutcome,
  deriveOrigination, getValidatedTx, ledgerUnix, loanPrincipalChange, nativeAmountToMinor,
  nativeEvidence, type NativeBindingShape, type NativeEventShape, type NativeQueryClient,
} from "../packages/xrpl/src/native-verification.ts";
import type { AtomicReservationRequest, LenderFacilityOffer } from "../packages/schemas/src/index.ts";

const report = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/xrpl-poc-replay/native-result-2026-10-25T08-52-39-891Z-c8c11959.json"), "utf8"));
const transaction = (label: string): Record<string, any> => structuredClone(report.transactions.find((t: any) => t.label === label).evidence);
const stake = transaction("rep-redeem"), origin = transaction("loan-originate"), paid = transaction("loan-repay"), restored = transaction("rep-restore");
const originLoan = deriveOrigination(origin);
const borrower = report.accounts.borrower, broker = report.accounts.broker;
const request = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/reservation.json"), "utf8")).request as AtomicReservationRequest;
const fixtureOffer = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/offer-lender-a.json"), "utf8")) as LenderFacilityOffer;
const stakeJson = stake.tx_json;
const requestHash = Buffer.from(stakeJson.Memos[0].Memo.MemoData, "hex").toString();
const requestRecord = { requestId: "native-request", payloadHash: requestHash, originalBondU: "240000000",
  request: { ...request, principal_minor: "100000", rep_asset: report.rep_asset, asset: { mpt_issuance_id: report.loan_asset.mpt_issuance_id } } };
const binding: NativeBindingShape = { mode: "LIVE_DEVNET", network: "devnet", borrowerAccount: borrower,
  asset: requestRecord.request.asset, repAsset: report.rep_asset, request: requestRecord, returnCredit: null, returnAttempt: null };
function mock(overrides: (request: Record<string, unknown>) => unknown | undefined = () => undefined): NativeQueryClient {
  const txs = new Map([stake, origin, paid, restored].map(tx => [tx.hash, tx]));
  return { async request(raw) {
    const replacement = overrides(raw); if (replacement !== undefined) return replacement;
    if (raw.command === "server_info") return { result: { info: { network_id: 2 } } };
    if (raw.command === "tx") {
      const tx = txs.get(String(raw.transaction)); if (!tx) throw { data: { error: "txnNotFound" } };
      return { result: structuredClone(tx) };
    }
    throw new Error("UNEXPECTED_TEST_QUERY");
  } };
}
function event(kind: string, tx: Record<string, any>, extra: Partial<NativeEventShape>): NativeEventShape {
  return { eventId: `devnet:${tx.hash}`, kind, requestId: requestRecord.requestId, occurredAt: ledgerUnix(tx), native: nativeEvidence(tx), ...extra };
}
const stakeEvent = () => event("STAKE_VALIDATED", stake, { stake: { amountU: "240000000", repAsset: report.rep_asset,
  sender: borrower, destination: report.rep_asset.issuer, requestHash, partialPayment: false } });
const prepared = () => Object.fromEntries(Object.entries(origin.tx_json).filter(([key]) => !["TxnSignature", "CounterpartySignature", "hash", "date", "ledger_index"].includes(key)));
const approved = { ...fixtureOffer, lender_id: broker, borrower_id: borrower, principal: "1000.00", apr_bps: 550, term_days: 30,
  schedule: { ...fixtureOffer.schedule, payment_interval_seconds: 2592000 } };
function verifier(client = mock()) {
  return createLedgerNativeVerifiers({ client, borrowerAccount: borrower, brokerId: report.broker_id, brokerAccount: broker,
    loanAsset: binding.asset, repAsset: report.rep_asset, moneyScale: 100n, loanAssetScale: 0,
    originationFee: "100", serviceFee: "10", getApprovedOffer: () => approved,
    getPreparedFields: () => prepared(), getAttemptHash: (_id, phase) => phase === "STAKE" ? stake.hash : origin.hash,
    getLoanContext: () => ({ originHash: origin.hash, eventCursor: `devnet:${origin.hash}`, previousEventHash: origin.hash,
      maturityAt: originLoan.maturityAt, nextDueAt: originLoan.nextPaymentDueAt, graceSeconds: originLoan.graceSeconds }) });
}

describe("authenticated native ledger queries", () => {
  it("reads the queried hash, position, time and actual principal change from captured Devnet records", async () => {
    const tx = await getValidatedTx(mock(), paid.hash);
    expect(tx.hash).toBe(paid.hash);
    expect(nativeEvidence(tx).transactionType).toBe("LoanPay");
    expect(loanPrincipalChange(tx, originLoan.loanId)).toMatchObject({ reduction: "1000", fullContractualRepayment: true });
    expect(nativeAmountToMinor("1.25e3", 100n)).toBe("125000");
    expect(() => nativeAmountToMinor("0.001", 100n)).toThrow("NATIVE_PRECISION_UNSUPPORTED");
  });
  it("rejects wrong-network and a forged validated/hash response", async () => {
    await expect(getValidatedTx(mock(r => r.command === "server_info" ? { result: { info: { network_id: 0 } } } : undefined), paid.hash)).rejects.toThrow("NATIVE_NETWORK_MISMATCH");
    const fake = { ...paid, validated: false };
    await expect(getValidatedTx(mock(r => r.command === "tx" ? { result: fake } : undefined), paid.hash)).rejects.toThrow("NATIVE_NOT_VALIDATED");
    await expect(getValidatedTx(mock(r => r.command === "tx" ? { result: { ...paid, hash: "A".repeat(64) } } : undefined), paid.hash)).rejects.toThrow("NATIVE_HASH_MISMATCH");
  });
  it("checks persisted stake hash, issuer, exact burn and request memo", async () => {
    await verifier().verifyNativeEvent(stakeEvent(), binding);
    const changed = stakeEvent(); changed.stake!.requestHash = "sha256:" + "0".repeat(64);
    await expect(verifier().verifyNativeEvent(changed, binding)).rejects.toThrow("NATIVE_STAKE_COMMITMENT_MISMATCH");
    const fake = structuredClone(stake); fake.tx_json.Destination = broker;
    await expect(verifier(mock(r => r.command === "tx" ? { result: fake } : undefined)).verifyNativeEvent(stakeEvent(), binding)).rejects.toThrow("NATIVE_PAYMENT_PARTIES_MISMATCH");
  });
  it("validates all frozen origin fields and uses the created native schedule", async () => {
    await verifier().verifyNativeEvent(event("ORIGINATION_VALIDATED", origin, { loan: originLoan }), binding);
    const wrong = event("ORIGINATION_VALIDATED", origin, { loan: { ...originLoan, maturityAt: originLoan.maturityAt + 1 } });
    await expect(verifier().verifyNativeEvent(wrong, binding)).rejects.toThrow("NATIVE_LOAN_SCHEDULE_MISMATCH");
  });
  it("walks the full Loan PreviousTxnID chain and rejects a missing intermediary", async () => {
    const history = await completeLoanHistory(mock(), originLoan.loanId, origin.hash, paid.hash);
    expect(history.events.map(t => t.hash)).toEqual([origin.hash, paid.hash]);
    expect(history.coverage.complete).toBe(true);
    const broken = structuredClone(paid);
    affectedNodes(broken); broken.meta.AffectedNodes.find((n: any) => n.ModifiedNode?.LedgerEntryType === "Loan").ModifiedNode.PreviousTxnID = "E".repeat(64);
    await expect(completeLoanHistory(mock(r => r.command === "tx" && r.transaction === paid.hash ? { result: broken } : undefined), originLoan.loanId, origin.hash, paid.hash)).rejects.toMatchObject({ data: { error: "txnNotFound" } });
  });
  it("derives repayment from metadata rather than the submitted 2000-unit spending cap", async () => {
    const outcome = await deriveLoanOutcome(mock(), originLoan.loanId, paid.hash, { originHash: origin.hash,
      previousEventHash: origin.hash, eventCursor: `devnet:${origin.hash}`, maturityAt: originLoan.maturityAt,
      nextDueAt: originLoan.nextPaymentDueAt, graceSeconds: originLoan.graceSeconds });
    expect(outcome.kind).toBe("REPAYMENT");
    expect("repayment" in outcome && outcome.repayment).toMatchObject({ principalReductionMinor: "100000", fullContractualRepayment: true, onTime: true });
    const forged = event("REPAYMENT", paid, { loanId: originLoan.loanId, history: outcome.history,
      repayment: { principalReductionMinor: "200000", fullContractualRepayment: true, onTime: true } });
    await expect(verifier().verifyNativeEvent(forged, binding)).rejects.toThrow("NATIVE_REPAYMENT_MISMATCH");
  });
  it("rejects a servicing cursor that skipped a relevant native event", async () => {
    await expect(deriveLoanOutcome(mock(), originLoan.loanId, paid.hash, { originHash: origin.hash,
      previousEventHash: "A".repeat(64), eventCursor: "missed", maturityAt: originLoan.maturityAt,
      nextDueAt: originLoan.nextPaymentDueAt, graceSeconds: originLoan.graceSeconds })).rejects.toThrow("NATIVE_HISTORY_CURSOR_GAP");
  });
  it("binds issuer return to the saved attempt and actual delivered REP", async () => {
    const json = restored.tx_json, fields = Object.fromEntries(Object.entries(json).filter(([key]) => !["TxnSignature", "hash", "date", "ledger_index"].includes(key)));
    const amountU = String((json.DeliverMax ?? json.Amount).value);
    const b: NativeBindingShape = { ...binding, returnCredit: { creditId: "credit", amountU }, returnAttempt: { attemptHash: restored.hash, preparedFields: fields } };
    const e = event("RETURN_VALIDATED", restored, { creditId: "credit", returned: { amountU, repAsset: report.rep_asset, sender: report.rep_asset.issuer, destination: borrower, partialPayment: false } });
    await verifier().verifyNativeEvent(e, b);
    await expect(verifier().verifyNativeEvent(e, { ...b, returnAttempt: { ...b.returnAttempt!, attemptHash: "F".repeat(64) } })).rejects.toThrow("NATIVE_RETURN_ATTEMPT_MISMATCH");
  });
  it("authenticates final tec failures before releasing a request hold", async () => {
    const failed = structuredClone(stake); failed.meta.TransactionResult = "tecINSUFFICIENT_FUNDS";
    failed.meta.AffectedNodes = failed.meta.AffectedNodes.filter((n: any) => n.ModifiedNode?.LedgerEntryType === "AccountRoot");
    const c = mock(r => r.command === "tx" ? { result: failed } : undefined);
    const e = { ...stakeEvent(), kind: "CANCEL_BEFORE_BURN", conclusive: true, native: { ...nativeEvidence(stake), result: "CONCLUSIVE_FAILURE" } };
    await verifier(c).verifyNativeEvent(e, binding);
    await expect(verifier().verifyNativeEvent(e, binding)).rejects.toThrow("NATIVE_FAILURE_NOT_FINAL");
    failed.meta.TransactionResult = "tefPAST_SEQ";
    await expect(verifier(c).verifyNativeEvent(e, binding)).rejects.toThrow("NATIVE_FAILURE_NOT_FINAL");
  });
  it("checks actual impairment/default flags and the persisted due-date grace boundary", async () => {
    const changed = structuredClone(paid), node = changed.meta.AffectedNodes.find((n: any) => n.ModifiedNode?.LedgerEntryType === "Loan").ModifiedNode;
    node.FinalFields.Flags = 131072;
    const c = mock(r => r.command === "tx" && r.transaction === paid.hash ? { result: changed } : undefined);
    const ctx = { originHash: origin.hash, previousEventHash: origin.hash, eventCursor: `devnet:${origin.hash}`, maturityAt: originLoan.maturityAt,
      nextDueAt: originLoan.nextPaymentDueAt, graceSeconds: originLoan.graceSeconds };
    const impairedPayment = await deriveLoanOutcome(c, originLoan.loanId, paid.hash, ctx);
    expect(impairedPayment.kind === "REPAYMENT" && impairedPayment.repayment.onTime).toBe(false);
    changed.tx_json = { TransactionType: "LoanManage", LoanID: originLoan.loanId, Account: broker, Flags: 65536 };
    node.FinalFields.Flags = 65536;
    await expect(deriveLoanOutcome(c, originLoan.loanId, paid.hash, ctx)).rejects.toThrow("NATIVE_DEFAULT_PREMATURE_OR_UNCONFIRMED");
    changed.date = originLoan.nextPaymentDueAt + originLoan.graceSeconds + 1 - 946684800;
    delete changed.close_time_iso;
    expect((await deriveLoanOutcome(c, originLoan.loanId, paid.hash, ctx)).kind).toBe("DEFAULT");
  });
});

function portfolioFixture() {
  const rep = report.rep_asset, loanAsset = binding.asset, ledgerHash = "C".repeat(64), vaultId = "D".repeat(64);
  const seed = { mode: "LIVE_DEVNET", network: "devnet", loan_asset: loanAsset, rep_asset: rep, money_scale: 100,
    facility: { lender_id: broker, asset: loanAsset }, opening_loans: [],
    opening: { active_principal_minor: "0", reserved_principal_minor: "0", defaulted_principal_minor: "0",
      reputation: { seed_u: "1000000000", available_u: "1000000000", reserved_u: "0", bonded_u: "0", pending_return_u: "0", growth_u: "0", forfeited_u: "0", suspended: false } } };
  const client = (extra: (r: Record<string, unknown>) => unknown | undefined = () => undefined) => mock(r => {
    const replacement = extra(r); if (replacement !== undefined) return replacement;
    if (r.command === "ledger") return { result: { validated: true, ledger_index: 42, ledger_hash: ledgerHash, ledger: { ledger_index: 42, ledger_hash: ledgerHash } } };
    if (r.command === "ledger_entry") {
      let node;
      if (r.mptoken) node = { LedgerEntryType: "MPToken", Account: borrower, MPTokenIssuanceID: rep.mpt_issuance_id, Flags: 2, MPTAmount: "1000000000" };
      else if (r.mpt_issuance === rep.mpt_issuance_id) node = { LedgerEntryType: "MPTokenIssuance", Issuer: rep.issuer, AssetScale: 6, Flags: 4, ImmutableFlags: 126 };
      else if (r.mpt_issuance) node = { LedgerEntryType: "MPTokenIssuance", AssetScale: 0 };
      else if (r.index === report.broker_id) node = { LedgerEntryType: "LoanBroker", Owner: broker, VaultID: vaultId };
      else node = { LedgerEntryType: "Vault", Asset: loanAsset };
      return { result: { validated: true, ledger_index: 42, index: r.index, node } };
    }
    if (r.command === "ledger_data") return { result: { validated: true, ledger_index: 42, ledger_hash: ledgerHash, state: [] } };
    return undefined;
  });
  return { seed, client, ledgerHash };
}
describe("fresh portfolio and return failure authentication", () => {
  it("verifies restart configuration without resetting the persisted reputation state", async () => {
    const { client, ledgerHash } = portfolioFixture();
    const configuration = await verifier(client()).verifyAssetConfiguration({ lenderId: broker });
    expect(configuration).toEqual({ ledgerIndex: 42, ledgerHash, borrowerRepBalanceU: "1000000000", brokerOwner: broker, loanAssetScale: 0 });
    await expect(verifier(client()).verifyAssetConfiguration({ lenderId: borrower })).rejects.toThrow("NATIVE_BROKER_OWNER_MISMATCH");
  });
  it("checks actual REP balance/capabilities plus globally paginated Loan inventory", async () => {
    const { seed, client, ledgerHash } = portfolioFixture(); let pages = 0;
    const c = client(r => r.command === "ledger_data" ? { result: { validated: true, ledger_index: 42, ledger_hash: ledgerHash,
      state: [], ...(pages++ === 0 ? { marker: "next" } : {}) } } : undefined);
    await verifier(c).verifyNativePortfolio(seed, borrower, { clientSaysEmpty: true });
    expect(pages).toBe(2);
  });
  it("rejects an outstanding loan at another broker and repeated pagination markers", async () => {
    const { seed, client, ledgerHash } = portfolioFixture();
    const c = client(r => r.command === "ledger_data" ? { result: { validated: true, ledger_index: 42, ledger_hash: ledgerHash,
      state: [{ LedgerEntryType: "Loan", Borrower: borrower, LoanBrokerID: "A".repeat(64), PrincipalOutstanding: "1", PaymentRemaining: 1 }] } } : undefined);
    await expect(verifier(c).verifyNativePortfolio(seed, borrower, {})).rejects.toThrow("NATIVE_OPENING_HISTORY_REQUIRED");
    const loop = client(r => r.command === "ledger_data" ? { result: { validated: true, ledger_index: 42, ledger_hash: ledgerHash, state: [], marker: "loop" } } : undefined);
    await expect(verifier(loop).verifyNativePortfolio(seed, borrower, {})).rejects.toThrow("NATIVE_INVENTORY_MARKER_CYCLE");
  });
  it("rejects a seed mismatch against the queried REP holding", async () => {
    const { seed, client } = portfolioFixture(); seed.opening.reputation.available_u = "1000000001"; seed.opening.reputation.seed_u = "1000000001";
    await expect(verifier(client()).verifyNativePortfolio(seed, borrower, {})).rejects.toThrow("NATIVE_REP_BALANCE_MISMATCH");
  });
  it("requires proven expiry and complete issuer history before replacing a return", async () => {
    const { client } = portfolioFixture(), missing = "A".repeat(64);
    const context = { instruction: { issuer: report.rep_asset.issuer, network: "devnet", mode: "LIVE_DEVNET" },
      attempt: { attemptHash: missing, firstLedgerSequence: 10, lastLedgerSequence: 30, sequence: 77, preparedFields: {} } };
    const c = client(r => {
      if (r.command === "account_info") return { result: { validated: true, account_data: { Account: report.rep_asset.issuer, Sequence: 77 } } };
      if (r.command === "account_tx") return { result: { validated: true, ledger_index_min: 10, ledger_index_max: 42, transactions: [] } };
      return undefined;
    });
    const evidence = { kind: "EXPIRED_NOT_FOUND", txHash: missing, validatedLedgerIndex: 42, historyFromLedger: 10, historyToLedger: 42, accountSequence: 77 };
    await verifier(c).verifyReturnFailure(evidence, context);
    await expect(verifier(c).verifyReturnFailure({ ...evidence, accountSequence: 78 }, context)).rejects.toThrow("NATIVE_ISSUER_SEQUENCE_DIVERGED");
  });
});
