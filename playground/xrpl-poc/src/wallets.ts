import fs from "node:fs";
import path from "node:path";
import { Wallet } from "xrpl";
import { SETUP_PATH, WALLETS_DIR } from "./paths.js";

export type LendingSetup = {
  description: string;
  network: string;
  createdAt: string;
  loanBroker: { address: string; seed: string };
  borrower: { address: string; seed: string };
  depositor: { address: string; seed: string };
  credentialIssuer: { address: string; seed: string };
  domainID: string;
  mptID: string;
  vaultID: string;
  loanBrokerID: string;
  subscriptionDate: number;
  redemptionDate: number;
};

export function ensureDirs(): void {
  fs.mkdirSync(WALLETS_DIR, { recursive: true });
}

export function setupExists(): boolean {
  return fs.existsSync(SETUP_PATH);
}

export function loadSetup(): LendingSetup {
  if (!setupExists()) {
    throw new Error(
      `Missing ${SETUP_PATH}. Run: pnpm setup-lending`,
    );
  }
  return JSON.parse(fs.readFileSync(SETUP_PATH, "utf8")) as LendingSetup;
}

export function saveSetup(data: LendingSetup): void {
  ensureDirs();
  fs.writeFileSync(SETUP_PATH, JSON.stringify(data, null, 2));
  console.log(`Wrote setup (seeds local-only): ${path.relative(process.cwd(), SETUP_PATH)}`);
}

export function walletFromSetup(
  setup: LendingSetup,
  role: "loanBroker" | "borrower" | "depositor" | "credentialIssuer",
): Wallet {
  return Wallet.fromSeed(setup[role].seed);
}

/** Log addresses only — never full seeds. */
export function logAddresses(setup: LendingSetup): void {
  console.log(`Loan broker: ${setup.loanBroker.address}`);
  console.log(`Borrower:    ${setup.borrower.address}`);
  console.log(`Depositor:   ${setup.depositor.address}`);
  console.log(`VaultID:     ${setup.vaultID}`);
  console.log(`LoanBrokerID:${setup.loanBrokerID}`);
  console.log(`MPT ID:      ${setup.mptID}`);
}
