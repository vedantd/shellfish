import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { authorizeExactAction } from "../packages/authorization/src/index.ts";
import { createRegistry, createExecutionStore, contentHash, APPROVED_REP_POLICY_HASH } from "../packages/registry/src/index.ts";
import {
  BorrowingMandate,
  LenderFacilityOffer,
  ReservationFixture,
  ScenarioFixture,
} from "../packages/schemas/src/index.ts";
import {
  createNativeTransport,
  createStructuralNativeVerifiers,
  originateLoan,
  repayLoan,
  type LiveLedger,
} from "../packages/xrpl/src/index.ts";

const require = createRequire(new URL("../services/api/package.json", import.meta.url));
const Database = require("better-sqlite3");
const { Wallet, decode } = createRequire(new URL("../packages/xrpl/package.json", import.meta.url))("xrpl");
const root = resolve(import.meta.dirname, "..");
const load = (name: string) =>
  JSON.parse(readFileSync(resolve(root, "fixtures", name), "utf8"));

const scenario = ScenarioFixture.parse(load("scenario.json"));
const mandate = BorrowingMandate.parse(load("mandate.json"));
const offer = LenderFacilityOffer.parse(load("offer-lender-a.json"));
const reservation = ReservationFixture.parse(load("reservation.json"));
const clock = new Date(scenario.clock);
const origin = Math.floor(clock.getTime() / 1000);

const connections: InstanceType<typeof Database>[] = [];
const folders: string[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(resolve(tmpdir(), "shellfish-xrpl-"));
  folders.push(dir);
  const db = new Database(resolve(dir, "t.db"));
  connections.push(db);
  let now = origin;
  const registry = createRegistry(db, { now: () => new Date(now * 1000) });
  registry.seedScenario(scenario, "sim:borrower-harbor-supply");
  return {
    registry,
    advance: (s: number) => {
      now = s;
    },
    sim: {
      getRequest: (id: string) => registry.getRequest(id),
      applyEvent: (event: unknown) => registry.applyEvent(event as never),
      hashRequest: contentHash,
      getApprovedOffer: (hash: string) => hash === offer.commercial_terms_hash ? offer : undefined,
      clockSeconds: () => now,
      borrowerAccount: "sim:borrower-harbor-supply",
      repAsset: scenario.rep_asset,
    },
  };
}

describe("simulated XRPL originate", () => {
  it("consumes an existing reservation and returns null txHash", async () => {
    const { registry, sim } = setup();
    const request = {
      ...reservation.request,
      request_id: "req-xrpl-1",
      idempotency_key: "idem-xrpl-1",

    };
    const auth = authorizeExactAction({
      mandate,
      offer,
      proposalHash: contentHash(request),
      evidenceFresh: true,
      hashContent: contentHash,
      reservationRequest: request,
      reserveRequest: (raw) => registry.reserveRequest(raw),
      now: clock,
    });
    expect(auth.decision).toBe("ALLOW");
    expect(auth.reservation_id).toBeTruthy();

    const result = await originateLoan(
      {
        proposalHash: auth.proposal_hash!,
        principal: offer.principal,
        aprBps: offer.apr_bps,
        termDays: offer.term_days,
        asset: JSON.stringify(offer.asset),
        networkMode: "SIMULATED_LOAN",
        requestId: auth.request_id,
        reservationId: auth.reservation_id!,
      },
      sim,
    );

    expect(result.simulated).toBe(true);
    expect(result.validated).toBe(false);
    expect(result.txHash).toBeNull();
    expect(result.loanId).toBe(`loan:${auth.request_id}`);
    expect(registry.getRequest(auth.request_id).state).toBe("ACTIVE");
  });

  it("fails without reservation ids", async () => {
    const { sim } = setup();
    await expect(
      originateLoan(
        {
          proposalHash: "x",
          principal: "2000.00",
          aprBps: 550,
          termDays: 90,
          asset: "{}",
          networkMode: "SIMULATED_LOAN",
          requestId: "",
          reservationId: "",
        },
        sim,
      ),
    ).rejects.toThrow(/requestId and reservationId/);
  });

  it("returns the existing reservation on exact authorization retry", () => {
    const { registry } = setup();
    const request = {
      ...reservation.request,
      request_id: "req-xrpl-dup",
      idempotency_key: "idem-xrpl-dup",

    };
    const first = authorizeExactAction({
      mandate,
      offer,
      proposalHash: contentHash(request),
      evidenceFresh: true,
      hashContent: contentHash,
      reservationRequest: request,
      reserveRequest: (raw) => registry.reserveRequest(raw),
      now: clock,
    });
    expect(first.decision).toBe("ALLOW");
    const again = authorizeExactAction({
      mandate,
      offer,
      proposalHash: contentHash(request),
      evidenceFresh: true,
      hashContent: contentHash,
      reservationRequest: request,
      reserveRequest: (raw) => registry.reserveRequest(raw),
      now: clock,
    });
    // Exact retry returns existing reservation via registry — treat as ALLOW with same id
    // or DENY on conflict depending on path. Same payload retry returns existing.
    expect(again.reservation_id).toBe(first.reservation_id);
  });

  it("simulated repay applies without a native hash", async () => {
    const { registry, sim, advance } = setup();
    const request = {
      ...reservation.request,
      request_id: "req-xrpl-pay",
      idempotency_key: "idem-xrpl-pay",

    };
    const auth = authorizeExactAction({
      mandate,
      offer,
      proposalHash: contentHash(request),
      evidenceFresh: true,
      hashContent: contentHash,
      reservationRequest: request,
      reserveRequest: (raw) => registry.reserveRequest(raw),
      now: clock,
    });
    const originated = await originateLoan(
      {
        proposalHash: auth.proposal_hash!,
        principal: offer.principal,
        aprBps: offer.apr_bps,
        termDays: offer.term_days,
        asset: JSON.stringify(offer.asset),
        networkMode: "SIMULATED_LOAN",
        requestId: auth.request_id,
        reservationId: auth.reservation_id!,
      },
      sim,
    );
    advance(origin + 90 * 86400);
    const pay = await repayLoan({
      loanId: originated.loanId!,
      amount: "2000.00",
      networkMode: "SIMULATED_LOAN",
      requestId: auth.request_id,
      principalReductionMinor: "200000",
      sim: {
        ...sim,
        originHash: `sim:origin:${auth.request_id}`,
        previousEventId: `origin:${auth.request_id}`,
      },
    });
    expect(pay.simulated).toBe(true);
    expect(pay.txHash).toBeNull();
  });
});

const LIVE_MPT = "A".repeat(48);
const LIVE_REP = "B".repeat(48);

async function setupLive() {
  const borrower = Wallet.generate();
  const broker = Wallet.generate();
  const issuer = Wallet.generate();
  const dir = mkdtempSync(resolve(tmpdir(), "shellfish-xrpl-live-"));
  folders.push(dir);
  const db = new Database(resolve(dir, "t.db"));
  connections.push(db);
  let now = origin;
  const verifiers = createStructuralNativeVerifiers();
  const registry = createRegistry(db, {
    now: () => new Date(now * 1000),
    verifyNativeEvent: verifiers.verifyNativeEvent,
    verifyNativePortfolio: verifiers.verifyNativePortfolio,
  });
  const loanAsset = { mpt_issuance_id: LIVE_MPT };
  const repAsset = {
    mpt_issuance_id: LIVE_REP,
    issuer: issuer.classicAddress,
    asset_scale: 6 as const,
  };
  await registry.initializeNativePortfolio(
    {
      contract_version: "C0-REP-1",
      model_version: "REP-CURVE-v0.2",
      network: "devnet",
      mode: "LIVE_DEVNET",
      scenario_id: "live-unit",
      clock: clock.toISOString().replace(/\.\d{3}Z$/, "Z"),
      money_scale: 100,
      rep_scale: 1000000,
      principal_id: `devnet:${borrower.classicAddress}`,
      loan_asset: loanAsset,
      rep_asset: repAsset,
      policy_hash: APPROVED_REP_POLICY_HASH,
      evidence_version: "live-unit",
      facility: {
        facility_id: "devnet:facility-live",
        lender_id: broker.classicAddress,
        asset: loanAsset,
        limit_minor: "10000000",
        version: 1,
      },
      opening: {
        active_principal_minor: "0",
        reserved_principal_minor: "0",
        defaulted_principal_minor: "0",
        facility_committed_minor: "0",
        facility_reserved_minor: "0",
        reputation: {
          seed_u: "1000000000",
          available_u: "1000000000",
          reserved_u: "0",
          bonded_u: "0",
          pending_return_u: "0",
          growth_u: "0",
          forfeited_u: "0",
          suspended: false,
          version: 1,
        },
      },
      opening_loans: [],
    },
    borrower.classicAddress,
    { source: "unit-test" },
  );
  const liveOffer = {
    ...offer, mode: "LIVE_DEVNET" as const, network: "devnet", asset: loanAsset,
    lender_id: broker.classicAddress, borrower_id: `devnet:${borrower.classicAddress}`,
    offer_id: "offer-live-1", facility_id: "devnet:facility-live",
    expires_at: new Date((origin + 3600) * 1000).toISOString(),
    commercial_terms_hash: "", offer_hash: "",
  };
  const termsKeys = ["lender_id", "borrower_id", "facility_id", "offer_id", "asset", "principal", "apr_bps", "rate_kind", "term_days", "fees", "purpose", "expires_at", "schedule", "network"];
  liveOffer.commercial_terms_hash = contentHash(Object.fromEntries(Object.entries(liveOffer).filter(([key]) => termsKeys.includes(key))));
  liveOffer.offer_hash = contentHash(Object.fromEntries(Object.entries(liveOffer).filter(([key]) => !["lender_signature", "offer_hash"].includes(key))));
  const execution = createExecutionStore(db, { now: () => new Date(now * 1000) });
  const records = new Map<string, Record<string, unknown>>();
  const config = {
    wsUrl: "wss://example.invalid",
    borrowerSeed: borrower.seed!,
    brokerSeed: broker.seed!,
    repIssuerSeed: issuer.seed!,
    repIssuerAddress: issuer.classicAddress,
    loanBrokerId: "C".repeat(64),
    loanMptIssuanceId: loanAsset.mpt_issuance_id,
    loanAssetScale: 6,
    repIssuanceId: repAsset.mpt_issuance_id,
    paymentTotal: 1,
    paymentIntervalSec: 7776000,
    gracePeriodSec: 60,
    loanOriginationFee: "0",
    loanServiceFee: "0",
  };
  const client = {
    async autofill(raw: Record<string, unknown>) {
      return { ...raw, Fee: "12", Sequence: raw.Account === broker.classicAddress ? 2 : 1, LastLedgerSequence: 120 };
    },
    async submitAndWait(blob: string) {
      const tx = decode(blob) as unknown as Record<string, unknown>;
      const phase = tx.TransactionType === "LoanSet" ? "LOAN" : "STAKE";
      const persisted = execution.getAttempt("req-live-1", phase)!;
      expect(persisted.signedBlob).toBe(blob);
      const fields = {
        Borrower: borrower.classicAddress,
        LoanBrokerID: config.loanBrokerId,
        StartDate: now - 946684800,
        NextPaymentDueDate: now - 946684800 + 7776000,
        PaymentInterval: 7776000,
        GracePeriod: 60,
      };
      records.set(persisted.attemptHash, {
        hash: persisted.attemptHash,
        validated: true,
        ledger_index: 100,
        close_time_iso: new Date(now * 1000).toISOString(),
        tx_json: tx,
        meta: {
          TransactionResult: "tesSUCCESS",
          TransactionIndex: phase === "STAKE" ? 0 : 1,
          AffectedNodes: phase === "LOAN"
            ? [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: "D".repeat(64), NewFields: fields } }]
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
        return { result: { validated: true, ledger_index: 99, ledger: { ledger_index: 99, close_time: now - 946684800 } } };
      }
      throw new Error("Unexpected RPC command");
    },
  } as never;
  const transport = createNativeTransport(client, config);
  let laneFence = 0;
  const signerLanes = {
    claim: (input: { operationId: string }) => ({
      acquired: true as const,
      operationId: input.operationId,
      lanes: [{ key: "test", fence: ++laneFence }],
    }),
    assertClaim: () => {},
    release: () => true,
  };
  const live = {
    transport,
    redeemStake: async () => { throw new Error("legacy path forbidden"); },
    originateLoanSet: async () => { throw new Error("legacy path forbidden"); },
    repayLoanPay: async () => { throw new Error("legacy path forbidden"); },
  };
  return {
    registry,
    execution,
    advance: (s: number) => {
      now = s;
    },
    now: () => now,
    deps: {
      getRequest: (id: string) => registry.getRequest(id),
      applyEvent: (event: unknown) => registry.applyEvent(event as never),
      hashRequest: contentHash,
      getApprovedOffer: (hash: string) => hash === liveOffer.commercial_terms_hash ? liveOffer : undefined,
      clockSeconds: () => now,
      borrowerAccount: borrower.classicAddress,
      repAsset,
      live,
      execution,
      signerLanes,
    },
    loanAsset,
    repAsset,
    liveOffer,
    borrower,
  };
}

describe("LIVE_DEVNET XRPL originate (durable mocked transport)", () => {
  it("stakes then dual-sign originates with real hash fields (no invent)", async () => {
    const { registry, deps, loanAsset, repAsset, liveOffer, borrower } = await setupLive();
    const expires = new Date((origin + 3600) * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const request = {
      request_id: "req-live-1",
      idempotency_key: "idem-live-1",
      principal_id: `devnet:${borrower.classicAddress}`,
      contract_version: "C0-REP-1" as const,
      mode: "LIVE_DEVNET" as const,
      mandate_hash: contentHash({ live: true }),
      rep_asset: repAsset,
      agent_id: "agent:live",
      mandate_id: "m-live-1",
      nonce: "nonce-live-1",
      offer_id: "offer-live-1",
      facility_id: "devnet:facility-live",
      network: "devnet",
      asset: loanAsset,
      evidence_hash: contentHash({ e: 1 }),
      commercial_terms_hash: liveOffer.commercial_terms_hash,
      model_version: "REP-CURVE-v0.2" as const,
      policy_hash: APPROVED_REP_POLICY_HASH,
      principal_minor: "200000",
      max_stake_u: "760000000",
      expires_at: expires,
    };
    const reserved = registry.reserveRequest(request);
    expect(reserved.originalBondU).toBe("560000000");

    const result = await originateLoan(
      {
        proposalHash: contentHash(request),
        principal: "2000.00",
        aprBps: 550,
        termDays: 90,
        asset: JSON.stringify(loanAsset),
        networkMode: "LIVE_DEVNET",
        requestId: request.request_id,
        reservationId: reserved.reservationId,
      },
      deps,
    );

    expect(result.simulated).toBe(false);
    expect(result.validated).toBe(true);
    expect(result.txHash).toMatch(/^[a-f0-9]{64}$/i);
    expect(result.stakeProofId).toMatch(/^[a-f0-9]{64}$/i);
    expect(result.preparedTxCommitment).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.loanId).toBe("D".repeat(64));
    expect(registry.getRequest(request.request_id).state).toBe("ACTIVE");
  });

  it("refuses LIVE originate without durable execution ports", async () => {
    const { registry, deps, loanAsset, repAsset, liveOffer, borrower } = await setupLive();
    const expires = new Date((origin + 3600) * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const request = {
      request_id: "req-live-1",
      idempotency_key: "idem-live-1",
      principal_id: `devnet:${borrower.classicAddress}`,
      contract_version: "C0-REP-1" as const,
      mode: "LIVE_DEVNET" as const,
      mandate_hash: contentHash({ live: true }),
      rep_asset: repAsset,
      agent_id: "agent:live",
      mandate_id: "m-live-1",
      nonce: "nonce-live-1",
      offer_id: "offer-live-1",
      facility_id: "devnet:facility-live",
      network: "devnet",
      asset: loanAsset,
      evidence_hash: contentHash({ e: 1 }),
      commercial_terms_hash: liveOffer.commercial_terms_hash,
      model_version: "REP-CURVE-v0.2" as const,
      policy_hash: APPROVED_REP_POLICY_HASH,
      principal_minor: "200000",
      max_stake_u: "760000000",
      expires_at: expires,
    };
    const reserved = registry.reserveRequest(request);
    const { live: _omit, execution: _e, signerLanes: _s, ...withoutDurable } = deps;
    await expect(
      originateLoan(
        {
          proposalHash: contentHash(request),
          principal: "2000.00",
          aprBps: 550,
          termDays: 90,
          asset: JSON.stringify(loanAsset),
          networkMode: "LIVE_DEVNET",
          requestId: request.request_id,
          reservationId: reserved.reservationId,
        },
        withoutDurable,
      ),
    ).rejects.toThrow(/DURABLE_NATIVE_EXECUTION_REQUIRED/);
  });
});


describe("exact origination bindings before ledger effects", () => {
  it.each([
    ["principal", { principal: "9999.00" }],
    ["APR", { aprBps: 99999 }],
    ["term", { termDays: 360 }],
    ["asset", { asset: JSON.stringify({ currency: "XRP" }) }],
    ["proposal", { proposalHash: "sha256:" + "00".repeat(32) }],
  ])("rejects changed %s before LIVE stake or LoanSet", async (_label, changed) => {
    const { registry, deps, loanAsset, repAsset, liveOffer } = await setupLive();
    const request = {
      ...reservation.request,
      mode: "LIVE_DEVNET" as const,
      request_id: "req-live-bindings", idempotency_key: "idem-live-bindings",
      principal_id: liveOffer.borrower_id, agent_id: "agent:live",
      mandate_id: "mandate-live-bindings", nonce: "nonce-live-bindings",
      asset: loanAsset, rep_asset: repAsset, offer_id: liveOffer.offer_id,
      facility_id: liveOffer.facility_id, commercial_terms_hash: liveOffer.commercial_terms_hash,
      expires_at: liveOffer.expires_at,
    };
    const reserved = registry.reserveRequest(request);
    const before = registry.getCreditStatus(request.facility_id);
    let stakeCalls = 0, loanCalls = 0;
    const instrumented = {
      ...deps,
      live: {
        ...deps.live,
        redeemStake: async (args: Parameters<LiveLedger["redeemStake"]>[0]) => { stakeCalls++; return deps.live.redeemStake(args); },
        originateLoanSet: async (args: Parameters<LiveLedger["originateLoanSet"]>[0]) => { loanCalls++; return deps.live.originateLoanSet(args); },
      },
    };
    await expect(originateLoan({
      proposalHash: contentHash(request), principal: liveOffer.principal,
      aprBps: liveOffer.apr_bps, termDays: liveOffer.term_days,
      asset: JSON.stringify(liveOffer.asset), networkMode: "LIVE_DEVNET",
      requestId: request.request_id, reservationId: reserved.reservationId,
      ...(changed as object),
    }, instrumented)).rejects.toThrow();
    expect(stakeCalls).toBe(0);
    expect(loanCalls).toBe(0);
    expect(registry.getRequest(request.request_id).state).toBe("AWAITING_STAKE");
    expect(registry.getCreditStatus(request.facility_id)).toEqual(before);
  });

  it("returns exact SIM origination retry without another event", async () => {
    const { registry, sim } = setup();
    const request = { ...reservation.request, request_id: "req-repeat", idempotency_key: "idem-repeat" };
    const receipt = authorizeExactAction({ mandate, offer, evidenceFresh: true, hashContent: contentHash,
      proposalHash: contentHash(request), reservationRequest: request, reserveRequest: raw => registry.reserveRequest(raw), now: clock });
    const input = { proposalHash: receipt.proposal_hash!, principal: offer.principal, aprBps: offer.apr_bps,
      termDays: offer.term_days, asset: JSON.stringify(offer.asset), networkMode: "SIMULATED_LOAN" as const,
      requestId: request.request_id, reservationId: receipt.reservation_id! };
    const first = await originateLoan(input, sim);
    const before = registry.getCreditStatus(offer.facility_id);
    let events = 0;
    const again = await originateLoan(input, { ...sim, applyEvent: event => { events++; return sim.applyEvent(event); } });
    expect(again).toEqual(first);
    expect(events).toBe(0);
    expect(registry.getCreditStatus(offer.facility_id)).toEqual(before);
  });
});
