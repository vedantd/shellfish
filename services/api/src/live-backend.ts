import { createCompatibilityService } from "@shellfish/compatibility";
import { createEvidenceService } from "@shellfish/evidence";
import { contentHash } from "@shellfish/registry";
import {
  createStructuralNativeVerifiers,
  createXrplLiveLedger,
  type LiveLedger,
} from "@shellfish/xrpl";
import { openCreditRegistry } from "./db/registry.js";
import {
  livePortfolioSeed,
  loadLiveRuntimeConfig,
  type LiveRuntimeConfig,
} from "./live-config.js";
import type { FixtureCreditServices } from "./db/fixtures.js";

export type LiveCreditBackend = {
  services: FixtureCreditServices;
  registry: ReturnType<typeof openCreditRegistry>["registry"];
  execution: ReturnType<typeof openCreditRegistry>["execution"];
  returns: ReturnType<typeof openCreditRegistry>["returns"];
  close: () => void;
  live: LiveLedger;
  liveConfig: LiveRuntimeConfig;
  mode: "LIVE_DEVNET";
};

/**
 * Vedant-owned LIVE bootstrap. Does not edit Gita fixtures.ts.
 * Requires complete SHELLFISH_* / XRPL env (see live-config).
 * When connectLedger is false, caller must inject `live` (tests).
 */
export async function openLiveCreditBackend(
  databasePath: string,
  options: {
    env?: NodeJS.ProcessEnv;
    connectLedger?: boolean;
    live?: LiveLedger;
    now?: () => Date;
  } = {},
): Promise<LiveCreditBackend> {
  const env = options.env ?? process.env;
  const liveConfig = loadLiveRuntimeConfig(env);
  if (!liveConfig) {
    throw new Error(
      "[api] LIVE_DEVNET missing env: SHELLFISH_BORROWER_SEED, SHELLFISH_BROKER_SEED, SHELLFISH_LOAN_BROKER_ID, SHELLFISH_LOAN_MPT_ID, SHELLFISH_REP_MPT_ID, SHELLFISH_REP_ISSUER_ACCOUNT",
    );
  }

  const now = options.now ?? (() => new Date());
  const verifiers = createStructuralNativeVerifiers();
  const backend = openCreditRegistry(databasePath, {
    now,
    verifyNativeEvent: verifiers.verifyNativeEvent,
    verifyNativePortfolio: verifiers.verifyNativePortfolio,
  });

  let liveHandle: { ledger: LiveLedger; close: () => Promise<void> } | null =
    null;
  try {
    const seed = livePortfolioSeed(liveConfig, now().toISOString());
    await backend.registry.initializeNativePortfolio(
      seed,
      liveConfig.borrowerAddress,
      { source: "live-env", endpoint: liveConfig.wsUrl },
    );

    let live = options.live;
    if (!live && options.connectLedger !== false) {
      liveHandle = await createXrplLiveLedger(liveConfig);
      live = liveHandle.ledger;
    }
    if (!live) {
      throw new Error("[api] LIVE_DEVNET requires a live ledger or connectLedger");
    }

    const services: FixtureCreditServices = {
      evidence: createEvidenceService({
        passports: [],
        hash: contentHash,
        now,
      }),
      credit: createCompatibilityService({
        approvedOffers: [],
        hash: contentHash,
        now,
      }),
      registry: backend.registry,
    };

    return {
      services,
      registry: backend.registry,
      execution: backend.execution,
      returns: backend.returns,
      live,
      liveConfig,
      mode: "LIVE_DEVNET",
      close: () => {
        void liveHandle?.close();
        backend.close();
      },
    };
  } catch (err) {
    void liveHandle?.close();
    backend.close();
    throw err;
  }
}
