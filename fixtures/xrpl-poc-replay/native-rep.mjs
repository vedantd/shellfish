import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../packages/xrpl/package.json", import.meta.url));
const { decodeAccountID } = require("xrpl");
const UINT = /^(0|[1-9][0-9]*)$/;
const ISSUANCE = /^[A-Fa-f0-9]{48}$/;
const HASH = /^[A-Fa-f0-9]{64}$/;
const PARTIAL_PAYMENT = 0x00020000;

function amount(value, name = "REP amount") {
  assert.equal(typeof value, "string", `${name} must be an integer string`);
  assert.match(value, UINT, `${name} must be a nonnegative integer string`);
  return BigInt(value);
}

function address(wallet) {
  const result = typeof wallet === "string" ? wallet : wallet?.classicAddress ?? wallet?.address;
  assert.equal(typeof result, "string", "Expected an account address");
  assert.ok(result.startsWith("r"), "Expected a classic XRPL account address");
  return result;
}

function resultOf(response) {
  return response?.result ?? response;
}

function transactionOf(tx) {
  return tx.tx_json ?? tx;
}

function publicReceipt(tx) {
  return {
    txHash: tx.hash,
    ledgerIndex: tx.ledger_index,
    transactionIndex: tx.meta.TransactionIndex,
    validated: true,
    result: tx.meta.TransactionResult,
    transactionType: transactionOf(tx).TransactionType,
  };
}

/** Re-query the hash on the caller's Devnet client. A submit acknowledgement is insufficient. */
export async function confirmRepTransaction(client, submitted) {
  const candidate = resultOf(submitted);
  const hash = candidate?.hash ?? candidate?.txHash;
  assert.match(hash ?? "", HASH, "Submission must return its native transaction hash");
  const tx = resultOf(await client.request({ command: "tx", transaction: hash, binary: false, api_version: 2 }));
  assert.equal(tx.validated, true, "REP transaction must be included in a validated ledger");
  assert.equal(tx.meta?.TransactionResult, "tesSUCCESS", "REP transaction must have a successful final result");
  assert.equal(tx.hash?.toUpperCase(), hash.toUpperCase());
  assert.ok(Number.isSafeInteger(tx.ledger_index) && tx.ledger_index > 0);
  assert.ok(Number.isSafeInteger(tx.meta.TransactionIndex) && tx.meta.TransactionIndex >= 0);
  return tx;
}

async function pinnedLedger(client, ledgerIndex) {
  if (Number.isSafeInteger(ledgerIndex) && ledgerIndex > 0) return ledgerIndex;
  assert.equal(ledgerIndex, "validated");
  const result = resultOf(await client.request({ command: "ledger", ledger_index: "validated", transactions: false, expand: false }));
  assert.equal(result.validated, true, "REP state must use a validated ledger");
  const index = Number(result.ledger_index ?? result.ledger?.ledger_index);
  assert.ok(Number.isSafeInteger(index) && index > 0);
  return index;
}

/** Read holder and issuance at one validated ledger. No wallet secrets enter this result. */
export async function readRepState({ client, issuanceId, holder, issuer, ledgerIndex = "validated" }) {
  assert.match(issuanceId, ISSUANCE);
  const holderAccount = address(holder);
  const issuerAccount = address(issuer);
  const index = await pinnedLedger(client, ledgerIndex);
  const issueResult = resultOf(await client.request({ command: "ledger_entry", mpt_issuance: issuanceId,
    ledger_index: index, binary: false }));
  const holdResult = resultOf(await client.request({ command: "ledger_entry",
    mptoken: { mpt_issuance_id: issuanceId, account: holderAccount }, ledger_index: index, binary: false }));
  assert.equal(issueResult.validated, true);
  assert.equal(holdResult.validated, true);
  const issuance = issueResult.node;
  const holding = holdResult.node;
  assert.equal(issuance?.LedgerEntryType, "MPTokenIssuance");
  assert.equal(issuance.Issuer, issuerAccount);
  assert.equal(issuance.AssetScale ?? 0, 6);
  assert.equal(issuance.Flags, 4, "REP must require authorization and permit no transfers, trade, escrow, lock or clawback");
  assert.equal(holding?.LedgerEntryType, "MPToken");
  assert.equal(holding.MPTokenIssuanceID?.toUpperCase(), issuanceId.toUpperCase());
  if (holding.Account !== undefined) assert.equal(holding.Account, holderAccount);
  const holderAmountU = (holding.MPTAmount ?? "0").toString();
  const outstandingAmountU = (issuance.OutstandingAmount ?? "0").toString();
  amount(holderAmountU, "Holder REP balance");
  amount(outstandingAmountU, "Outstanding REP supply");
  return {
    ledgerIndex: index,
    issuanceId: issuanceId.toUpperCase(),
    issuer: issuerAccount,
    holder: holderAccount,
    holderAmountU,
    outstandingAmountU,
    issuanceLedgerEntryId: issueResult.index,
    holderLedgerEntryId: holdResult.index,
    issuance,
    holding,
  };
}

function derivedIssuanceId(tx, issuer) {
  const transaction = transactionOf(tx);
  const sequence = transaction.TicketSequence ?? transaction.Sequence;
  assert.ok(Number.isSafeInteger(sequence) && sequence > 0 && sequence <= 0xffffffff);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(sequence);
  const id = Buffer.concat([prefix, Buffer.from(decodeAccountID(issuer))]).toString("hex").toUpperCase();
  if (tx.meta.mpt_issuance_id !== undefined) assert.equal(tx.meta.mpt_issuance_id.toUpperCase(), id);
  return id;
}

function changedFields(tx, entryId) {
  const nodes = tx.meta.AffectedNodes.map(wrapper => wrapper.ModifiedNode ?? wrapper.CreatedNode ?? wrapper.DeletedNode)
    .filter(node => node?.LedgerIndex === entryId);
  assert.equal(nodes.length, 1, "REP transaction must change the expected ledger entry exactly once");
  const node = nodes[0];
  assert.ok(node.FinalFields || node.NewFields, "REP transaction must preserve the issuance and holding");
  return { before: node.PreviousFields ?? {}, after: node.FinalFields ?? node.NewFields };
}

function assertPayment(tx, from, to, issuanceId, amountU) {
  const transaction = transactionOf(tx);
  // API v2 renders Payment.Amount as DeliverMax. The signed transaction still uses Amount.
  const delivered = transaction.DeliverMax ?? transaction.Amount;
  if (transaction.DeliverMax !== undefined && transaction.Amount !== undefined) {
    assert.deepEqual(transaction.DeliverMax, transaction.Amount, "Payment amount aliases must agree");
  }
  assert.equal(transaction.TransactionType, "Payment");
  assert.equal(transaction.Account, from);
  assert.equal(transaction.Destination, to);
  assert.equal(delivered?.mpt_issuance_id?.toUpperCase(), issuanceId.toUpperCase());
  assert.equal(delivered?.value, amountU);
  assert.equal((transaction.Flags ?? 0) & PARTIAL_PAYMENT, 0, "Partial REP Payment is forbidden");
  assert.equal(transaction.SendMax, undefined);
  assert.equal(transaction.DeliverMin, undefined);
  assert.equal(transaction.Paths, undefined);
}

/**
 * Create REP and authorize one holder. submit(wallet, transaction, label) must persist/sign/submit
 * through the caller's isolated test executor and return the native hash or validated tx result.
 * This helper has no top-level signing, submission, wallet generation or logging.
 */
export async function createRepIssuance({ client, issuer, borrower, submit, immutableFlags = 126 }) {
  const issuerAccount = address(issuer);
  const borrowerAccount = address(borrower);
  assert.notEqual(issuerAccount, borrowerAccount);
  assert.ok(immutableFlags === 126 || immutableFlags === undefined, "Use the agreed core capability immutability mask");
  const createTx = await confirmRepTransaction(client, await submit(issuer, {
    TransactionType: "MPTokenIssuanceCreate",
    Account: issuerAccount,
    AssetScale: 6,
    MaximumAmount: "100000000000",
    Flags: 4,
    ...(immutableFlags === undefined ? {} : { ImmutableFlags: immutableFlags }),
    MPTokenMetadata: Buffer.from(JSON.stringify({ n: "Shellfish isolated E2E REP", t: "REP", in: "Shellfish isolated E2E", i: "https://example.org/shellfish-rep",
      d: "Test-only nontransferable reputation. No monetary redemption or production use.", ac: "other" }), "utf8").toString("hex").toUpperCase(),
  }, "rep-create"));
  assert.equal(transactionOf(createTx).TransactionType, "MPTokenIssuanceCreate");
  assert.equal(transactionOf(createTx).Account, issuerAccount);
  const issuanceId = derivedIssuanceId(createTx, issuerAccount);
  const holderAuthorizationTx = await confirmRepTransaction(client, await submit(borrower, {
    TransactionType: "MPTokenAuthorize", Account: borrowerAccount, MPTokenIssuanceID: issuanceId, Flags: 0,
  }, "rep-holder-authorize"));
  const issuerAuthorizationTx = await confirmRepTransaction(client, await submit(issuer, {
    TransactionType: "MPTokenAuthorize", Account: issuerAccount, Holder: borrowerAccount, MPTokenIssuanceID: issuanceId, Flags: 0,
  }, "rep-issuer-authorize"));
  const state = await readRepState({ client, issuanceId, holder: borrowerAccount, issuer: issuerAccount,
    ledgerIndex: issuerAuthorizationTx.ledger_index });
  assert.equal(state.holderAmountU, "0");
  assert.equal(state.outstandingAmountU, "0");
  if (immutableFlags !== undefined) assert.equal(state.issuance.ImmutableFlags, immutableFlags);
  return { issuanceId, issuer: issuerAccount, borrower: borrowerAccount, createTx, holderAuthorizationTx,
    issuerAuthorizationTx, state, receipt: publicReceipt(createTx) };
}

async function transferRep({ client, issuer, borrower, issuanceId, amountU, submit, label, direction }) {
  assert.ok(amount(amountU) > 0n, "REP transfer quantity must be positive");
  const issuerAccount = address(issuer);
  const borrowerAccount = address(borrower);
  assert.notEqual(issuerAccount, borrowerAccount);
  const from = direction === "REDEEM" ? borrowerAccount : issuerAccount;
  const to = direction === "REDEEM" ? issuerAccount : borrowerAccount;
  const signer = direction === "REDEEM" ? borrower : issuer;
  const tx = await confirmRepTransaction(client, await submit(signer, {
    TransactionType: "Payment", Account: from, Destination: to,
    Amount: { mpt_issuance_id: issuanceId, value: amountU }, Flags: 0,
  }, label));
  assertPayment(tx, from, to, issuanceId, amountU);
  assert.ok(tx.ledger_index > 1, "REP proof requires the preceding ledger");
  // The executor can resume an already validated immutable attempt. Historical states must
  // come from that attempt's ledger boundary, not the current balance after its execution.
  const before = await readRepState({ client, issuanceId, holder: borrowerAccount, issuer: issuerAccount,
    ledgerIndex: tx.ledger_index - 1 });
  const after = await readRepState({ client, issuanceId, holder: borrowerAccount, issuer: issuerAccount, ledgerIndex: tx.ledger_index });
  const expectedDelta = direction === "REDEEM" ? -amount(amountU) : amount(amountU);
  assert.equal(amount(after.holderAmountU) - amount(before.holderAmountU), expectedDelta);
  assert.equal(amount(after.outstandingAmountU) - amount(before.outstandingAmountU), expectedDelta);
  const holding = changedFields(tx, before.holderLedgerEntryId);
  const issuance = changedFields(tx, before.issuanceLedgerEntryId);
  assert.equal(amount(holding.after.MPTAmount ?? "0") - amount(holding.before.MPTAmount ?? "0"), expectedDelta);
  assert.equal(amount(issuance.after.OutstandingAmount ?? "0") - amount(issuance.before.OutstandingAmount ?? "0"), expectedDelta);
  return { issuanceId, amountU, direction, tx, receipt: publicReceipt(tx), before, after };
}

export function issueRep(input) {
  return transferRep({ ...input, amountU: input.amountU ?? "1000000000", label: input.label ?? "rep-seed", direction: "ISSUE" });
}

export function redeemRep(input) {
  return transferRep({ ...input, amountU: input.amountU ?? "240000000", label: input.label ?? "rep-redeem", direction: "REDEEM" });
}

export function restoreRep(input) {
  return transferRep({ ...input, label: input.label ?? "rep-restore", direction: "ISSUE" });
}
