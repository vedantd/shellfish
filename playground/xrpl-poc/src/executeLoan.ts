import fs from "node:fs";
import { connectClient } from "./client.js";
import { checkRequiredFeatures, printFeatureReport } from "./features.js";
import {
  buildDualSignedLoanSet,
  extractLoanId,
  termsFromEnv,
} from "./loanSet.js";
import { ARTIFACTS_DIR, LAST_LOAN_PATH } from "./paths.js";
import {
  loadSetup,
  logAddresses,
  setupExists,
  walletFromSetup,
} from "./wallets.js";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");

  if (!setupExists()) {
    console.error("Missing setup. Run: pnpm setup-lending");
    process.exitCode = 1;
    return;
  }

  const client = await connectClient();
  try {
    const report = await checkRequiredFeatures(client);
    printFeatureReport(report);
    if (!report.allEnabled) {
      if (!force) {
        console.error(
          "\nNO-GO: features disabled. Pass --force to attempt anyway (not recommended).",
        );
        process.exitCode = 1;
        return;
      }
      console.warn("\n--force: continuing despite feature-check failure");
    }

    const setup = loadSetup();
    console.log("\n=== execute-loan (dual-sign LoanSet) ===\n");
    logAddresses(setup);

    const loanBroker = walletFromSetup(setup, "loanBroker");
    const borrower = walletFromSetup(setup, "borrower");
    const terms = termsFromEnv();

    console.log("\nTerms:", {
      principal: terms.principal,
      interestRateTenthsBps: terms.interestRateTenthsBps,
      paymentTotal: terms.paymentTotal,
      paymentIntervalSec: terms.paymentIntervalSec,
      gracePeriodSec: terms.gracePeriodSec,
    });

    const fullySigned = await buildDualSignedLoanSet({
      client,
      loanBroker,
      borrower,
      loanBrokerID: setup.loanBrokerID,
      terms,
    });

    console.log("\nSubmitting LoanSet...");
    const submitResponse = await client.submitAndWait(fullySigned.tx);
    const meta = submitResponse.result.meta;
    if (!meta || typeof meta === "string") {
      console.error("Missing transaction meta — not treating as success.");
      process.exitCode = 1;
      return;
    }

    const resultCode = meta.TransactionResult;
    if (resultCode !== "tesSUCCESS") {
      console.error("LoanSet failed:", resultCode);
      console.error(JSON.stringify(submitResponse.result, null, 2));
      process.exitCode = 1;
      return;
    }

    const loanID = extractLoanId(meta);
    const txHash = submitResponse.result.hash;
    const ledgerIndex = submitResponse.result.ledger_index;

    const artifact = {
      network: client.url,
      submittedAt: new Date().toISOString(),
      transactionResult: resultCode,
      txHash,
      ledgerIndex,
      loanID: loanID ?? null,
      loanBrokerID: setup.loanBrokerID,
      vaultID: setup.vaultID,
      mptID: setup.mptID,
      brokerAddress: loanBroker.address,
      borrowerAddress: borrower.address,
      terms,
      explorerHint: `https://devnet.xrpl.org/transactions/${txHash}`,
    };

    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    fs.writeFileSync(LAST_LOAN_PATH, JSON.stringify(artifact, null, 2));

    console.log("\nPASS: LoanSet tesSUCCESS");
    console.log("  txHash:", txHash);
    console.log("  loanID:", loanID ?? "(not found in meta)");
    console.log("  ledger:", ledgerIndex);
    console.log("  artifact:", LAST_LOAN_PATH);
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
