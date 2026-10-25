/**
 * Stretch: LoanPay against artifacts/last-loan.json.
 * Follow-up if LoanPay fields differ on Devnet — does not invent success hashes.
 */
import fs from "node:fs";
import { connectClient } from "./client.js";
import { LAST_LOAN_PATH } from "./paths.js";
import { loadSetup, walletFromSetup } from "./wallets.js";

type LastLoan = {
  loanID: string | null;
  mptID: string;
  terms: { principal: string };
};

async function main(): Promise<void> {
  if (!fs.existsSync(LAST_LOAN_PATH)) {
    console.error(`Missing ${LAST_LOAN_PATH}. Run: pnpm execute-loan`);
    process.exitCode = 1;
    return;
  }

  const last = JSON.parse(fs.readFileSync(LAST_LOAN_PATH, "utf8")) as LastLoan;
  if (!last.loanID) {
    console.error("last-loan.json has no loanID");
    process.exitCode = 1;
    return;
  }

  const setup = loadSetup();
  const borrower = walletFromSetup(setup, "borrower");
  const client = await connectClient();

  try {
    console.log("\n=== repay-loan (LoanPay) ===\n");
    console.log("LoanID:", last.loanID);

    // Overpay principal+fees buffer for a single-payment loan demo.
    const amountValue = String(Number(last.terms.principal) * 2);

    const tx = await client.autofill({
      TransactionType: "LoanPay",
      Account: borrower.address,
      LoanID: last.loanID,
      Amount: {
        mpt_issuance_id: last.mptID,
        value: amountValue,
      },
    });

    const submitResponse = await client.submitAndWait(tx, {
      wallet: borrower,
    });
    const meta = submitResponse.result.meta;
    if (!meta || typeof meta === "string") {
      console.error("Missing meta");
      process.exitCode = 1;
      return;
    }

    const resultCode = meta.TransactionResult;
    if (resultCode !== "tesSUCCESS") {
      console.error("LoanPay failed:", resultCode);
      console.error(JSON.stringify(submitResponse.result, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log("PASS: LoanPay tesSUCCESS");
    console.log("  txHash:", submitResponse.result.hash);
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
