/** Public evidence recheck. No private files, signing, funding or transaction submission. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateRepGrowthU, quoteRepBondU } from "../../packages/registry/dist/index.js";
import { getValidatedTx, nativeEvidence, ledgerUnix, createdNode, mptBalanceChange,
  loanPrincipalChange, completeLoanHistory } from "./native-ledger.mjs";
import { readRepState } from "./native-rep.mjs";

const require = createRequire(new URL("../../packages/xrpl/package.json", import.meta.url));
const { Client } = require("xrpl");
const folder = fileURLToPath(new URL("./", import.meta.url));
const transaction = tx => tx.tx_json ?? tx;
const quantity = tx => (transaction(tx).DeliverMax ?? transaction(tx).Amount).value;

export async function verifyNativeResult(path) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(report.result, "PASS");
  assert.equal(report.mode, "LIVE_DEVNET");
  assert.equal(report.plan.network_id, 2);
  const original = JSON.parse(readFileSync(resolve(folder, "native-evidence.json"), "utf8"));
  const oldAccounts = new Set(Object.values(original.public_identifiers));
  for (const address of Object.values(report.accounts)) assert.equal(oldAccounts.has(address), false,
    "Fixture accounts must be separate from the original POC");
  const client = new Client("wss://s.devnet.rippletest.net:51233", { connectionTimeout: 15000, timeout: 30000 });
  try {
    await client.connect();
    assert.equal((await client.request({ command: "server_info" })).result.info.network_id, 2);
    const queried = {};
    for (const label of ["rep-seed", "rep-redeem", "loan-originate", "loan-repay", "rep-restore"]) {
      const record = report.transactions.find(t => t.label === label);
      assert.ok(record, `Missing public receipt: ${label}`);
      const tx = await getValidatedTx(client, record.txHash);
      for (const [key, value] of Object.entries(nativeEvidence(tx))) assert.equal(record[key], value);
      assert.equal(record.ledgerHash, tx.ledger_hash);
      queried[label] = tx;
    }
    const seed = queried["rep-seed"];
    const redeemed = queried["rep-redeem"];
    const originated = queried["loan-originate"];
    const repaid = queried["loan-repay"];
    const restored = queried["rep-restore"];
    const rep = report.rep_asset;
    for (const [tx, sender, destination] of [[seed, rep.issuer, report.accounts.borrower],
      [redeemed, report.accounts.borrower, rep.issuer], [restored, rep.issuer, report.accounts.borrower]]) {
      assert.equal(transaction(tx).TransactionType, "Payment");
      assert.equal(transaction(tx).Account, sender);
      assert.equal(transaction(tx).Destination, destination);
      assert.equal((transaction(tx).DeliverMax ?? transaction(tx).Amount).mpt_issuance_id, rep.mpt_issuance_id);
    }
    assert.equal(quantity(seed), "1000000000");
    const loan = createdNode(originated, "Loan");
    assert.equal(loan.id, report.loan_id);
    assert.equal(loan.fields.Borrower, report.accounts.borrower);
    const principal = BigInt(loan.fields.PrincipalOutstanding);
    const bond = quoteRepBondU(0n, principal * 100n, 100n);
    assert.equal(quantity(redeemed), bond.toString());
    const change = loanPrincipalChange(repaid, loan.id);
    assert.equal(change.fullContractualRepayment, true);
    assert.equal(change.reduction, principal.toString());
    const history = await completeLoanHistory(client, loan.id, originated, repaid);
    assert.equal(history.events.length, 2);
    assert.equal(history.previousEventHash, originated.hash);
    const elapsed = ledgerUnix(repaid) - ledgerUnix(originated);
    assert.ok(elapsed >= 0);
    const maturity = loan.fields.NextPaymentDueDate + Date.UTC(2000, 0, 1) / 1000;
    assert.ok(ledgerUnix(repaid) <= maturity);
    const growth = calculateRepGrowthU({ intervals: [{ principalMinor: principal * 100n, elapsedSeconds: BigInt(elapsed) }],
      moneyScale: 100n, eligible: true, remainingRollingBudgetU: 20000000n, survivingRepU: 1000000000n });
    assert.equal(quantity(restored), (bond + growth).toString());
    const at = async ledgerIndex => readRepState({ client, issuanceId: rep.mpt_issuance_id,
      holder: report.accounts.borrower, issuer: rep.issuer, ledgerIndex });
    const seeded = await at(seed.ledger_index);
    const burned = await at(redeemed.ledger_index);
    const returned = await at(restored.ledger_index);
    assert.equal(seeded.holderAmountU, "1000000000");
    assert.equal(burned.holderAmountU, (1000000000n - bond).toString());
    assert.equal(returned.holderAmountU, (1000000000n + growth).toString());
    for (const state of [seeded, burned, returned]) assert.equal(state.outstandingAmountU, state.holderAmountU);
    assert.equal(report.final.reputation.available_u, returned.holderAmountU);
    const debit = (-BigInt(mptBalanceChange(repaid, report.accounts.borrower, report.loan_asset.mpt_issuance_id).delta)).toString();
    assert.equal(report.repayment.actual_debit_native_units, debit);
    assert.equal(report.repayment.growth_u, growth.toString());
    assert.equal(report.repayment.elapsed_ledger_seconds, elapsed);
    const current = await at("validated");
    assert.equal(current.holderAmountU, returned.holderAmountU, "Native test balance changed after the captured return");
    return { result: "PASS", verification: "INDEPENDENT_PUBLIC_LEDGER_RECHECK", verified_at_utc: new Date().toISOString(),
      run_id: report.run_id, network: "devnet", accounts_separate_from_original_poc: true,
      transactions: Object.entries(queried).map(([label, tx]) => ({ label, ...nativeEvidence(tx),
        explorer: `https://devnet.xrpl.org/transactions/${tx.hash}` })),
      principal_native_units: principal.toString(), submitted_maximum_native_units: transaction(repaid).Amount.value,
      actual_debit_native_units: debit, principal_reduction_native_units: change.reduction,
      elapsed_ledger_seconds: elapsed, original_bond_u: bond.toString(), growth_u: growth.toString(),
      returned_u: quantity(restored), final_holder_rep_u: returned.holderAmountU,
      current_holder_rep_u: current.holderAmountU, history_coverage: history.coverage,
      balance_agrees_with_registry: true, private_keys_loaded: false, transactions_submitted: 0,
      reward_clock: "VALIDATED_LEDGER_CLOSE_TIMES_PER_REP_CURVE_V0_2" };
  } finally {
    if (client.isConnected()) await client.disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const latest = readdirSync(folder).filter(n => /^native-result-.*\.json$/.test(n)).sort().reverse()
      .find(n => JSON.parse(readFileSync(resolve(folder, n), "utf8")).result === "PASS");
    assert.ok(process.argv[2] || latest, "No completed native report found");
    const path = process.argv[2] ? resolve(process.argv[2]) : resolve(folder, latest);
    process.stdout.write(JSON.stringify(await verifyNativeResult(path), null, 2) + "\n");
  } catch (error) {
    process.stderr.write(`Native evidence recheck failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
