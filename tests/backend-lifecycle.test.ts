import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

import { createRegistry, createExecutionStore, contentHash } from "../packages/registry/src/index.ts";
import { withoutFields, type LenderFacilityOffer } from "../packages/schemas/src/index.ts";
import {
  createNativeTransport,
  createLifecycleStore,
  createLifecycleWorker,
  originateLoan,
  LifecycleError,
} from "../packages/xrpl/src/index.ts";

const require = createRequire(new URL("../services/api/package.json", import.meta.url));
const Database = require("better-sqlite3");
const { Wallet, decode } = createRequire(new URL("../packages/xrpl/package.json", import.meta.url))("xrpl");
const fixture = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures", name), "utf8"));
const folders: string[] = [];
const databases: InstanceType<typeof Database>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function setup() {
  const borrower = Wallet.generate(), broker = Wallet.generate(), issuer = Wallet.generate();
  const scenario = fixture("scenario.json");
  const now = Math.floor(Date.parse(scenario.clock) / 1000);
  const asset = { mpt_issuance_id: "A".repeat(48) };
  const rep = { mpt_issuance_id: "B".repeat(48), issuer: issuer.classicAddress, asset_scale: 6 as const };
  scenario.mode = "LIVE_DEVNET"; delete scenario.provenance; delete scenario.native_signing_permitted;
  scenario.principal_id = `devnet:${borrower.classicAddress}`;
  scenario.loan_asset = asset; scenario.rep_asset = rep;
  scenario.facility.asset = asset; scenario.facility.lender_id = broker.classicAddress;
  scenario.opening_loans = [];
  Object.assign(scenario.opening, {
    active_principal_minor: "0", reserved_principal_minor: "0", defaulted_principal_minor: "0",
    facility_committed_minor: "0", facility_reserved_minor: "0",
  });
  Object.assign(scenario.opening.reputation, {
    available_u: "1000000000", bonded_u: "0", reserved_u: "0", growth_u: "0", pending_return_u: "0", forfeited_u: "0",
  });
  const folder = mkdtempSync(resolve(tmpdir(), "shellfish-lifecycle-")); folders.push(folder);
  const db = new Database(resolve(folder, "credit.db")); databases.push(db);
  const registry = createRegistry(db, {
    now: () => new Date(now * 1000),
    verifyNativePortfolio: async () => {},
    verifyNativeEvent: async () => {},
  });
  await registry.initializeNativePortfolio(scenario, borrower.classicAddress, { test: true });
  const offer = fixture("offer-lender-a.json") as LenderFacilityOffer;
  Object.assign(offer, {
    mode: "LIVE_DEVNET", asset, borrower_id: scenario.principal_id, lender_id: broker.classicAddress, principal: "1000.00",
  });
  const keys = ["lender_id", "borrower_id", "facility_id", "offer_id", "asset", "principal", "apr_bps", "rate_kind", "term_days", "fees", "purpose", "expires_at", "schedule", "network"];
  offer.commercial_terms_hash = contentHash(Object.fromEntries(Object.entries(offer).filter(([key]) => keys.includes(key))));
  offer.offer_hash = contentHash(withoutFields(offer, ["offer_hash", "lender_signature"]));
  const request = fixture("reservation.json").request;
  Object.assign(request, {
    mode: "LIVE_DEVNET", asset, rep_asset: rep, principal_id: scenario.principal_id,
    principal_minor: "100000", commercial_terms_hash: offer.commercial_terms_hash,
  });
  const reserved = registry.reserveRequest(request);
  const execution = createExecutionStore(db, { now: () => new Date(now * 1000) });
  const lifecycleStore = createLifecycleStore(db, { hash: contentHash });
  const records = new Map<string, Record<string, unknown>>();
  let failSubmission = false, ledgerIndex = 99, ledgerUnix = now;
  const config = {
    wsUrl: "wss://example.invalid",
    borrowerSeed: borrower.seed!, brokerSeed: broker.seed!,
    repIssuerSeed: issuer.seed!, repIssuerAddress: issuer.classicAddress,
    loanBrokerId: "C".repeat(64), loanMptIssuanceId: asset.mpt_issuance_id, loanAssetScale: 6,
    repIssuanceId: rep.mpt_issuance_id, paymentTotal: 1, paymentIntervalSec: 7776000,
    gracePeriodSec: 604800, loanOriginationFee: "0", loanServiceFee: "0",
  };
  const client = {
    async autofill(raw: Record<string, unknown>) {
      return {
        ...raw, Fee: "12",
        Sequence: raw.Account === broker.classicAddress ? 2 : 1,
        LastLedgerSequence: ledgerIndex + 20,
      };
    },
    async submitAndWait(blob: string) {
      const tx = decode(blob) as unknown as Record<string, unknown>;
      const hash = (() => {
        if (tx.TransactionType === "LoanSet") return execution.getAttempt(request.request_id, "LOAN")!.attemptHash;
        if (tx.TransactionType === "Payment") return execution.getAttempt(request.request_id, "STAKE")!.attemptHash;
        const op = db.prepare("SELECT attempt_hash,signed_blob FROM credit_lifecycle_operations WHERE signed_blob=?").get(blob) as
          | { attempt_hash: string; signed_blob: string } | undefined;
        if (!op) throw new Error("lifecycle blob not persisted before submit");
        return op.attempt_hash;
      })();
      if (failSubmission) throw new Error("TEST_TIMEOUT");
      const fields = {
        Borrower: borrower.classicAddress, LoanBrokerID: config.loanBrokerId,
        StartDate: now - 946684800, NextPaymentDueDate: now - 946684800 + 7776000,
        PaymentInterval: 7776000, GracePeriod: 604800,
      };
      records.set(hash, {
        hash, validated: true, ledger_index: ledgerIndex + 1,
        close_time_iso: new Date(now * 1000).toISOString(),
        tx_json: tx,
        meta: {
          TransactionResult: "tesSUCCESS",
          TransactionIndex: tx.TransactionType === "LoanSet" ? 1 : 0,
          AffectedNodes: tx.TransactionType === "LoanSet"
            ? [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: "D".repeat(64), NewFields: fields } }]
            : tx.TransactionType === "LoanPay"
              ? [{ ModifiedNode: { LedgerEntryType: "Loan", LedgerIndex: "D".repeat(64), FinalFields: { ...fields, PrincipalOutstanding: "0" } } }]
              : [],
        },
      });
    },
    async request(input: Record<string, unknown>) {
      if (input.command === "tx") {
        const tx = records.get(String(input.transaction));
        if (!tx) throw Object.assign(new Error("notfound"), { data: { error: "txnNotFound" } });
        return { result: tx };
      }
      if (input.command === "server_info") return { result: { info: { network_id: 2 } } };
      if (input.command === "ledger") {
        return {
          result: {
            validated: true, ledger_index: ledgerIndex,
            ledger: { ledger_index: ledgerIndex, close_time: ledgerUnix - 946684800 },
          },
        };
      }
      throw new Error("Unexpected RPC command");
    },
  } as never;
  const transport = createNativeTransport(client, config);
  let laneFence = 0;
  const signerLanes = {
    claim: (input: { operationId: string }) => ({
      acquired: true as const, operationId: input.operationId, lanes: [{ key: "test", fence: ++laneFence }],
    }),
    assertClaim: () => {},
    release: () => true,
  };
  const context = {
    getRequest: (id: string) => registry.getRequest(id),
    applyEvent: (event: unknown) => registry.applyEvent(event as never),
    hashRequest: contentHash,
    getApprovedOffer: (hash: string) => hash === offer.commercial_terms_hash ? offer : undefined,
    clockSeconds: () => now,
    borrowerAccount: borrower.classicAddress,
    repAsset: rep,
    live: {
      transport,
      redeemStake: async () => { throw new Error("legacy path forbidden"); },
      originateLoanSet: async () => { throw new Error("legacy path forbidden"); },
      repayLoanPay: async () => { throw new Error("legacy path forbidden"); },
    },
    execution,
    signerLanes,
  };
  const proposed = {
    proposalHash: contentHash(request), principal: offer.principal, aprBps: offer.apr_bps,
    termDays: offer.term_days, asset: JSON.stringify(asset), networkMode: "LIVE_DEVNET" as const,
    requestId: request.request_id, reservationId: reserved.reservationId,
  };
  const originated = await originateLoan(proposed, context);
  const worker = createLifecycleWorker({
    registry: {
      getRequest: (id) => registry.getRequest(id) as never,
      getLoan: (id) => registry.getLoan(id) as never,
      applyEvent: (event) => registry.applyEvent(event as never),
    },
    store: lifecycleStore,
    transport,
    signerLanes,
    moneyScale: 100n,
    nativeAssetScale: 6,
    loanAsset: asset,
    owner: "lifecycle-test-worker",
  });
  return {
    registry, lifecycleStore, worker, request, originated, transport, borrower,
    setFail: (value: boolean) => { failSubmission = value; },
    setLedger: (index: number, unix = now) => { ledgerIndex = index; ledgerUnix = unix; },
  };
}

describe("durable lifecycle store and worker", () => {
  it("recoverOperation clears only the exact owner and fence", async () => {
    const env = await setup();
    const loanId = env.originated.loanId!;
    const input = {
      operationId: "op-recover-1", loanId, requestId: env.request.request_id,
      kind: "REPAYMENT" as const, account: env.borrower.classicAddress,
      fields: { TransactionType: "LoanPay", Account: env.borrower.classicAddress, LoanID: loanId },
    };
    const guard = env.lifecycleStore.claim(input, "life-a");
    expect(guard).toMatchObject({ acquired: true, owner: "life-a", fence: 1 });
    expect(env.lifecycleStore.recoverOperation("op-recover-1", "life-b", 1)).toBe(false);
    expect(env.lifecycleStore.recoverOperation("op-recover-1", "life-a", 99)).toBe(false);
    expect(env.lifecycleStore.getOperation("op-recover-1").claimed).toBe(true);
    expect(env.lifecycleStore.recoverOperation("op-recover-1", "life-a", 1)).toBe(true);
    expect(env.lifecycleStore.getOperation("op-recover-1").claimed).toBe(false);
  });

  it("repay persists before submit, stays RECONCILING on timeout, and resumes the same blob", async () => {
    const env = await setup();
    const loanId = env.originated.loanId!;
    env.setFail(true);
    const first = await env.worker.repay({
      operationId: "op-repay-1", loanId, requestId: env.request.request_id,
      maximumAmountNative: "1000000000", paymentMode: "FULL",
    });
    expect(first.state).toBe("RECONCILING");
    const saved = env.lifecycleStore.getInternal("op-repay-1");
    expect(saved.signed_blob).toBeTruthy();
    const blob = saved.signed_blob!;
    // Keep submit failing and tx absent so reconcile retains the same persisted blob.
    const again = await env.worker.reconcile("op-repay-1");
    expect(again.state).toBe("RECONCILING");
    expect(env.lifecycleStore.getInternal("op-repay-1").signed_blob).toBe(blob);
  });

  it("defaultLoan rejects before due date plus grace", async () => {
    const env = await setup();
    await expect(env.worker.defaultLoan({
      operationId: "op-default-1",
      loanId: env.originated.loanId!,
      requestId: env.request.request_id,
    })).rejects.toMatchObject({ code: "DEFAULT_TOO_SOON" });
    expect(() => { throw new LifecycleError("DEFAULT_TOO_SOON"); }).toThrow(/DEFAULT_TOO_SOON/);
  });
});
