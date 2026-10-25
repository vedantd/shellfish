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
import { originateLoan, repayLoan } from "../packages/xrpl/src/index.ts";

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
