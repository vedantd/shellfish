import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

import {
  createRegistry,
  createExecutionStore,
  createReturnStore,
  contentHash,
  APPROVED_REP_POLICY_HASH,
} from "../packages/registry/src/index.ts";
import { createLifecycleStore, originateLoan } from "../packages/xrpl/src/index.ts";
import {
  BorrowingMandate,
  LenderFacilityOffer,
  ReservationFixture,
  ScenarioFixture,
} from "../packages/schemas/src/index.ts";
import { authorizeExactAction } from "../packages/authorization/src/index.ts";

const require = createRequire(new URL("../services/api/package.json", import.meta.url));
const Database = require("better-sqlite3");
const root = resolve(import.meta.dirname, "..");
const load = (name: string) => JSON.parse(readFileSync(resolve(root, "fixtures", name), "utf8"));
const folders: string[] = [];
const databases: InstanceType<typeof Database>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

function openDb() {
  const folder = mkdtempSync(resolve(tmpdir(), "shellfish-recover-"));
  folders.push(folder);
  const db = new Database(resolve(folder, "credit.db"));
  databases.push(db);
  return db;
}

describe("operator compare-and-set recovery", () => {
  it("EXECUTION recover requires exact owner and fence", () => {
    const db = openDb();
    const scenario = ScenarioFixture.parse(load("scenario.json"));
    const now = Math.floor(Date.parse(scenario.clock) / 1000);
    const registry = createRegistry(db, { now: () => new Date(now * 1000) });
    registry.seedScenario(scenario, "sim:borrower-harbor-supply");
    const request = {
      ...ReservationFixture.parse(load("reservation.json")).request,
      request_id: "req-recover-exec",
      idempotency_key: "idem-recover-exec",
    };
    registry.reserveRequest(request);
    const execution = createExecutionStore(db, { now: () => new Date(now * 1000) });
    const guard = execution.claimExecution(request.request_id, "exec-owner");
    expect(guard.acquired).toBe(true);
    if (!guard.acquired) throw new Error("claim");
    expect(execution.acknowledgeExecutionRecovery(request.request_id, "wrong", guard.fence)).toBe(false);
    expect(execution.acknowledgeExecutionRecovery(request.request_id, guard.owner, guard.fence + 1)).toBe(false);
    expect(execution.getExecutionClaim(request.request_id)?.active).toBe(true);
    expect(execution.acknowledgeExecutionRecovery(request.request_id, guard.owner, guard.fence)).toBe(true);
    expect(execution.getExecutionClaim(request.request_id)?.active).toBe(false);
  });

  it("LIFECYCLE recover requires exact owner and fence", async () => {
    const db = openDb();
    const scenario = ScenarioFixture.parse(load("scenario.json"));
    const mandate = BorrowingMandate.parse(load("mandate.json"));
    const offer = LenderFacilityOffer.parse(load("offer-lender-a.json"));
    const reservation = ReservationFixture.parse(load("reservation.json"));
    const clock = new Date(scenario.clock);
    const now = Math.floor(clock.getTime() / 1000);
    const registry = createRegistry(db, { now: () => new Date(now * 1000) });
    registry.seedScenario(scenario, "sim:borrower-harbor-supply");
    const request = {
      ...reservation.request,
      request_id: "req-recover-life",
      idempotency_key: "idem-recover-life",
    };
    const auth = authorizeExactAction({
      mandate, offer, evidenceFresh: true, hashContent: contentHash,
      proposalHash: contentHash(request), reservationRequest: request,
      reserveRequest: (raw) => registry.reserveRequest(raw), now: clock,
    });
    expect(auth.decision).toBe("ALLOW");
    const sim = {
      getRequest: (id: string) => registry.getRequest(id),
      applyEvent: (event: unknown) => registry.applyEvent(event as never),
      hashRequest: contentHash,
      getApprovedOffer: (hash: string) => hash === offer.commercial_terms_hash ? offer : undefined,
      clockSeconds: () => now,
      borrowerAccount: "sim:borrower-harbor-supply",
      repAsset: scenario.rep_asset,
    };
    const originated = await originateLoan({
      proposalHash: auth.proposal_hash!,
      principal: offer.principal,
      aprBps: offer.apr_bps,
      termDays: offer.term_days,
      asset: JSON.stringify(offer.asset),
      networkMode: "SIMULATED_LOAN",
      requestId: auth.request_id,
      reservationId: auth.reservation_id!,
    }, sim);
    const store = createLifecycleStore(db, { hash: contentHash });
    const input = {
      operationId: "op-recover-life",
      loanId: originated.loanId!,
      requestId: auth.request_id,
      kind: "REPAYMENT" as const,
      account: "sim:borrower-harbor-supply",
      fields: { TransactionType: "LoanPay", Account: "sim:borrower-harbor-supply", LoanID: originated.loanId },
    };
    const guard = store.claim(input, "life-owner");
    expect(guard).toMatchObject({ acquired: true, owner: "life-owner", fence: 1 });
    expect(store.recoverOperation("op-recover-life", "wrong", 1)).toBe(false);
    expect(store.recoverOperation("op-recover-life", "life-owner", 99)).toBe(false);
    expect(store.getOperation("op-recover-life").claimed).toBe(true);
    expect(store.recoverOperation("op-recover-life", "life-owner", 1)).toBe(true);
    expect(store.getOperation("op-recover-life").claimed).toBe(false);
  });

  it("RETURN recover requires exact owner and fence and retains unresolved lane holds", async () => {
    const db = openDb();
    const scenario = ScenarioFixture.parse(load("scenario.json"));
    const now = Math.floor(Date.parse(scenario.clock) / 1000);
    const registry = createRegistry(db, { now: () => new Date(now * 1000) });
    registry.seedScenario(scenario, "sim:borrower-harbor-supply");
    const reservation = ReservationFixture.parse(load("reservation.json"));
    const request = {
      ...reservation.request,
      request_id: "req-recover-return",
      idempotency_key: "idem-recover-return",
      policy_hash: APPROVED_REP_POLICY_HASH,
    };
    registry.reserveRequest(request);
    const occurredAt = now;
    await registry.applyEvent({
      eventId: `stake:${request.request_id}`,
      kind: "STAKE_VALIDATED",
      requestId: request.request_id,
      occurredAt,
      stake: {
        amountU: registry.getRequest(request.request_id).originalBondU,
        repAsset: scenario.rep_asset,
        sender: "sim:borrower-harbor-supply",
        destination: scenario.rep_asset.issuer,
        requestHash: contentHash(request),
        partialPayment: false,
      },
    });
    // Cancel after burn (no origination) creates an OWED return credit — same path as registry return tests.
    await registry.applyEvent({
      eventId: `failed:${request.request_id}`,
      kind: "FAIL_AFTER_BURN",
      requestId: request.request_id,
      occurredAt,
      conclusive: true,
    });
    const credit = registry.getReturnCredits({
      principalId: request.principal_id,
      network: request.network,
      asset: request.asset,
    }).find((c) => c.requestId === request.request_id);
    expect(credit).toBeTruthy();
    const returns = createReturnStore(db);
    const claim = returns.claimReturn(credit!.creditId, "return-owner");
    expect(claim.acquired).toBe(true);
    if (!claim.acquired) throw new Error("claim");
    expect(returns.recoverReturnWorker(credit!.creditId, "wrong", claim.fence)).toBe(false);
    expect(returns.recoverReturnWorker(credit!.creditId, claim.owner, claim.fence + 1)).toBe(false);
    expect(returns.getReturnClaim(credit!.creditId)?.active).toBe(true);
    expect(returns.recoverReturnWorker(credit!.creditId, claim.owner, claim.fence)).toBe(true);
    const after = returns.getReturnClaim(credit!.creditId);
    expect(after?.active).toBe(false);
    // Economic hold: credit remains OWED; recovery does not invent PAID.
    expect(registry.getReturnCredits({
      principalId: request.principal_id,
      network: request.network,
      asset: request.asset,
    }).find((c) => c.creditId === credit!.creditId)?.state).toBe("OWED");
  });
});
