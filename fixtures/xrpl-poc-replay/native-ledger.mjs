/**
 * Ledger readers for the isolated Devnet fixture.
 * These helpers are test code, not an accepted production adapter contract.
 * They query validated records and never sign or submit a transaction.
 */
import assert from "node:assert/strict";

const HASH = /^[A-Fa-f0-9]{64}$/;
const ISSUANCE = /^[A-Fa-f0-9]{48}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const RIPPLE_EPOCH_MS = Date.UTC(2000, 0, 1);
const LOAN_DEFAULT = 0x00010000;
const LOAN_IMPAIRED = 0x00020000;

const resultOf = response => response?.result ?? response;
const txOf = result => result.tx_json ?? result.tx ?? result;
const metaOf = result => result.meta ?? result.metaData;
const upper = value => typeof value === "string" ? value.toUpperCase() : value;

function positiveIndex(value, label) {
  const index = Number(value);
  assert.ok(Number.isSafeInteger(index) && index > 0, `${label} must be a positive ledger index`);
  return index;
}

function units(value, label) {
  assert.equal(typeof value, "string", `${label} must be an integer string`);
  assert.match(value, UINT, `${label} must use exact nonnegative units`);
  return BigInt(value);
}

function nodes(result) {
  const affected = metaOf(result)?.AffectedNodes;
  assert.ok(Array.isArray(affected), "Transaction metadata must contain AffectedNodes");
  return affected.map(wrapper => {
    const entries = Object.entries(wrapper);
    assert.equal(entries.length, 1, "Each affected-node wrapper needs one change type");
    const [change, node] = entries[0];
    assert.ok(["CreatedNode", "ModifiedNode", "DeletedNode"].includes(change));
    return { change, ...node };
  });
}

function only(values, name) {
  assert.equal(values.length, 1, `Expected one ${name}`);
  return values[0];
}

function assertValidated(result) {
  assert.equal(result.validated, true, "Transaction must belong to a validated ledger");
  assert.match(result.hash ?? "", HASH, "Transaction must have a native hash");
  positiveIndex(result.ledger_index, "Transaction ledger");
  const meta = metaOf(result);
  assert.equal(meta?.TransactionResult, "tesSUCCESS", "Transaction must have a successful final result");
  assert.ok(Number.isSafeInteger(meta.TransactionIndex) && meta.TransactionIndex >= 0,
    "Transaction metadata must supply its ledger position");
  assert.equal(typeof txOf(result).TransactionType, "string");
  nodes(result);
  return result;
}

/** A submission result or caller Boolean cannot replace this hash lookup. */
export async function getValidatedTx(client, hash) {
  assert.match(hash ?? "", HASH);
  const result = resultOf(await client.request({
    command: "tx", transaction: hash, binary: false, api_version: 2,
  }));
  assertValidated(result);
  assert.equal(upper(result.hash), upper(hash), "Lookup returned a different transaction");
  return result;
}

/** Project a queried transaction into the registry's current draft evidence shape. */
export function nativeEvidence(raw) {
  const result = assertValidated(resultOf(raw));
  return {
    txHash: upper(result.hash),
    ledgerIndex: positiveIndex(result.ledger_index, "Transaction ledger"),
    transactionIndex: metaOf(result).TransactionIndex,
    validated: true,
    result: "tesSUCCESS",
    transactionType: txOf(result).TransactionType,
  };
}

/** Use the validated ledger close time, with Ripple-epoch seconds as a checked fallback. */
export function ledgerUnix(raw) {
  const result = assertValidated(resultOf(raw));
  const iso = result.close_time_iso;
  if (iso !== undefined) {
    const millis = Date.parse(iso);
    assert.ok(Number.isFinite(millis) && millis >= 0 && millis % 1000 === 0,
      "Invalid ledger close timestamp");
    return millis / 1000;
  }
  const date = result.date ?? txOf(result).date;
  assert.ok(Number.isSafeInteger(date) && date >= 0, "Ledger close timestamp is unavailable");
  return RIPPLE_EPOCH_MS / 1000 + date;
}

export function createdNode(raw, type) {
  const result = assertValidated(resultOf(raw));
  const node = only(nodes(result).filter(n => n.change === "CreatedNode" && n.LedgerEntryType === type),
    `created ${type} node`);
  assert.match(node.LedgerIndex ?? "", HASH);
  assert.ok(node.NewFields && typeof node.NewFields === "object");
  return { id: upper(node.LedgerIndex), fields: structuredClone(node.NewFields) };
}

/** Exact holder balance change for one MPT issuance in this transaction's metadata. */
export function mptBalanceChange(raw, account, issuanceId) {
  const result = assertValidated(resultOf(raw));
  assert.match(issuanceId ?? "", ISSUANCE);
  const match = only(nodes(result).filter(n => {
    if (n.LedgerEntryType !== "MPToken") return false;
    const fields = n.NewFields ?? n.FinalFields ?? {};
    return fields.Account === account && upper(fields.MPTokenIssuanceID) === upper(issuanceId);
  }), "matching MPToken balance change");
  const final = match.NewFields ?? match.FinalFields ?? {};
  let before;
  let after;
  if (match.change === "CreatedNode") {
    before = 0n;
    after = units(final.MPTAmount ?? "0", "Created MPT balance");
  } else if (match.change === "DeletedNode") {
    before = units(final.MPTAmount ?? "0", "Deleted MPT balance");
    after = 0n;
  } else {
    after = units(final.MPTAmount ?? "0", "Final MPT balance");
    before = units(match.PreviousFields?.MPTAmount ?? final.MPTAmount ?? "0", "Previous MPT balance");
  }
  return { before: before.toString(), after: after.toString(), delta: (after - before).toString() };
}

/**
 * Interpret a successful LoanPay for the fixture's integer-valued loan asset.
 * A deleted Loan or a default/write-off is never treated as repayment.
 */
export function loanPrincipalChange(raw, loanId) {
  const result = assertValidated(resultOf(raw));
  const transaction = txOf(result);
  assert.equal(transaction.TransactionType, "LoanPay");
  assert.equal(upper(transaction.LoanID), upper(loanId));
  const node = only(nodes(result).filter(n => n.LedgerEntryType === "Loan" && upper(n.LedgerIndex) === upper(loanId)),
    "matching Loan change");
  assert.equal(node.change, "ModifiedNode", "Loan deletion alone cannot establish repayment");
  const final = node.FinalFields ?? {};
  const flags = final.Flags ?? 0;
  assert.ok(Number.isSafeInteger(flags) && flags >= 0);
  assert.equal(flags & (LOAN_DEFAULT | LOAN_IMPAIRED), 0, "Default or impairment cannot establish clean repayment");
  const after = units(final.PrincipalOutstanding ?? "0", "Principal after LoanPay");
  const before = units(node.PreviousFields?.PrincipalOutstanding ?? final.PrincipalOutstanding ?? "0",
    "Principal before LoanPay");
  assert.ok(before >= after, "LoanPay cannot increase principal in this fixture");
  const paymentRemaining = final.PaymentRemaining ?? 0;
  assert.ok(Number.isSafeInteger(paymentRemaining) && paymentRemaining >= 0);
  const totalValueOutstanding = units(final.TotalValueOutstanding ?? "0", "Contractual obligation after LoanPay");
  return {
    loanId: upper(loanId),
    before: before.toString(),
    after: after.toString(),
    reduction: (before - after).toString(),
    fullContractualRepayment: after === 0n && paymentRemaining === 0 && totalValueOutstanding === 0n,
    paymentRemaining,
    totalValueOutstanding: totalValueOutstanding.toString(),
    flags,
  };
}

const cursor = result => [positiveIndex(result.ledger_index, "Event ledger"), metaOf(result).TransactionIndex];
const compare = (left, right) => left[0] - right[0] || left[1] - right[1];

/**
 * Scan every ledger in a bounded native range, including transactions from other accounts.
 * This avoids assuming that borrower account history contains every servicing operation.
 */
export async function completeLoanHistory(client, loanId, originTx, terminalTx) {
  assert.match(loanId ?? "", HASH);
  const origin = await getValidatedTx(client, resultOf(originTx).hash);
  const terminal = await getValidatedTx(client, resultOf(terminalTx).hash);
  const fromLedger = positiveIndex(origin.ledger_index, "Origin ledger");
  const toLedger = positiveIndex(terminal.ledger_index, "Terminal ledger");
  assert.ok(toLedger >= fromLedger && toLedger - fromLedger < 200,
    "Fixture history scan requires a nonnegative range of at most 200 ledgers");
  const originCursor = cursor(origin);
  const terminalCursor = cursor(terminal);
  assert.ok(compare(originCursor, terminalCursor) < 0, "Repayment must follow origination in ledger order");
  const events = [];
  const ledgerHashes = [];
  let previousHash;
  for (let index = fromLedger; index <= toLedger; index += 1) {
    const response = resultOf(await client.request({
      command: "ledger", ledger_index: index, transactions: true, expand: true, binary: false, api_version: 2,
    }));
    assert.equal(response.validated, true, "History requires validated ledger coverage");
    const ledger = response.ledger;
    assert.equal(positiveIndex(response.ledger_index ?? ledger?.ledger_index, "Returned ledger"), index);
    assert.equal(positiveIndex(ledger?.ledger_index, "Expanded ledger"), index);
    assert.equal(ledger.closed, true);
    const hash = upper(response.ledger_hash ?? ledger.ledger_hash);
    assert.match(hash ?? "", HASH);
    assert.equal(upper(ledger.ledger_hash), hash);
    if (previousHash) assert.equal(upper(ledger.parent_hash), previousHash, "Ledger history has a broken parent link");
    if (index === fromLedger) assert.equal(hash, upper(origin.ledger_hash));
    if (index === toLedger) assert.equal(hash, upper(terminal.ledger_hash));
    previousHash = hash;
    ledgerHashes.push({ ledgerIndex: index, ledgerHash: hash });
    assert.ok(Array.isArray(ledger.transactions), "Expanded transaction history is unavailable");
    for (const raw of ledger.transactions) {
      assert.ok(raw && typeof raw === "object", "Ledger must contain expanded transactions");
      const item = {
        ...raw,
        validated: response.validated,
        ledger_index: index,
        ledger_hash: hash,
        close_time_iso: raw.close_time_iso ?? ledger.close_time_iso,
        date: raw.date ?? ledger.close_time,
      };
      const meta = metaOf(item);
      assert.ok(meta && Number.isSafeInteger(meta.TransactionIndex), "Expanded metadata lacks its transaction position");
      const affectsLoan = upper(txOf(item).LoanID) === upper(loanId) ||
        nodes(item).some(n => n.LedgerEntryType === "Loan" && upper(n.LedgerIndex) === upper(loanId));
      if (!affectsLoan) continue;
      const position = cursor(item);
      if (compare(position, originCursor) < 0 || compare(position, terminalCursor) > 0) continue;
      assertValidated(item);
      assert.ok(["LoanSet", "LoanPay"].includes(txOf(item).TransactionType),
        "The clean fixture cannot skip impairment, default or other loan servicing");
      events.push(item);
    }
  }
  events.sort((left, right) => compare(cursor(left), cursor(right)));
  assert.ok(events.length >= 2, "Origin or repayment is missing from complete ledger coverage");
  assert.equal(upper(events[0].hash), upper(origin.hash));
  assert.equal(upper(events.at(-1).hash), upper(terminal.hash));
  assert.equal(txOf(events[0]).TransactionType, "LoanSet");
  assert.equal(createdNode(events[0], "Loan").id, upper(loanId));
  assert.equal(txOf(events.at(-1)).TransactionType, "LoanPay");
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(compare(cursor(events[index - 1]), cursor(events[index])) < 0, "Relevant event positions must be unique");
    assert.equal(txOf(events[index]).TransactionType, "LoanPay");
    const change = only(nodes(events[index]).filter(n => n.LedgerEntryType === "Loan" && upper(n.LedgerIndex) === upper(loanId)),
      "relevant Loan node");
    assert.equal(upper(change.PreviousTxnID), upper(events[index - 1].hash), "Loan history cursor skipped a relevant change");
    loanPrincipalChange(events[index], loanId);
  }
  assert.equal(loanPrincipalChange(events.at(-1), loanId).fullContractualRepayment, true,
    "Terminal event must repay the full contractual obligation");
  return {
    events,
    coverage: { complete: true, fromLedger, toLedger, ledgersChecked: ledgerHashes.length, ledgerHashes },
    previousEventHash: upper(events.at(-2).hash),
  };
}
