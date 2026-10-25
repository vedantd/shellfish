import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** playground/xrpl-poc root */
export const POC_ROOT = path.resolve(here, "..");

export const WALLETS_DIR = path.join(POC_ROOT, ".wallets");
export const ARTIFACTS_DIR = path.join(POC_ROOT, "artifacts");
export const SETUP_PATH = path.join(WALLETS_DIR, "lendingSetup.json");
export const LAST_LOAN_PATH = path.join(ARTIFACTS_DIR, "last-loan.json");
