type Nativeish = {
  native?: {
    txHash: string;
    validated?: boolean;
    result?: string;
  };
};

/**
 * Structural LIVE verifier for product wiring / unit tests.
 * Does not re-query Devnet — Gita's native-e2e remains the ledger proof harness.
 * Production can replace with a client-backed verifier when Devnet execution is granted.
 */
export function createStructuralNativeVerifiers(): {
  verifyNativeEvent: (event: Nativeish, _binding: unknown) => Promise<void>;
  verifyNativePortfolio: (
    seed: { mode: string },
    borrowerAccount: string,
    _evidence: unknown,
  ) => Promise<void>;
} {
  return {
    async verifyNativeEvent(event) {
      if (!event.native) throw new Error("[xrpl] native evidence required");
      if (!/^[A-Fa-f0-9]{64}$/.test(event.native.txHash)) {
        throw new Error("[xrpl] invalid native txHash");
      }
      if (event.native.validated !== true || event.native.result !== "tesSUCCESS") {
        throw new Error("[xrpl] native success required");
      }
    },
    async verifyNativePortfolio(seed, borrowerAccount) {
      if (seed.mode !== "LIVE_DEVNET") {
        throw new Error("[xrpl] portfolio seed must be LIVE_DEVNET");
      }
      if (!borrowerAccount || !borrowerAccount.startsWith("r")) {
        throw new Error("[xrpl] live borrower must be a classic address");
      }
    },
  };
}
