import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

import { livePortfolioSeed, loadLiveRuntimeConfig } from "../services/api/src/live-config.ts";
import { createNativeCreditSources } from "../services/api/src/native-credit.ts";
import { openCreditRegistry } from "../services/api/src/db/registry.ts";

const requireXrpl = createRequire(new URL("../packages/xrpl/package.json", import.meta.url));
const { Wallet } = requireXrpl("xrpl");
const folders: string[] = [];
const backends: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const backend of backends.splice(0)) backend.close();
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function setup(clock = new Date("2026-10-25T12:00:00Z")) {
  const borrower = Wallet.generate();
  const broker = Wallet.generate();
  const issuer = Wallet.generate();
  const folder = mkdtempSync(resolve(tmpdir(), "shellfish-intent-"));
  folders.push(folder);
  let now = clock;
  const backend = openCreditRegistry(resolve(folder, "credit.db"), {
    now: () => now,
    uiMode: "LIVE_DEVNET",
    uiNetwork: "devnet",
    verifyNativePortfolio: async () => {},
    verifyNativeEvent: async () => {},
  });
  backends.push(backend);
  const env = {
    SHELLFISH_BORROWER_SEED: borrower.seed!,
    SHELLFISH_BROKER_SEED: broker.seed!,
    SHELLFISH_REP_ISSUER_SEED: issuer.seed!,
    SHELLFISH_LOAN_BROKER_ID: "C".repeat(64),
    SHELLFISH_LOAN_MPT_ID: "A".repeat(48),
    SHELLFISH_REP_MPT_ID: "B".repeat(48),
    SHELLFISH_REP_ISSUER_ACCOUNT: issuer.classicAddress,
    SHELLFISH_PAYMENT_TOTAL: "1",
    SHELLFISH_PAYMENT_INTERVAL_SEC: "7776000",
    SHELLFISH_GRACE_PERIOD_SEC: "604800",
    SHELLFISH_LOAN_ORIGINATION_FEE: "0",
    SHELLFISH_LOAN_SERVICE_FEE: "0",
    SHELLFISH_LOAN_ASSET_SCALE: "6",
    SHELLFISH_PRINCIPAL_MINOR: "200000",
  };
  const config = loadLiveRuntimeConfig(env);
  if (!config) throw new Error("expected live config");
  await backend.registry.initializeNativePortfolio(
    livePortfolioSeed(config, now.toISOString()),
    config.borrowerAddress,
    { source: "unit-test" },
  );
  const sources = createNativeCreditSources(backend.db, backend.registry, backend.uiState, config, () => now);
  return {
    sources,
    advanceHours: (hours: number) => { now = new Date(now.getTime() + hours * 3600_000); },
  };
}

describe("native credit intent cache", () => {
  it("returns the same payload for an unexpired idempotency key", async () => {
    const env = await setup();
    const first = env.sources.intent("demo-key");
    const second = env.sources.intent("demo-key");
    expect(second).toEqual(first);
    expect(first.mandate.expires_at).toBeTruthy();
    expect(first.offer.schedule.payment_interval_seconds).toBe(7776000);
  });

  it("rejects the same key after one hour and accepts a new key", async () => {
    const env = await setup();
    const first = env.sources.intent("demo-key");
    env.advanceHours(1);
    expect(() => env.sources.intent("demo-key")).toThrow("INTENT_EXPIRED_USE_NEW_KEY");
    const next = env.sources.intent("demo-key-2");
    expect(next.mandate.mandate_id).not.toBe(first.mandate.mandate_id);
    expect(next.offer.offer_hash).not.toBe(first.offer.offer_hash);
  });
});
