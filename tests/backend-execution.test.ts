import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

import { createRegistry, createExecutionStore, contentHash } from "../packages/registry/src/index.ts";
import { withoutFields, type LenderFacilityOffer } from "../packages/schemas/src/index.ts";
import { createNativeTransport, originateLoan, NativeExecutionPending, NativeExecutionBusy, normalizePaymentAliases, verifySignedNative } from "../packages/xrpl/src/index.ts";
const require = createRequire(new URL("../services/api/package.json", import.meta.url));
const Database = require("better-sqlite3");
const { Wallet, decode } = createRequire(new URL("../packages/xrpl/package.json", import.meta.url))("xrpl");
const fixture = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures", name), "utf8"));
const folders: string[] = [];
const databases: InstanceType<typeof Database>[] = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }); });

async function setup() {
  const borrower = Wallet.generate(), broker = Wallet.generate(), issuer = Wallet.generate();
  const scenario = fixture("scenario.json");
  const now = Math.floor(Date.parse(scenario.clock) / 1000);
  const asset = { mpt_issuance_id: "A".repeat(48) }, rep = { mpt_issuance_id: "B".repeat(48), issuer: issuer.classicAddress, asset_scale: 6 };
  scenario.mode = "LIVE_DEVNET"; delete scenario.provenance; delete scenario.native_signing_permitted;
  scenario.principal_id = `devnet:${borrower.classicAddress}`; scenario.loan_asset = asset; scenario.rep_asset = rep;
  scenario.facility.asset = asset; scenario.facility.lender_id = broker.classicAddress;
  scenario.opening_loans = [];
  Object.assign(scenario.opening, { active_principal_minor: "0", reserved_principal_minor: "0", defaulted_principal_minor: "0", facility_committed_minor: "0", facility_reserved_minor: "0" });
  Object.assign(scenario.opening.reputation, { available_u: "1000000000", bonded_u: "0", reserved_u: "0", growth_u: "0", pending_return_u: "0", forfeited_u: "0" });
  const folder = mkdtempSync(resolve(tmpdir(), "shellfish-execution-")); folders.push(folder);
  const db = new Database(resolve(folder, "credit.db")); databases.push(db);
  const registry = createRegistry(db, { now: () => new Date(now * 1000), verifyNativePortfolio: async () => {}, verifyNativeEvent: async () => {} });
  // Trusted verifier doubles are explicit: these tests execute no ledger transaction.
  await registry.initializeNativePortfolio(scenario, borrower.classicAddress, { test: true });
  const offer = fixture("offer-lender-a.json") as LenderFacilityOffer;
  Object.assign(offer, { mode: "LIVE_DEVNET", asset, borrower_id: scenario.principal_id, lender_id: broker.classicAddress, principal: "1000.00" });
  const keys = ["lender_id", "borrower_id", "facility_id", "offer_id", "asset", "principal", "apr_bps", "rate_kind", "term_days", "fees", "purpose", "expires_at", "schedule", "network"];
  offer.commercial_terms_hash = contentHash(Object.fromEntries(Object.entries(offer).filter(([key]) => keys.includes(key))));
  offer.offer_hash = contentHash(withoutFields(offer, ["offer_hash", "lender_signature"]));
  const request = fixture("reservation.json").request;
  Object.assign(request, { mode: "LIVE_DEVNET", asset, rep_asset: rep, principal_id: scenario.principal_id, principal_minor: "100000", commercial_terms_hash: offer.commercial_terms_hash });
  const record = registry.reserveRequest(request);
  const execution = createExecutionStore(db, { now: () => new Date(now * 1000) });
  const submitted: string[] = [], records = new Map<string, Record<string, unknown>>();
  let failSubmission = false, beforeLookup: (() => Promise<void>) | undefined, ledgerIndex = 99;
  const config = { wsUrl: "wss://example.invalid", borrowerSeed: borrower.seed!, brokerSeed: broker.seed!, repIssuerSeed: issuer.seed!, repIssuerAddress: issuer.classicAddress,
    loanBrokerId: "C".repeat(64), loanMptIssuanceId: asset.mpt_issuance_id, loanAssetScale: 6, repIssuanceId: rep.mpt_issuance_id, paymentTotal: 1, paymentIntervalSec: 7776000, gracePeriodSec: 60, loanOriginationFee: "0", loanServiceFee: "0" };
  let autofills = 0;
  const client = {
    async autofill(raw: Record<string, unknown>) { autofills++; return { ...raw, Fee: "12", Sequence: raw.Account === broker.classicAddress ? 2 : 1, LastLedgerSequence: 120 }; },
    async submitAndWait(blob: string) {
      const tx = decode(blob) as unknown as Record<string, unknown>;
      const phase = tx.TransactionType === "LoanSet" ? "LOAN" : "STAKE";
      const persisted = execution.getAttempt(request.request_id, phase)!;
      expect(persisted.signedBlob).toBe(blob);
      expect(["SUBMITTED", "RECONCILING"]).toContain(persisted.state);
      submitted.push(blob);
      if (failSubmission) throw new Error("TEST_TIMEOUT");
      const fields = { Borrower: borrower.classicAddress, LoanBrokerID: config.loanBrokerId, StartDate: now - 946684800, NextPaymentDueDate: now - 946684800 + 7776000, PaymentInterval: 7776000, GracePeriod: 60 };
      records.set(persisted.attemptHash, { hash: persisted.attemptHash, validated: true, ledger_index: 100, close_time_iso: new Date(now * 1000).toISOString(), tx_json: tx,
        meta: { TransactionResult: "tesSUCCESS", TransactionIndex: phase === "STAKE" ? 0 : 1,
          AffectedNodes: phase === "LOAN" ? [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: "D".repeat(64), NewFields: fields } }] : [] } });
    },
    async request(input: Record<string, unknown>) {
      if (input.command === "tx") {
        if (beforeLookup) { const barrier = beforeLookup; beforeLookup = undefined; await barrier(); }
        const tx = records.get(String(input.transaction));
        if (!tx) throw Object.assign(new Error("notfound"), { data: { error: "txnNotFound" } });
        return { result: tx };
      }
      if (input.command === "server_info") return { result: { info: { network_id: 2 } } };
      if (input.command === "ledger") return { result: { validated: true, ledger_index: ledgerIndex, ledger: { ledger_index: ledgerIndex, close_time: now - 946684800 } } };
      throw new Error("Unexpected RPC command");
    },
  } as never;
  const transport = createNativeTransport(client, config);
  let laneFence = 0;
  const signerLanes = {
    claim: (input: { operationId: string }) => ({ acquired: true as const, operationId: input.operationId, lanes: [{ key: "test", fence: ++laneFence }] }),
    assertClaim: () => {}, release: () => true,
  };
  const context = { getRequest: (id: string) => registry.getRequest(id), applyEvent: (event: unknown) => registry.applyEvent(event as never), hashRequest: contentHash,
    getApprovedOffer: (hash: string) => hash === offer.commercial_terms_hash ? offer : undefined, clockSeconds: () => now, borrowerAccount: borrower.classicAddress,
    repAsset: rep as { mpt_issuance_id: string; issuer: string; asset_scale: 6 }, live: { transport, redeemStake: async () => { throw new Error("legacy path forbidden"); }, originateLoanSet: async () => { throw new Error("legacy path forbidden"); }, repayLoanPay: async () => { throw new Error("legacy path forbidden"); } }, execution, signerLanes };
  const proposed = { proposalHash: contentHash(request), principal: offer.principal, aprBps: offer.apr_bps, termDays: offer.term_days, asset: JSON.stringify(asset), networkMode: "LIVE_DEVNET" as const, requestId: request.request_id, reservationId: record.reservationId };
  return { registry, execution, request, context, proposed, submitted, transport, get autofills() { return autofills; }, setFail: (value: boolean) => { failSubmission = value; }, setLedgerIndex: (value: number) => { ledgerIndex = value; }, blockLookup: (callback: () => Promise<void>) => { beforeLookup = callback; } };
}

describe("durable native origination", () => {
  it("persists exact real signed blobs before submit and freezes LoanSet before signature", async () => {
    const env = await setup();
    const result = await originateLoan(env.proposed, env.context);
    expect(result.validated).toBe(true);
    expect(result.loanId).toBe("D".repeat(64));
    expect(env.submitted).toHaveLength(2);
    expect(env.execution.getAttempt(env.request.request_id, "STAKE")?.state).toBe("VALIDATED");
    expect(env.execution.getAttempt(env.request.request_id, "LOAN")?.commitment).toBe(result.preparedTxCommitment);
    expect(env.registry.getRequest(env.request.request_id).state).toBe("ACTIVE");
  });

  it("retains reservations on timeout and resumes the saved stake blob without re-signing", async () => {
    const env = await setup(); env.setFail(true);
    await expect(originateLoan(env.proposed, env.context)).rejects.toBeInstanceOf(NativeExecutionPending);
    const saved = env.execution.getAttempt(env.request.request_id, "STAKE")!;
    expect(saved.state).toBe("RECONCILING");
    expect(env.registry.getRequest(env.request.request_id).state).toBe("RECONCILING");
    expect(env.registry.getCreditStatus("facility-A-001").portfolio.reputation.reserved_u).toBe("240000000");
    env.setFail(false);
    await originateLoan(env.proposed, env.context);
    expect(env.submitted[0]).toBe(env.submitted[1]);
    expect(env.autofills).toBe(2); // One stake, one LoanSet across both executions.
  });

  it("returns completed native outcome without another signature, submission or RPC", async () => {
    const env = await setup();
    const first = await originateLoan(env.proposed, env.context);
    const count = env.submitted.length;
    const second = await originateLoan(env.proposed, env.context);
    expect(second).toEqual(first);
    expect(env.submitted).toHaveLength(count);
  });

  it("one active executor fence rejects a simultaneous identical request", async () => {
    const env = await setup(); let unblock!: () => void, reached!: () => void;
    const arrived = new Promise<void>(resolve => { reached = resolve; });
    const barrier = new Promise<void>(resolve => { unblock = resolve; });
    env.blockLookup(async () => { reached(); await barrier; });
    const first = originateLoan(env.proposed, env.context);
    await arrived;
    await expect(originateLoan(env.proposed, env.context)).rejects.toBeInstanceOf(NativeExecutionBusy);
    unblock(); await first;
    expect(env.submitted).toHaveLength(2);
  });

  it("native path cannot use high-level sign-and-submit shortcuts without persistence", async () => {
    const env = await setup();
    await expect(originateLoan(env.proposed, { ...env.context, execution: undefined })).rejects.toThrow("DURABLE_NATIVE_EXECUTION_REQUIRED");
    expect(env.submitted).toHaveLength(0);
  });

  it("rejects term mutation before creating a stake attempt", async () => {
    const env = await setup();
    await expect(originateLoan({ ...env.proposed, termDays: 360 }, env.context)).rejects.toThrow(/proposed terms/);
    expect(env.execution.getAttempt(env.request.request_id, "STAKE")).toBeNull();
    expect(env.submitted).toHaveLength(0);
  });

  it("normalizes Payment aliases but rejects conflicting atomic values", async () => {
    const env = await setup();
    const fields = await env.transport.prepareTransaction("repIssuer", { TransactionType: "Payment", Account: env.transport.addresses.repIssuer,
      Destination: env.transport.addresses.borrower, Amount: { mpt_issuance_id: env.transport.config.repIssuanceId, value: "2" } });
    const amount = fields.DeliverMax ?? fields.Amount; delete fields.DeliverMax; fields.Amount = amount;
    const signed = env.transport.signTransaction("repIssuer", fields);
    expect(() => verifySignedNative(signed)).not.toThrow();
    expect(() => normalizePaymentAliases({ ...fields, DeliverMax: { mpt_issuance_id: env.transport.config.repIssuanceId, value: "3" } })).toThrow(/ALIAS_CONFLICT/);
  });

  it("past LastLedgerSequence with absent tx stays RECONCILING without a replacement blob", async () => {
    const env = await setup();
    env.setFail(true);
    await expect(originateLoan(env.proposed, env.context)).rejects.toBeInstanceOf(NativeExecutionPending);
    const saved = env.execution.getAttempt(env.request.request_id, "STAKE")!;
    expect(saved.state).toBe("RECONCILING");
    expect(env.autofills).toBe(1);
    expect(env.submitted).toHaveLength(1);
    env.setFail(false);
    env.setLedgerIndex(200); // past LastLedgerSequence 120; still txnNotFound
    await expect(originateLoan(env.proposed, env.context)).rejects.toBeInstanceOf(NativeExecutionPending);
    const again = env.execution.getAttempt(env.request.request_id, "STAKE")!;
    expect(again.signedBlob).toBe(saved.signedBlob);
    expect(again.attemptHash).toBe(saved.attemptHash);
    expect(again.state).toBe("RECONCILING");
    expect(env.autofills).toBe(1);
    expect(env.submitted).toHaveLength(1);
    expect(env.registry.getRequest(env.request.request_id).state).toBe("RECONCILING");
  });

  it("acknowledgeExecutionRecovery clears only the exact owner and fence", async () => {
    const env = await setup();
    const guard = env.execution.claimExecution(env.request.request_id, "worker-a");
    expect(guard).toMatchObject({ acquired: true, owner: "worker-a", fence: 1 });
    expect(env.execution.acknowledgeExecutionRecovery(env.request.request_id, "worker-b", 1)).toBe(false);
    expect(env.execution.acknowledgeExecutionRecovery(env.request.request_id, "worker-a", 99)).toBe(false);
    expect(env.execution.getExecutionClaim(env.request.request_id)).toMatchObject({ active: true, owner: "worker-a", fence: 1 });
    expect(env.execution.acknowledgeExecutionRecovery(env.request.request_id, "worker-a", 1)).toBe(true);
    expect(env.execution.getExecutionClaim(env.request.request_id)).toMatchObject({ active: false });
    const next = env.execution.claimExecution(env.request.request_id, "worker-b");
    expect(next.acquired).toBe(true);
    if (!next.acquired) throw new Error("expected claim");
    expect(next.owner).toBe("worker-b");
    expect(next.fence).toBeGreaterThan(1);
    env.execution.releaseExecution(next);
  });
});
