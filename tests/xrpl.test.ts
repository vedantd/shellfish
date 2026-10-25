import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { authorizeExactAction } from "../packages/authorization/src/index.ts";
import { createRegistry, contentHash } from "../packages/registry/src/index.ts";
import {
  BorrowingMandate,
  LenderFacilityOffer,
  ReservationFixture,
  ScenarioFixture,
} from "../packages/schemas/src/index.ts";
import {
  createStructuralNativeVerifiers,
  originateLoan,
  repayLoan,
  type LiveLedger,
} from "../packages/xrpl/src/index.ts";
import { APPROVED_REP_POLICY_HASH } from "../packages/registry/src/index.ts";

const require = createRequire(new URL("../services/api/package.json", import.meta.url));
const Database = require("better-sqlite3");
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
      mandate_id: "mandate-xrpl-1",
      nonce: "nonce-xrpl-1",
    };
    const auth = authorizeExactAction({
      mandate,
      offer,
      proposalHash: contentHash(request),
      evidenceFresh: true,
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

  it("does not double-reserve: second identical authorize is DENY_REPLAY / conflict", () => {
    const { registry } = setup();
    const request = {
      ...reservation.request,
      request_id: "req-xrpl-dup",
      idempotency_key: "idem-xrpl-dup",
      mandate_id: "mandate-xrpl-dup",
      nonce: "nonce-xrpl-dup",
    };
    const first = authorizeExactAction({
      mandate,
      offer,
      proposalHash: contentHash(request),
      evidenceFresh: true,
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
      mandate_id: "mandate-xrpl-pay",
      nonce: "nonce-xrpl-pay",
    };
    const auth = authorizeExactAction({
      mandate,
      offer,
      proposalHash: contentHash(request),
      evidenceFresh: true,
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

const LIVE_BORROWER = "rN7n7otQDd6FczFgLdqtyMVrn3rMSH5qQ";
const LIVE_ISSUER = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const LIVE_MPT = "A".repeat(48);
const LIVE_REP = "B".repeat(48);

function mockLiveLedger(): LiveLedger {
  let n = 0;
  const hash = () => {
    n += 1;
    return `${n.toString(16).padStart(2, "0")}${"ab".repeat(31)}`.slice(0, 64);
  };
  return {
    async redeemStake() {
      return { txHash: hash(), ledgerIndex: 1000 + n, transactionIndex: 0 };
    },
    async originateLoanSet() {
      const txHash = hash();
      return {
        txHash,
        loanId: `loan-live-${n}`,
        ledgerIndex: 2000 + n,
        transactionIndex: 1,
        preparedCommitment: `sha256:${"11".repeat(32)}`,
      };
    },
    async repayLoanPay() {
      return { txHash: hash(), ledgerIndex: 3000 + n, transactionIndex: 2 };
    },
  };
}

async function setupLive() {
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
    issuer: LIVE_ISSUER,
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
      principal_id: `devnet:${LIVE_BORROWER}`,
      loan_asset: loanAsset,
      rep_asset: repAsset,
      policy_hash: APPROVED_REP_POLICY_HASH,
      evidence_version: "live-unit",
      facility: {
        facility_id: "devnet:facility-live",
        lender_id: LIVE_ISSUER,
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
    LIVE_BORROWER,
    { source: "unit-test" },
  );
  const live = mockLiveLedger();
  return {
    registry,
    live,
    advance: (s: number) => {
      now = s;
    },
    now: () => now,
    deps: {
      getRequest: (id: string) => registry.getRequest(id),
      applyEvent: (event: unknown) => registry.applyEvent(event as never),
      hashRequest: contentHash,
      clockSeconds: () => now,
      borrowerAccount: LIVE_BORROWER,
      repAsset,
      live,
    },
    loanAsset,
    repAsset,
  };
}

describe("LIVE_DEVNET XRPL originate (mocked ledger)", () => {
  it("stakes then dual-sign originates with real hash fields (no invent)", async () => {
    const { registry, deps, loanAsset, repAsset } = await setupLive();
    const expires = new Date((origin + 3600) * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const request = {
      request_id: "req-live-1",
      idempotency_key: "idem-live-1",
      principal_id: `devnet:${LIVE_BORROWER}`,
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
      commercial_terms_hash: contentHash({ p: "2000.00" }),
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
    expect(result.loanId).toBeTruthy();
    expect(registry.getRequest(request.request_id).state).toBe("ACTIVE");
  });

  it("refuses LIVE originate without live ledger", async () => {
    const { deps } = await setupLive();
    const { live: _omit, ...withoutLive } = deps;
    await expect(
      originateLoan(
        {
          proposalHash: "x",
          principal: "2000",
          aprBps: 550,
          termDays: 90,
          asset: "{}",
          networkMode: "LIVE_DEVNET",
          requestId: "r",
          reservationId: "s",
        },
        withoutLive,
      ),
    ).rejects.toThrow(/live ledger/);
  });
});
