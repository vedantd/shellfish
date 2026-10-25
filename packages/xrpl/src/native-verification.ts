import { canonicalJson, type AssetRef, type AtomicReservationRequest, type LenderFacilityOffer, type RepAssetRef } from "@shellfish/schemas";

export interface NativeQueryClient { request(request: Record<string, unknown>): Promise<unknown> }
type Json = Record<string, unknown>;
export type ValidatedTransaction = Json & { hash: string; ledger_index: number; validated: true; tx_json: Json; meta: Json };
export interface LoanVerificationContext {
  originHash: string; eventCursor: string; previousEventHash: string;
  maturityAt: number; nextDueAt: number; graceSeconds: number;
  moneyScale?: bigint; nativeAssetScale?: number;
}
export class NativeVerificationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "NativeVerificationError"; }
}
const HASH = /^[A-Fa-f0-9]{64}$/;
const MPT = /^[A-Fa-f0-9]{48}$/;
const EPOCH = 946684800;
const DEFAULT = 65536;
const IMPAIRED = 131072;
const fail = (code: string): never => { throw new NativeVerificationError(code); };
function need(value: unknown, code: string): asserts value { if (!value) fail(code); }
function object(value: unknown, code = "NATIVE_OBJECT_REQUIRED"): Json {
  need(value !== null && typeof value === "object" && !Array.isArray(value), code);
  return value as Json;
}
function integer(value: unknown, positive = false): number {
  const n = Number(value);
  need(Number.isSafeInteger(n) && n >= (positive ? 1 : 0), "NATIVE_INTEGER_REQUIRED");
  return n;
}
function upper(value: unknown): string { need(typeof value === "string", "NATIVE_STRING_REQUIRED"); return value.toUpperCase(); }
function hash(value: unknown): string { need(typeof value === "string" && HASH.test(value), "NATIVE_HASH_REQUIRED"); return value.toUpperCase(); }
function eq(a: unknown, b: unknown, code: string): void { need(canonicalJson(a) === canonicalJson(b), code); }
export function responseResult(value: unknown): Json { const r = object(value); return object(r.result ?? r); }
export function txJson(raw: unknown): Json { const r = responseResult(raw); return object(r.tx_json ?? r.tx ?? r); }
export function affectedNodes(raw: unknown): Json[] {
  const result = responseResult(raw), meta = object(result.meta ?? result.metaData);
  need(Array.isArray(meta.AffectedNodes), "NATIVE_METADATA_REQUIRED");
  return meta.AffectedNodes.map(wrapper => {
    const entries = Object.entries(object(wrapper));
    need(entries.length === 1 && ["CreatedNode", "ModifiedNode", "DeletedNode"].includes(entries[0][0]), "NATIVE_NODE_INVALID");
    return { change: entries[0][0], ...object(entries[0][1]) };
  });
}
function only(values: Json[], code: string): Json { need(values.length === 1, code); return values[0]; }
function assertQueriedTransaction(raw: unknown, expectedHash: string, allowFailure: boolean): ValidatedTransaction {
  const result = responseResult(raw), json = txJson(result), meta = object(result.meta ?? result.metaData);
  need(result.validated === true, "NATIVE_NOT_VALIDATED");
  need(hash(result.hash ?? json.hash) === hash(expectedHash), "NATIVE_HASH_MISMATCH");
  integer(result.ledger_index, true); integer(meta.TransactionIndex);
  need(typeof json.TransactionType === "string", "NATIVE_TRANSACTION_TYPE_REQUIRED");
  need(typeof meta.TransactionResult === "string", "NATIVE_RESULT_REQUIRED");
  need(allowFailure || meta.TransactionResult === "tesSUCCESS", "NATIVE_NOT_SUCCESS");
  affectedNodes(result);
  return { ...result, hash: hash(expectedHash), ledger_index: integer(result.ledger_index, true), validated: true, tx_json: json, meta };
}
export async function assertDevnet(client: NativeQueryClient, expectedNetworkId = 2): Promise<void> {
  need(expectedNetworkId === 2, "DEVNET_ONLY");
  const server = responseResult(await client.request({ command: "server_info" }));
  need(object(server.info).network_id === expectedNetworkId, "NATIVE_NETWORK_MISMATCH");
}
export async function getValidatedTx(client: NativeQueryClient, transactionHash: string): Promise<ValidatedTransaction> {
  await assertDevnet(client);
  return assertQueriedTransaction(await client.request({ command: "tx", transaction: hash(transactionHash), binary: false, api_version: 2 }), transactionHash, false);
}
export const readValidatedTransaction = getValidatedTx;
export function nativeEvidence(raw: unknown) {
  const r = responseResult(raw), checked = assertQueriedTransaction(r, hash(r.hash), false);
  return { txHash: checked.hash, ledgerIndex: checked.ledger_index, transactionIndex: integer(checked.meta.TransactionIndex), validated: true as const, result: "tesSUCCESS" as const, transactionType: String(checked.tx_json.TransactionType) };
}
export function ledgerUnix(raw: unknown): number {
  const result = responseResult(raw);
  if (result.close_time_iso !== undefined) {
    const millis = Date.parse(String(result.close_time_iso));
    need(Number.isSafeInteger(millis / 1000) && millis >= 0, "NATIVE_LEDGER_TIME_REQUIRED");
    return millis / 1000;
  }
  const date = result.date ?? txJson(result).date;
  return EPOCH + integer(date);
}
export function createdNode(raw: unknown, type: string): { id: string; fields: Json } {
  const node = only(affectedNodes(raw).filter(n => n.change === "CreatedNode" && n.LedgerEntryType === type), "NATIVE_CREATED_NODE_REQUIRED");
  return { id: hash(node.LedgerIndex), fields: structuredClone(object(node.NewFields)) };
}
function loanNode(raw: unknown, loanId: string): Json {
  return only(affectedNodes(raw).filter(n => n.LedgerEntryType === "Loan" && upper(n.LedgerIndex) === hash(loanId)), "NATIVE_LOAN_NODE_REQUIRED");
}
/** Exact XRPL decimal/number conversion. Unsupported fractional minor units fail. */
export function nativeAmountToMinor(value: unknown, moneyScale = 100n, assetScale = 0): string {
  need(typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value), "NATIVE_AMOUNT_INVALID");
  need(moneyScale > 0n && Number.isSafeInteger(assetScale) && assetScale >= 0 && assetScale <= 18, "NATIVE_SCALE_INVALID");
  const [mantissa, expText = "0"] = value.toLowerCase().split("e"), exponent = Number(expText);
  need(Number.isSafeInteger(exponent) && Math.abs(exponent) <= 100, "NATIVE_AMOUNT_INVALID");
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = BigInt(whole + fraction), power = exponent - fraction.length - assetScale;
  let numerator = digits * moneyScale, denominator = 1n;
  if (power >= 0) numerator *= 10n ** BigInt(power); else denominator = 10n ** BigInt(-power);
  need(numerator % denominator === 0n, "NATIVE_PRECISION_UNSUPPORTED");
  return (numerator / denominator).toString();
}
export function loanPrincipalChange(raw: unknown, loanId: string) {
  const json = txJson(raw);
  need(json.TransactionType === "LoanPay" && upper(json.LoanID) === hash(loanId), "NATIVE_LOANPAY_MISMATCH");
  const node = loanNode(raw, loanId);
  need(node.change === "ModifiedNode", "NATIVE_LOAN_DELETION_NOT_REPAYMENT");
  const final = object(node.FinalFields), previous = object(node.PreviousFields ?? {});
  const before = String(previous.PrincipalOutstanding ?? final.PrincipalOutstanding ?? "0"), after = String(final.PrincipalOutstanding ?? "0");
  const beforeExact = BigInt(nativeAmountToMinor(before, 10n ** 18n)), afterExact = BigInt(nativeAmountToMinor(after, 10n ** 18n));
  need(beforeExact >= afterExact, "NATIVE_PRINCIPAL_INCREASE");
  const reductionU = beforeExact - afterExact;
  const reduction = `${reductionU / 10n ** 18n}.${(reductionU % 10n ** 18n).toString().padStart(18, "0")}`.replace(/\.?0+$/, "") || "0";
  const flags = integer(final.Flags ?? 0), paymentRemaining = integer(final.PaymentRemaining ?? 0);
  need((flags & DEFAULT) === 0, "NATIVE_DEFAULT_NOT_REPAYMENT");
  const obligation = nativeAmountToMinor(String(final.TotalValueOutstanding ?? "0"), 10n ** 18n);
  return { before, after, reduction, flags, paymentRemaining, totalValueOutstanding: String(final.TotalValueOutstanding ?? "0"), fullContractualRepayment: afterExact === 0n && paymentRemaining === 0 && BigInt(obligation) === 0n,
    nextPaymentDueAt: final.NextPaymentDueDate === undefined ? undefined : EPOCH + integer(final.NextPaymentDueDate) };
}
export function deriveOrigination(raw: unknown) {
  const tx = txJson(raw), loan = createdNode(raw, "Loan"), f = loan.fields;
  need(tx.TransactionType === "LoanSet", "NATIVE_LOANSET_REQUIRED");
  const start = EPOCH + integer(f.StartDate), interval = integer(f.PaymentInterval, true), count = integer(tx.PaymentTotal, true);
  return { loanId: loan.id, maturityAt: start + interval * count, nextPaymentDueAt: EPOCH + integer(f.NextPaymentDueDate, true), graceSeconds: integer(f.GracePeriod ?? tx.GracePeriod ?? 0) };
}
const position = (tx: ValidatedTransaction) => [tx.ledger_index, integer(tx.meta.TransactionIndex)] as const;
const compare = (left: ValidatedTransaction, right: ValidatedTransaction) => position(left)[0] - position(right)[0] || position(left)[1] - position(right)[1];
/** Walk the authenticated Loan PreviousTxnID chain, including changes by other accounts. */
export async function completeLoanHistory(client: NativeQueryClient, loanId: string, originHash: string, terminalHash: string, options: { maxEvents?: number } = {}) {
  const maxEvents = options.maxEvents ?? 10000;
  need(Number.isSafeInteger(maxEvents) && maxEvents > 1, "NATIVE_HISTORY_LIMIT_INVALID");
  const events: ValidatedTransaction[] = [], seen = new Set<string>();
  let currentHash = hash(terminalHash);
  for (;;) {
    need(events.length < maxEvents && !seen.has(currentHash), "NATIVE_HISTORY_GAP_OR_LIMIT");
    seen.add(currentHash);
    const current = await getValidatedTx(client, currentHash), node = loanNode(current, loanId);
    if (events.length) need(compare(current, events[events.length - 1]) < 0, "NATIVE_HISTORY_ORDER");
    events.push(current);
    if (current.hash === hash(originHash)) {
      need(current.tx_json.TransactionType === "LoanSet" && node.change === "CreatedNode", "NATIVE_HISTORY_ORIGIN_MISMATCH");
      break;
    }
    need(["LoanPay", "LoanManage"].includes(String(current.tx_json.TransactionType)), "NATIVE_HISTORY_UNSUPPORTED_CHANGE");
    currentHash = hash(node.PreviousTxnID);
  }
  events.reverse();
  return { events, previousEventHash: events.length > 1 ? events[events.length - 2].hash : null,
    coverage: { complete: true as const, method: "LOAN_PREVIOUS_TXN_CHAIN" as const, eventsChecked: events.length, fromLedger: events[0].ledger_index, toLedger: events[events.length - 1].ledger_index } };
}
export async function deriveLoanOutcome(client: NativeQueryClient, loanId: string, transactionHash: string, context: LoanVerificationContext) {
  const tx = await getValidatedTx(client, transactionHash), json = tx.tx_json;
  need(upper(json.LoanID) === hash(loanId), "NATIVE_LOAN_ID_MISMATCH");
  const history = await completeLoanHistory(client, loanId, context.originHash, tx.hash);
  need(history.previousEventHash === hash(context.previousEventHash), "NATIVE_HISTORY_CURSOR_GAP");
  const occurredAt = ledgerUnix(tx), evidence = nativeEvidence(tx), node = loanNode(tx, loanId);
  const final = object(node.FinalFields ?? node.NewFields ?? {}), flags = integer(final.Flags ?? 0);
  const base = { tx, occurredAt, native: evidence, history: { complete: true as const, originHash: hash(context.originHash), previousEventId: context.eventCursor } };
  if (json.TransactionType === "LoanPay") {
    const change = loanPrincipalChange(tx, loanId);
    return { ...base, kind: "REPAYMENT" as const, repayment: { principalReductionMinor: nativeAmountToMinor(change.reduction, context.moneyScale ?? 100n, context.nativeAssetScale ?? 0), fullContractualRepayment: change.fullContractualRepayment,
      onTime: occurredAt <= context.nextDueAt && (flags & IMPAIRED) === 0, ...(change.fullContractualRepayment || change.nextPaymentDueAt === undefined ? {} : { nextPaymentDueAt: change.nextPaymentDueAt }) } };
  }
  need(json.TransactionType === "LoanManage" && node.change === "ModifiedNode", "NATIVE_SERVICING_REQUIRED");
  const action = integer(json.Flags ?? 0) & (65536 | 131072 | 262144);
  if (action === 65536) {
    need((flags & DEFAULT) !== 0 && occurredAt >= context.nextDueAt + context.graceSeconds, "NATIVE_DEFAULT_PREMATURE_OR_UNCONFIRMED");
    return { ...base, kind: "DEFAULT" as const };
  }
  const nextPaymentDueAt = EPOCH + integer(final.NextPaymentDueDate, true);
  if (action === 131072) {
    need((flags & IMPAIRED) !== 0, "NATIVE_IMPAIRMENT_UNCONFIRMED");
    return { ...base, kind: "IMPAIRMENT" as const, servicing: { nextPaymentDueAt } };
  }
  need(action === 262144 && (flags & (DEFAULT | IMPAIRED)) === 0, "NATIVE_UNIMPAIRMENT_UNCONFIRMED");
  return { ...base, kind: "UNIMPAIRMENT" as const, servicing: { nextPaymentDueAt } };
}

export interface NativeEventShape {
  eventId: string; kind: string; occurredAt: number; requestId?: string; loanId?: string; creditId?: string;
  conclusive?: boolean;
  native?: { txHash: string; ledgerIndex: number; transactionIndex: number; validated: boolean; result: string; transactionType: string };
  stake?: { amountU: string; repAsset: RepAssetRef; sender: string; destination: string; requestHash: string; partialPayment: false };
  loan?: { loanId: string; maturityAt: number; graceSeconds: number; nextPaymentDueAt?: number };
  repayment?: { principalReductionMinor: string; fullContractualRepayment: boolean; onTime: boolean; nextPaymentDueAt?: number };
  servicing?: { nextPaymentDueAt: number };
  history?: { complete: true; originHash: string; previousEventId: string | null };
  returned?: { amountU: string; repAsset: RepAssetRef; sender: string; destination: string; partialPayment: false; attemptHash?: string };
}
export interface NativeBindingShape {
  mode: string; network: string; borrowerAccount: string; asset: AssetRef; repAsset: RepAssetRef;
  request: { requestId: string; payloadHash: string; originalBondU: string; request: AtomicReservationRequest } | null;
  returnCredit: { creditId: string; amountU: string } | null;
  returnAttempt: { attemptHash: string; preparedFields: Record<string, unknown> } | null;
}
export interface LedgerVerifierOptions {
  client: NativeQueryClient; expectedNetworkId?: number; borrowerAccount: string; brokerId: string;
  brokerAccount?: string; loanAsset: AssetRef; repAsset: RepAssetRef; moneyScale?: bigint; loanAssetScale?: number;
  originationFee?: string; serviceFee?: string; maxInventoryPages?: number;
  getApprovedOffer?: (commercialTermsHash: string) => LenderFacilityOffer | undefined;
  getPreparedFields?: (requestId: string) => Record<string, unknown> | undefined;
  getAttemptHash?: (requestId: string, phase: "STAKE" | "LOAN") => string | undefined;
  getLoanContext?: (loanId: string) => LoanVerificationContext | undefined;
}
function assertPayment(raw: unknown, account: string, destination: string, issuance: string, amountU: string): void {
  const tx = txJson(raw), amount = tx.DeliverMax ?? tx.Amount;
  if (tx.DeliverMax !== undefined && tx.Amount !== undefined) eq(tx.DeliverMax, tx.Amount, "NATIVE_AMOUNT_ALIASES_DIFFER");
  need(tx.TransactionType === "Payment" && tx.Account === account && tx.Destination === destination, "NATIVE_PAYMENT_PARTIES_MISMATCH");
  eq(amount, { mpt_issuance_id: issuance, value: amountU }, "NATIVE_PAYMENT_AMOUNT_MISMATCH");
  need((integer(tx.Flags ?? 0) & 0x20000) === 0 && tx.SendMax === undefined && tx.DeliverMin === undefined && tx.Paths === undefined, "NATIVE_PARTIAL_OR_ROUTED_PAYMENT");
}
function balanceDelta(raw: unknown, account: string, issuance: string): bigint {
  const node = only(affectedNodes(raw).filter(n => {
    const f = object(n.NewFields ?? n.FinalFields ?? {});
    return n.LedgerEntryType === "MPToken" && f.Account === account && upper(f.MPTokenIssuanceID) === upper(issuance);
  }), "NATIVE_TOKEN_BALANCE_CHANGE_REQUIRED");
  const f = object(node.NewFields ?? node.FinalFields), before = object(node.PreviousFields ?? {});
  const afterU = node.change === "DeletedNode" ? 0n : BigInt(nativeAmountToMinor(String(f.MPTAmount ?? "0"), 1n));
  const beforeU = node.change === "CreatedNode" ? 0n : BigInt(nativeAmountToMinor(String(before.MPTAmount ?? f.MPTAmount ?? "0"), 1n));
  return afterU - beforeU;
}
async function validatedLedger(client: NativeQueryClient) {
  const result = responseResult(await client.request({ command: "ledger", ledger_index: "validated", transactions: false }));
  need(result.validated === true, "NATIVE_LEDGER_NOT_VALIDATED");
  const ledger = object(result.ledger);
  return { index: integer(result.ledger_index ?? ledger.ledger_index, true), hash: hash(result.ledger_hash ?? ledger.ledger_hash), ledger };
}
async function entry(client: NativeQueryClient, ledgerIndex: number, selector: Json): Promise<Json> {
  const result = responseResult(await client.request({ command: "ledger_entry", ledger_index: ledgerIndex, binary: false, ...selector }));
  need(result.validated === true, "NATIVE_ENTRY_NOT_VALIDATED");
  if (result.ledger_index !== undefined) need(integer(result.ledger_index, true) === ledgerIndex, "NATIVE_LEDGER_MISMATCH");
  if (selector.index !== undefined) need(upper(result.index) === upper(selector.index), "NATIVE_ENTRY_INDEX_MISMATCH");
  return object(result.node);
}
function missingTransaction(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Json, data = e.data && typeof e.data === "object" ? e.data as Json : {};
  return e.error === "txnNotFound" || data.error === "txnNotFound";
}

export function createLedgerNativeVerifiers(options: LedgerVerifierOptions) {
  const { client } = options;
  async function network() { await assertDevnet(client, options.expectedNetworkId ?? 2); }
  /** Configuration proof for restart. The caller must reconcile stored debt and pending attempts separately. */
  async function verifyAssetConfiguration(expected: { lenderId?: string } = {}) {
    await network();
    const pinned = await validatedLedger(client);
    const issuance = await entry(client, pinned.index, { mpt_issuance: options.repAsset.mpt_issuance_id });
    const holder = await entry(client, pinned.index, { mptoken: { mpt_issuance_id: options.repAsset.mpt_issuance_id, account: options.borrowerAccount } });
    need(issuance.LedgerEntryType === "MPTokenIssuance" && issuance.Issuer === options.repAsset.issuer && integer(issuance.AssetScale ?? 0) === 6 && integer(issuance.Flags) === 4 && (integer(issuance.ImmutableFlags ?? 0) & 126) === 126, "NATIVE_REP_CAPABILITIES_MISMATCH");
    need(holder.LedgerEntryType === "MPToken" && holder.Account === options.borrowerAccount && upper(holder.MPTokenIssuanceID) === upper(options.repAsset.mpt_issuance_id) && (integer(holder.Flags) & 2) === 2 && (integer(holder.Flags) & 1) === 0, "NATIVE_REP_HOLDER_NOT_AUTHORIZED");
    const balance = String(holder.MPTAmount ?? "0");
    nativeAmountToMinor(balance, 1n);
    const broker = await entry(client, pinned.index, { index: options.brokerId });
    need(broker.LedgerEntryType === "LoanBroker" && typeof broker.Owner === "string" && (!expected.lenderId || broker.Owner === expected.lenderId) && (!options.brokerAccount || broker.Owner === options.brokerAccount), "NATIVE_BROKER_OWNER_MISMATCH");
    const vault = await entry(client, pinned.index, { index: hash(broker.VaultID) });
    eq(vault.Asset, options.loanAsset, "NATIVE_VAULT_ASSET_MISMATCH");
    need(vault.LedgerEntryType === "Vault", "NATIVE_VAULT_REQUIRED");
    need("mpt_issuance_id" in options.loanAsset && MPT.test(options.loanAsset.mpt_issuance_id), "NATIVE_MPT_LOAN_REQUIRED");
    const loanIssue = await entry(client, pinned.index, { mpt_issuance: options.loanAsset.mpt_issuance_id });
    const loanAssetScale = integer(loanIssue.AssetScale ?? 0);
    need(loanIssue.LedgerEntryType === "MPTokenIssuance" && loanAssetScale === (options.loanAssetScale ?? 0), "NATIVE_LOAN_SCALE_MISMATCH");
    return { ledgerIndex: pinned.index, ledgerHash: pinned.hash, borrowerRepBalanceU: balance, brokerOwner: broker.Owner, loanAssetScale };
  }
  async function verifyNativePortfolio(seed: Readonly<{ mode: string; network: string; loan_asset: AssetRef; rep_asset: RepAssetRef; money_scale: number; facility: { lender_id: string; asset: AssetRef }; opening: { active_principal_minor: string; reserved_principal_minor: string; defaulted_principal_minor: string; reputation: { seed_u: string; available_u: string; reserved_u: string; bonded_u: string; pending_return_u: string; growth_u: string; forfeited_u: string; suspended: boolean } }; opening_loans: unknown[] }>, borrowerAccount: string, _evidence: unknown): Promise<void> {
    await network();
    need(seed.mode === "LIVE_DEVNET" && seed.network === "devnet" && borrowerAccount === options.borrowerAccount, "NATIVE_PORTFOLIO_CONTEXT_MISMATCH");
    eq(seed.loan_asset, options.loanAsset, "NATIVE_LOAN_ASSET_MISMATCH"); eq(seed.facility.asset, options.loanAsset, "NATIVE_LOAN_ASSET_MISMATCH"); eq(seed.rep_asset, options.repAsset, "NATIVE_REP_ASSET_MISMATCH");
    need(BigInt(seed.money_scale) === (options.moneyScale ?? 100n), "NATIVE_MONEY_SCALE_MISMATCH");
    need(seed.opening_loans.length === 0 && [seed.opening.active_principal_minor, seed.opening.reserved_principal_minor, seed.opening.defaulted_principal_minor].every(v => v === "0"), "NATIVE_OPENING_HISTORY_REQUIRED");
    const reputation = seed.opening.reputation;
    need([reputation.reserved_u, reputation.bonded_u, reputation.pending_return_u, reputation.growth_u, reputation.forfeited_u].every(v => v === "0") && !reputation.suspended && reputation.seed_u === reputation.available_u, "NATIVE_OPENING_HISTORY_REQUIRED");
    const configuration = await verifyAssetConfiguration({ lenderId: seed.facility.lender_id });
    need(configuration.borrowerRepBalanceU === reputation.available_u, "NATIVE_REP_BALANCE_MISMATCH");
    const pinned = { index: configuration.ledgerIndex, hash: configuration.ledgerHash };
    let marker: unknown;
    const seen = new Set<string>(), maximum = options.maxInventoryPages ?? 1000;
    for (let page = 0; ; page++) {
      need(page < maximum, "NATIVE_INVENTORY_LIMIT");
      const result = responseResult(await client.request({ command: "ledger_data", ledger_index: pinned.index, ledger_hash: pinned.hash, type: "Loan", binary: false, limit: 256, ...(marker === undefined ? {} : { marker }) }));
      need(result.validated === true && integer(result.ledger_index, true) === pinned.index && hash(result.ledger_hash) === pinned.hash && Array.isArray(result.state), "NATIVE_INVENTORY_INCOMPLETE");
      for (const raw of result.state) {
        const loan = object(raw); need(loan.LedgerEntryType === "Loan", "NATIVE_INVENTORY_WRONG_TYPE");
        if (loan.Borrower !== borrowerAccount) continue;
        const flags = integer(loan.Flags ?? 0);
        need((flags & (DEFAULT | IMPAIRED)) === 0 && BigInt(nativeAmountToMinor(String(loan.PrincipalOutstanding ?? "0"), 10n ** 18n)) === 0n && BigInt(nativeAmountToMinor(String(loan.TotalValueOutstanding ?? "0"), 10n ** 18n)) === 0n && integer(loan.PaymentRemaining ?? 0) === 0, "NATIVE_OPENING_HISTORY_REQUIRED");
      }
      marker = result.marker;
      if (marker === undefined) break;
      const encoded = canonicalJson(marker); need(!seen.has(encoded), "NATIVE_INVENTORY_MARKER_CYCLE"); seen.add(encoded);
    }
  }

  async function verifyNativeEvent(event: Readonly<NativeEventShape>, binding: Readonly<NativeBindingShape>): Promise<void> {
    await network();
    need(binding.mode === "LIVE_DEVNET" && binding.network === "devnet" && binding.borrowerAccount === options.borrowerAccount, "NATIVE_EVENT_CONTEXT_MISMATCH");
    eq(binding.asset, options.loanAsset, "NATIVE_LOAN_ASSET_MISMATCH"); eq(binding.repAsset, options.repAsset, "NATIVE_REP_ASSET_MISMATCH");
    need(event.native, "NATIVE_EVIDENCE_REQUIRED");
    if (event.kind === "CANCEL_BEFORE_BURN" || event.kind === "FAIL_AFTER_BURN") {
      const phase = event.kind === "CANCEL_BEFORE_BURN" ? "STAKE" : "LOAN", request = binding.request;
      need(request && event.conclusive === true && options.getAttemptHash?.(request.requestId, phase)?.toUpperCase() === hash(event.native.txHash), "NATIVE_PERSISTED_ATTEMPT_REQUIRED");
      const failed = assertQueriedTransaction(await client.request({ command: "tx", transaction: hash(event.native.txHash), binary: false, api_version: 2 }), event.native.txHash, true);
      need(/^tec[A-Z0-9_]+$/.test(String(failed.meta.TransactionResult)), "NATIVE_FAILURE_NOT_FINAL");
      eq(event.native, { txHash: failed.hash, ledgerIndex: failed.ledger_index, transactionIndex: integer(failed.meta.TransactionIndex), validated: true, result: "CONCLUSIVE_FAILURE", transactionType: failed.tx_json.TransactionType }, "NATIVE_EVIDENCE_MISMATCH");
      need(event.occurredAt === ledgerUnix(failed), "NATIVE_EVENT_TIME_MISMATCH");
      if (phase === "STAKE") {
        assertPayment(failed, binding.borrowerAccount, binding.repAsset.issuer, binding.repAsset.mpt_issuance_id, request.originalBondU);
      } else {
        const prepared = options.getPreparedFields?.(request.requestId);
        need(prepared && failed.tx_json.TransactionType === "LoanSet", "NATIVE_PREPARED_FIELDS_REQUIRED");
        for (const [key, value] of Object.entries(prepared)) eq(failed.tx_json[key], value, "NATIVE_PREPARED_FIELD_MISMATCH");
        need(!affectedNodes(failed).some(n => n.LedgerEntryType === "Loan"), "NATIVE_FAILURE_CREATED_LOAN");
      }
      return;
    }
    const tx = await getValidatedTx(client, event.native.txHash), json = tx.tx_json;
    eq(event.native, nativeEvidence(tx), "NATIVE_EVIDENCE_MISMATCH"); need(event.occurredAt === ledgerUnix(tx), "NATIVE_EVENT_TIME_MISMATCH");
    if (event.kind === "STAKE_VALIDATED") {
      const request = binding.request;
      need(request && event.stake, "NATIVE_STAKE_REQUEST_REQUIRED");
      need(options.getAttemptHash?.(request.requestId, "STAKE")?.toUpperCase() === tx.hash, "NATIVE_PERSISTED_ATTEMPT_REQUIRED");
      assertPayment(tx, binding.borrowerAccount, binding.repAsset.issuer, binding.repAsset.mpt_issuance_id, request.originalBondU);
      need(event.stake.requestHash === request.payloadHash && event.stake.amountU === request.originalBondU, "NATIVE_STAKE_COMMITMENT_MISMATCH");
      const memos = json.Memos;
      need(Array.isArray(memos) && memos.some(raw => { const m = object(object(raw).Memo); return m.MemoType === Buffer.from("shellfish-request").toString("hex").toUpperCase() && m.MemoData === Buffer.from(request.payloadHash).toString("hex").toUpperCase(); }), "NATIVE_STAKE_MEMO_REQUIRED");
      need(balanceDelta(tx, binding.borrowerAccount, binding.repAsset.mpt_issuance_id) === -BigInt(request.originalBondU), "NATIVE_STAKE_DELIVERY_MISMATCH");
      return;
    }
    if (event.kind === "ORIGINATION_VALIDATED") {
      const request = binding.request;
      need(request && event.loan && json.TransactionType === "LoanSet", "NATIVE_ORIGINATION_REQUEST_REQUIRED");
      need(options.getAttemptHash?.(request.requestId, "LOAN")?.toUpperCase() === tx.hash, "NATIVE_PERSISTED_ATTEMPT_REQUIRED");
      const prepared = options.getPreparedFields?.(request.requestId);
      need(prepared, "NATIVE_PREPARED_FIELDS_REQUIRED");
      for (const [key, value] of Object.entries(prepared)) eq(json[key], value, "NATIVE_PREPARED_FIELD_MISMATCH");
      const allowedExtra = new Set(["TxnSignature", "CounterpartySignature", "Signers", "hash", "ledger_index", "date", "ctid"]);
      need(Object.keys(json).every(key => key in prepared || allowedExtra.has(key)), "NATIVE_UNAPPROVED_FIELD");
      const offer = options.getApprovedOffer?.(request.request.commercial_terms_hash);
      need(offer, "NATIVE_APPROVED_OFFER_REQUIRED");
      need(json.Account === (options.brokerAccount ?? offer.lender_id) && json.Counterparty === binding.borrowerAccount && upper(json.LoanBrokerID) === hash(options.brokerId), "NATIVE_ORIGINATION_PARTIES_MISMATCH");
      need(nativeAmountToMinor(String(json.PrincipalRequested), options.moneyScale ?? 100n, options.loanAssetScale ?? 0) === request.request.principal_minor, "NATIVE_ORIGINATION_PRINCIPAL_MISMATCH");
      need(integer(json.InterestRate ?? 0) === offer.apr_bps * 10 && integer(json.PaymentTotal, true) === offer.schedule.payment_total && integer(json.PaymentInterval, true) === offer.schedule.payment_interval_seconds, "NATIVE_ORIGINATION_TERMS_MISMATCH");
      eq(String(json.LoanOriginationFee ?? "0"), options.originationFee ?? "0", "NATIVE_ORIGINATION_FEE_MISMATCH"); eq(String(json.LoanServiceFee ?? "0"), options.serviceFee ?? "0", "NATIVE_SERVICE_FEE_MISMATCH");
      const loan = createdNode(tx, "Loan");
      need(loan.fields.Borrower === binding.borrowerAccount && upper(loan.fields.LoanBrokerID) === hash(options.brokerId) && nativeAmountToMinor(String(loan.fields.PrincipalOutstanding), options.moneyScale ?? 100n, options.loanAssetScale ?? 0) === request.request.principal_minor, "NATIVE_CREATED_LOAN_MISMATCH");
      eq(event.loan, deriveOrigination(tx), "NATIVE_LOAN_SCHEDULE_MISMATCH");
      return;
    }
    if (["REPAYMENT", "DEFAULT", "IMPAIRMENT", "UNIMPAIRMENT"].includes(event.kind)) {
      need(event.loanId, "NATIVE_LOAN_ID_REQUIRED");
      const context = options.getLoanContext?.(event.loanId);
      need(context, "NATIVE_LOAN_CONTEXT_REQUIRED");
      const outcome = await deriveLoanOutcome(client, event.loanId, tx.hash, { ...context, moneyScale: options.moneyScale ?? context.moneyScale, nativeAssetScale: options.loanAssetScale ?? context.nativeAssetScale });
      need(outcome.kind === event.kind, "NATIVE_SERVICING_KIND_MISMATCH");
      eq(event.history, outcome.history, "NATIVE_HISTORY_BINDING_MISMATCH");
      if ("repayment" in outcome) eq(event.repayment, outcome.repayment, "NATIVE_REPAYMENT_MISMATCH");
      if ("servicing" in outcome) eq(event.servicing, outcome.servicing, "NATIVE_SERVICING_SCHEDULE_MISMATCH");
      return;
    }
    if (event.kind === "RETURN_VALIDATED") {
      need(binding.returnCredit && binding.returnAttempt && event.returned, "NATIVE_RETURN_CONTEXT_REQUIRED");
      need(binding.returnAttempt.attemptHash.toUpperCase() === tx.hash && event.creditId === binding.returnCredit.creditId, "NATIVE_RETURN_ATTEMPT_MISMATCH");
      assertPayment(tx, binding.repAsset.issuer, binding.borrowerAccount, binding.repAsset.mpt_issuance_id, binding.returnCredit.amountU);
      for (const [key, value] of Object.entries(binding.returnAttempt.preparedFields)) eq(key === "Amount" ? json.DeliverMax ?? json.Amount : json[key], value, "NATIVE_RETURN_FIELD_MISMATCH");
      need(balanceDelta(tx, binding.borrowerAccount, binding.repAsset.mpt_issuance_id) === BigInt(binding.returnCredit.amountU), "NATIVE_RETURN_DELIVERY_MISMATCH");
      return;
    }
    fail("NATIVE_EVENT_UNSUPPORTED");
  }

  async function verifyReturnFailure(evidence: Readonly<{ kind: string; txHash?: string; ledgerIndex?: number; transactionIndex?: number; result?: string; validatedLedgerIndex?: number; historyFromLedger?: number; historyToLedger?: number; accountSequence?: number }>, context: Readonly<{ instruction: { issuer: string; network: string; mode: string }; attempt: { attemptHash: string; firstLedgerSequence: number; lastLedgerSequence: number; sequence: number; preparedFields: Record<string, unknown> } }>): Promise<void> {
    await network();
    need(context.instruction.mode === "LIVE_DEVNET" && context.instruction.network === "devnet" && context.instruction.issuer === options.repAsset.issuer && upper(evidence.txHash) === hash(context.attempt.attemptHash), "NATIVE_RETURN_FAILURE_CONTEXT_MISMATCH");
    if (evidence.kind === "VALIDATED_FAILURE") {
      const tx = assertQueriedTransaction(await client.request({ command: "tx", transaction: evidence.txHash, binary: false, api_version: 2 }), context.attempt.attemptHash, true);
      need(typeof tx.meta.TransactionResult === "string" && /^tec[A-Z0-9_]+$/.test(tx.meta.TransactionResult) && evidence.result === tx.meta.TransactionResult && evidence.ledgerIndex === tx.ledger_index && evidence.transactionIndex === tx.meta.TransactionIndex, "NATIVE_FAILURE_NOT_FINAL");
      for (const [key, value] of Object.entries(context.attempt.preparedFields)) eq(key === "Amount" ? tx.tx_json.DeliverMax ?? tx.tx_json.Amount : tx.tx_json[key], value, "NATIVE_RETURN_FIELD_MISMATCH");
      return;
    }
    need(evidence.kind === "EXPIRED_NOT_FOUND", "NATIVE_FAILURE_EVIDENCE_UNSUPPORTED");
    let absent = false;
    try { await client.request({ command: "tx", transaction: evidence.txHash, binary: false, api_version: 2 }); }
    catch (error) { absent = missingTransaction(error); }
    need(absent, "NATIVE_ABSENCE_NOT_PROVEN");
    const pinned = await validatedLedger(client);
    need(pinned.index === evidence.validatedLedgerIndex && pinned.index > context.attempt.lastLedgerSequence && evidence.historyFromLedger === context.attempt.firstLedgerSequence && evidence.historyToLedger === pinned.index, "NATIVE_ABSENCE_RANGE_MISMATCH");
    const account = responseResult(await client.request({ command: "account_info", account: context.instruction.issuer, ledger_index: pinned.index, strict: true }));
    need(account.validated === true && object(account.account_data).Account === context.instruction.issuer && integer(object(account.account_data).Sequence, true) === evidence.accountSequence && evidence.accountSequence === context.attempt.sequence, "NATIVE_ISSUER_SEQUENCE_DIVERGED");
    let marker: unknown; const seen = new Set<string>();
    for (let page = 0; ; page++) {
      need(page < (options.maxInventoryPages ?? 1000), "NATIVE_HISTORY_LIMIT");
      const result = responseResult(await client.request({ command: "account_tx", account: context.instruction.issuer, ledger_index_min: context.attempt.firstLedgerSequence, ledger_index_max: pinned.index, forward: true, binary: false, limit: 200, ...(marker === undefined ? {} : { marker }) }));
      need(result.validated === true && result.ledger_index_min === context.attempt.firstLedgerSequence && result.ledger_index_max === pinned.index && Array.isArray(result.transactions), "NATIVE_ACCOUNT_HISTORY_INCOMPLETE");
      for (const raw of result.transactions) {
        const item = object(raw), json = txJson(item), h = item.hash ?? json.hash;
        need(item.validated === true && typeof h === "string" && HASH.test(h), "NATIVE_ACCOUNT_HISTORY_INCOMPLETE");
        need(upper(h) !== hash(context.attempt.attemptHash), "NATIVE_RETURN_WAS_APPLIED");
      }
      marker = result.marker;
      if (marker === undefined) break;
      const key = canonicalJson(marker); need(!seen.has(key), "NATIVE_HISTORY_MARKER_CYCLE"); seen.add(key);
    }
  }
  return { verifyNativePortfolio, verifyNativeEvent, verifyReturnFailure, verifyAssetConfiguration };
}
