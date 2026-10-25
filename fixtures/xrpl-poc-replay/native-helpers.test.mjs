/** Unit tests use mocked ledger responses. They do not submit or establish native ledger evidence. */
import assert from "node:assert/strict";
import test from "node:test";
import { confirmRepTransaction, issueRep } from "./native-rep.mjs";
import { loanPrincipalChange } from "./native-ledger.mjs";

const TX_HASH = "A".repeat(64);
const HOLDER_ENTRY = "B".repeat(64);
const ISSUANCE_ENTRY = "C".repeat(64);
const LOAN_ID = "D".repeat(64);
const ISSUANCE_ID = "AB".repeat(24);
const ISSUER = "rMockIssuerForUnitTestsOnly";
const HOLDER = "rMockHolderForUnitTestsOnly";

function paymentResult(alias = "DeliverMax") {
  return {
    hash: TX_HASH,
    validated: true,
    ledger_index: 42,
    tx_json: {
      TransactionType: "Payment", Account: ISSUER, Destination: HOLDER, Flags: 0,
      [alias]: { mpt_issuance_id: ISSUANCE_ID, value: "1000000000" },
    },
    meta: {
      TransactionResult: "tesSUCCESS", TransactionIndex: 0,
      AffectedNodes: [
        { ModifiedNode: { LedgerEntryType: "MPToken", LedgerIndex: HOLDER_ENTRY,
          PreviousFields: { MPTAmount: "0" },
          FinalFields: { Account: HOLDER, MPTokenIssuanceID: ISSUANCE_ID, MPTAmount: "1000000000" } } },
        { ModifiedNode: { LedgerEntryType: "MPTokenIssuance", LedgerIndex: ISSUANCE_ENTRY,
          PreviousFields: { OutstandingAmount: "0" },
          FinalFields: { Issuer: ISSUER, OutstandingAmount: "1000000000", AssetScale: 6, Flags: 4 } } },
      ],
    },
  };
}

function mockedIssue(tx = paymentResult(), { badSupply = false } = {}) {
  const requests = [];
  let resumedReceipts = 0;
  const client = {
    async request(query) {
      requests.push(structuredClone(query));
      if (query.command === "tx") return { result: structuredClone(tx) };
      assert.equal(query.command, "ledger_entry", "Historical REP replay must not query the current ledger");
      assert.ok([41, 42].includes(query.ledger_index), "State must be anchored around the recorded transaction");
      const after = query.ledger_index === 42;
      const quantity = after ? "1000000000" : "0";
      if (query.mpt_issuance) {
        assert.equal(query.mpt_issuance, ISSUANCE_ID);
        return { result: { validated: true, ledger_index: query.ledger_index, index: ISSUANCE_ENTRY,
          node: { LedgerEntryType: "MPTokenIssuance", Issuer: ISSUER, AssetScale: 6, Flags: 4,
            OutstandingAmount: badSupply && after ? "1000000001" : quantity } } };
      }
      assert.deepEqual(query.mptoken, { mpt_issuance_id: ISSUANCE_ID, account: HOLDER });
      return { result: { validated: true, ledger_index: query.ledger_index, index: HOLDER_ENTRY,
        node: { LedgerEntryType: "MPToken", Account: HOLDER, MPTokenIssuanceID: ISSUANCE_ID, MPTAmount: quantity } } };
    },
  };
  return {
    requests,
    resumedReceipts: () => resumedReceipts,
    run: () => issueRep({
      client, issuer: { classicAddress: ISSUER }, borrower: { classicAddress: HOLDER }, issuanceId: ISSUANCE_ID,
      submit: async (wallet, transaction, label) => {
        assert.equal(wallet.classicAddress, ISSUER);
        assert.equal(label, "rep-seed");
        assert.deepEqual(transaction.Amount, { mpt_issuance_id: ISSUANCE_ID, value: "1000000000" });
        resumedReceipts += 1;
        // Return an already validated attempt. No mock mutation or fresh submission occurs.
        return { hash: TX_HASH };
      },
    }),
  };
}

for (const alias of ["Amount", "DeliverMax"]) {
  test(`unit: REP issue accepts ${alias} in a confirmed Payment and uses its historical ledger boundary`, async () => {
    const mock = mockedIssue(paymentResult(alias));
    const result = await mock.run();
    assert.equal(result.before.ledgerIndex, 41);
    assert.equal(result.after.ledgerIndex, 42);
    assert.equal(result.before.holderAmountU, "0");
    assert.equal(result.after.holderAmountU, "1000000000");
    assert.equal(result.after.outstandingAmountU, "1000000000");
    assert.equal(mock.resumedReceipts(), 1);
    assert.deepEqual(mock.requests.filter(q => q.command === "ledger_entry").map(q => q.ledger_index), [41, 41, 42, 42]);
    assert.equal(mock.requests[0].api_version, 2);
  });
}

test("unit: resuming the same validated REP attempt does not derive before-state from the current issued balance", async () => {
  const mock = mockedIssue();
  const first = await mock.run();
  const resumed = await mock.run();
  assert.deepEqual(resumed.before, first.before);
  assert.deepEqual(resumed.after, first.after);
  assert.equal(mock.requests.some(query => query.ledger_index === "validated" || query.command === "ledger"), false);
});

test("unit: conflicting API Payment aliases cannot pass REP verification", async () => {
  const tx = paymentResult();
  tx.tx_json.Amount = { mpt_issuance_id: ISSUANCE_ID, value: "999999999" };
  await assert.rejects(mockedIssue(tx).run(), /Payment amount aliases must agree/);
});

test("unit: a partial REP Payment cannot satisfy an exact issuer operation", async () => {
  const tx = paymentResult();
  tx.tx_json.Flags = 0x00020000;
  await assert.rejects(mockedIssue(tx).run(), /Partial REP Payment is forbidden/);
});

test("unit: REP issuance needs the matching supply change, not only a holder balance", async () => {
  await assert.rejects(mockedIssue(paymentResult(), { badSupply: true }).run());
});

for (const [name, mutate] of [
  ["unvalidated tesSUCCESS", tx => { tx.validated = false; }],
  ["validated failed result", tx => { tx.meta.TransactionResult = "tecNO_PERMISSION"; }],
  ["different transaction hash", tx => { tx.hash = "F".repeat(64); }],
]) {
  test(`unit: REP confirmation rejects ${name}`, async () => {
    const tx = paymentResult();
    mutate(tx);
    const queries = [];
    await assert.rejects(confirmRepTransaction({ request: async query => {
      queries.push(query);
      return { result: tx };
    } }, { hash: TX_HASH }));
    assert.equal(queries.length, 1);
    assert.equal(queries[0].transaction, TX_HASH);
  });
}

function repaymentResult() {
  return {
    hash: TX_HASH,
    validated: true,
    ledger_index: 42,
    tx_json: { TransactionType: "LoanPay", LoanID: LOAN_ID },
    meta: { TransactionResult: "tesSUCCESS", TransactionIndex: 0, AffectedNodes: [
      { ModifiedNode: { LedgerEntryType: "Loan", LedgerIndex: LOAN_ID,
        PreviousFields: { PrincipalOutstanding: "1000", TotalValueOutstanding: "1005", PaymentRemaining: 1 },
        FinalFields: { Flags: 0 } } },
    ] },
  };
}

test("unit: full LoanPay reads principal reduction from the Loan change", () => {
  const tx = repaymentResult();
  tx.tx_json.Amount = { mpt_issuance_id: ISSUANCE_ID, value: "2000" };
  const change = loanPrincipalChange(tx, LOAN_ID);
  assert.equal(change.reduction, "1000");
  assert.equal(change.after, "0");
  assert.equal(change.fullContractualRepayment, true);
});

for (const flag of [0x00010000, 0x00020000]) {
  test(`unit: LoanPay with loan state flag ${flag} cannot establish clean repayment`, () => {
    const tx = repaymentResult();
    tx.meta.AffectedNodes[0].ModifiedNode.FinalFields.Flags = flag;
    assert.throws(() => loanPrincipalChange(tx, LOAN_ID), /Default or impairment/);
  });
}

test("unit: deleting a Loan cannot stand in for verified repayment", () => {
  const tx = repaymentResult();
  tx.meta.AffectedNodes[0] = { DeletedNode: tx.meta.AffectedNodes[0].ModifiedNode };
  assert.throws(() => loanPrincipalChange(tx, LOAN_ID), /Loan deletion alone/);
});

for (const [name, remaining] of [
  ["remaining contractual fees", { TotalValueOutstanding: "5" }],
  ["remaining payment count", { PaymentRemaining: 1 }],
  ["remaining principal", { PrincipalOutstanding: "500", TotalValueOutstanding: "505", PaymentRemaining: 1 }],
]) {
  test(`unit: ${name} prevents a full contractual repayment verdict`, () => {
    const tx = repaymentResult();
    Object.assign(tx.meta.AffectedNodes[0].ModifiedNode.FinalFields, remaining);
    const change = loanPrincipalChange(tx, LOAN_ID);
    assert.equal(change.fullContractualRepayment, false);
  });
}
