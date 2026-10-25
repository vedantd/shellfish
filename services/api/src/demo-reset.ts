import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Wallet } from "@shellfish/xrpl";
import { config } from "./config.js";
import {
  getCreditBackend,
  setCreditBackend,
  type CreditBackend,
} from "./credit-context.js";
import { openFixtureCreditBackend } from "./db/fixtures.js";
import { openLiveCreditBackend } from "./live-backend.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");

let resetInFlight: Promise<DemoResetResult> | null = null;

export type DemoResetResult = {
  ok: true;
  mode: "SIMULATED_LOAN" | "LIVE_DEVNET";
  borrower_account: string | null;
  took_ms: number;
};

function demoResetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHELLFISH_DEMO_RESET === "1";
}

function absoluteDatabasePath(path: string): string {
  if (path.startsWith("/")) return path;
  return resolve(repoRoot, path);
}

function removeDatabaseFiles(databasePath: string): void {
  const absolute = absoluteDatabasePath(databasePath);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const file = `${absolute}${suffix}`;
    if (existsSync(file)) unlinkSync(file);
  }
}

function latestNativeSecrets(): {
  usdIssuer: { seed: string };
} {
  const dataDir = resolve(repoRoot, "fixtures/xrpl-poc-replay/data");
  const runs = readdirSync(dataDir).sort().reverse();
  if (!runs[0]) throw new Error("NATIVE_E2E_SECRETS_REQUIRED");
  const secrets = JSON.parse(
    readFileSync(resolve(dataDir, runs[0], "secrets.json"), "utf8"),
  ) as { usdIssuer?: { seed?: string } };
  const seed = secrets.usdIssuer?.seed?.trim();
  if (!seed) throw new Error("USD_ISSUER_SEED_REQUIRED");
  return { usdIssuer: { seed } };
}

function persistBorrowerSeed(seed: string): void {
  process.env.SHELLFISH_BORROWER_SEED = seed;
  const envPath = resolve(repoRoot, "services/api/.env.live.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  const next = /^SHELLFISH_BORROWER_SEED=.*$/m.test(text)
    ? text.replace(/^SHELLFISH_BORROWER_SEED=.*$/m, `SHELLFISH_BORROWER_SEED=${seed}`)
    : `${text.trimEnd()}\nSHELLFISH_BORROWER_SEED=${seed}\n`;
  writeFileSync(envPath, next, { mode: 0o600 });
}

async function submit(
  client: Client,
  wallet: Wallet,
  tx: Record<string, unknown>,
  label: string,
): Promise<void> {
  const prepared = await client.autofill(tx as never);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  const code = (result.result.meta as { TransactionResult?: string } | undefined)
    ?.TransactionResult;
  if (code !== "tesSUCCESS") throw new Error(`${label} ${code ?? "FAILED"}`);
}

/** Provision an empty Devnet borrower with loan MPT + full REP for LIVE demo reset. */
export async function provisionCleanLiveBorrower(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ classicAddress: string; seed: string }> {
  const wsUrl = env.XRPL_NETWORK?.trim() || config.xrplNetwork;
  const loanMpt = env.SHELLFISH_LOAN_MPT_ID?.trim();
  const repMpt = env.SHELLFISH_REP_MPT_ID?.trim();
  const repIssuerSeed = env.SHELLFISH_REP_ISSUER_SEED?.trim();
  if (!loanMpt || !repMpt || !repIssuerSeed) {
    throw new Error("LIVE_DEMO_RESET_ENV_INCOMPLETE");
  }
  const { usdIssuer } = latestNativeSecrets();
  const client = new Client(wsUrl);
  await client.connect();
  try {
    const borrower = Wallet.generate();
    await client.fundWallet(borrower, {
      faucetHost: "faucet.devnet.rippletest.net",
      faucetPath: "/accounts",
    });
    const usdIssuerWallet = Wallet.fromSeed(usdIssuer.seed);
    const repIssuer = Wallet.fromSeed(repIssuerSeed);
    await submit(
      client,
      borrower,
      {
        TransactionType: "MPTokenAuthorize",
        Account: borrower.address,
        MPTokenIssuanceID: loanMpt,
      },
      "loan-auth",
    );
    await submit(
      client,
      borrower,
      {
        TransactionType: "MPTokenAuthorize",
        Account: borrower.address,
        MPTokenIssuanceID: repMpt,
      },
      "rep-auth-holder",
    );
    await submit(
      client,
      repIssuer,
      {
        TransactionType: "MPTokenAuthorize",
        Account: repIssuer.address,
        Holder: borrower.address,
        MPTokenIssuanceID: repMpt,
      },
      "rep-auth-issuer",
    );
    await submit(
      client,
      usdIssuerWallet,
      {
        TransactionType: "Payment",
        Account: usdIssuerWallet.address,
        Destination: borrower.address,
        Amount: { mpt_issuance_id: loanMpt, value: "5000" },
      },
      "usd-fund",
    );
    await submit(
      client,
      repIssuer,
      {
        TransactionType: "Payment",
        Account: repIssuer.address,
        Destination: borrower.address,
        Amount: { mpt_issuance_id: repMpt, value: "1000000000" },
      },
      "rep-seed",
    );
    if (!borrower.seed) throw new Error("BORROWER_SEED_MISSING");
    return { classicAddress: borrower.classicAddress, seed: borrower.seed };
  } finally {
    await client.disconnect();
  }
}

async function resetSimulated(): Promise<DemoResetResult> {
  const started = Date.now();
  const previous = getCreditBackend();
  previous?.close();
  setCreditBackend(null);
  removeDatabaseFiles(config.databasePath);
  const next = openFixtureCreditBackend(config.databasePath);
  setCreditBackend({ ...next, mode: "SIMULATED_LOAN" });
  return {
    ok: true,
    mode: "SIMULATED_LOAN",
    borrower_account: null,
    took_ms: Date.now() - started,
  };
}

async function resetLive(): Promise<DemoResetResult> {
  const started = Date.now();
  const provisioned = await provisionCleanLiveBorrower(process.env);
  persistBorrowerSeed(provisioned.seed);
  const previous = getCreditBackend();
  previous?.close();
  setCreditBackend(null);
  removeDatabaseFiles(config.databasePath);
  const next = await openLiveCreditBackend(config.databasePath, {
    connectLedger: process.env.SHELLFISH_LIVE_CONNECT !== "0",
  });
  setCreditBackend(next as CreditBackend);
  return {
    ok: true,
    mode: "LIVE_DEVNET",
    borrower_account: next.liveConfig?.borrowerAddress ?? provisioned.classicAddress,
    took_ms: Date.now() - started,
  };
}

/** Gated demo reset for back-to-back judge runs. Never returns seeds. */
export async function runDemoReset(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DemoResetResult> {
  if (!demoResetEnabled(env)) {
    const err = new Error("DEMO_RESET_DISABLED");
    (err as Error & { code?: string }).code = "DEMO_RESET_DISABLED";
    throw err;
  }
  if (resetInFlight) return resetInFlight;
  resetInFlight = (async () => {
    try {
      if (config.networkMode === "SIMULATED_LOAN") return await resetSimulated();
      if (config.networkMode === "LIVE_DEVNET") return await resetLive();
      throw new Error("UNSUPPORTED_NETWORK_MODE");
    } finally {
      resetInFlight = null;
    }
  })();
  return resetInFlight;
}

export { demoResetEnabled };
