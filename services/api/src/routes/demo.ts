import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { contentHash } from "@shellfish/registry";
import { ScenarioFixture } from "@shellfish/schemas";
import { repayLoan } from "@shellfish/xrpl";
import { config } from "../config.js";
import { getApprovedOffer, requireCreditBackend } from "../credit-context.js";
import { runDemoReset } from "../demo-reset.js";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures",
);

/** Shared demo repay — You (XRPL) + Gita (registry accounting). */
export async function demoRoutes(app: FastifyInstance) {
  app.post("/v1/demo/reset", async (_req, reply) => {
    try {
      return await runDemoReset();
    } catch (err) {
      const code =
        err instanceof Error && "code" in err && typeof err.code === "string"
          ? err.code
          : err instanceof Error && err.message === "DEMO_RESET_DISABLED"
            ? "DEMO_RESET_DISABLED"
            : "DEMO_RESET_FAILED";
      reply.code(code === "DEMO_RESET_DISABLED" ? 403 : 500);
      return {
        ok: false,
        code,
        message:
          err instanceof Error
            ? err.message
            : "Demo reset failed",
        mode: config.networkMode,
      };
    }
  });

  app.post<{
    Body: {
      loan_id?: string;
      request_id?: string;
      principal_reduction_minor?: string;
      amount?: string;
    };
  }>("/v1/demo/repay", async (req, reply) => {
    try {
      const backend = requireCreditBackend();
      const scenario = ScenarioFixture.parse(
        JSON.parse(
          readFileSync(resolve(fixturesDir, "scenario.json"), "utf8"),
        ),
      );
      const loanId = req.body?.loan_id;
      const requestId = req.body?.request_id;
      if (!loanId || !requestId) {
        reply.code(400);
        return {
          code: "DENY_TRANSACTION_MISMATCH",
          message: "loan_id and request_id required",
          mode: config.networkMode,
        };
      }

      const record = backend.registry.getRequest(requestId);
      const originEventId = `origin:${requestId}`;
      const clock = Math.floor(Date.parse(scenario.clock) / 1000) + 90 * 86400;

      const isLive = config.networkMode === "LIVE_DEVNET";
      if (isLive && !backend.live) {
        reply.code(503);
        return {
          code: "LIVE_LEDGER_UNAVAILABLE",
          message: "LIVE ledger not connected",
          mode: config.networkMode,
        };
      }

      if (isLive) {
        if (!backend.lifecycle) throw new Error("DURABLE_NATIVE_LIFECYCLE_REQUIRED");
        const loan = backend.registry.getLoan(loanId);
        if (loan.request_id !== requestId) throw new Error("LOAN_REQUEST_BINDING_MISMATCH");
        const amount = req.body?.amount ?? "2000.00";
        if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(amount)) throw new Error("INVALID_DISPLAY_REPAYMENT_AMOUNT");
        const scale = backend.liveConfig?.loanAssetScale ?? 6;
        if (!Number.isSafeInteger(scale) || scale < 2 || scale > 18) throw new Error("INVALID_NATIVE_ASSET_SCALE");
        const [whole, fraction = ""] = amount.split(".");
        const nativeAmount = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * 10n ** BigInt(scale - 2);
        const operation = await backend.lifecycle.repay({ operationId: `demo-repay:${requestId}`,
          loanId, requestId, maximumAmountNative: nativeAmount.toString(), paymentMode: "FULL" });
        if (!["VALIDATED", "FAILED"].includes(operation.state)) reply.code(202);
        return { ...operation, mode: config.networkMode,
          status: backend.registry.getCreditStatus((record.request as { facility_id: string }).facility_id) };
      }
      const result = await repayLoan({
        loanId,
        amount: req.body?.amount ?? "2000.00",
        networkMode: config.networkMode,
        requestId,
        principalReductionMinor:
          req.body?.principal_reduction_minor ?? record.principalMinor,
        fullContractualRepayment: true,
        sim: {
          getRequest: (id) => backend.registry.getRequest(id),
          applyEvent: (event) => backend.registry.applyEvent(event as never),
          hashRequest: contentHash,
          getApprovedOffer,
          clockSeconds: () =>
            isLive ? Math.floor(Date.now() / 1000) : clock,
          borrowerAccount: isLive
            ? (backend.liveConfig?.borrowerAddress ?? "live:borrower")
            : "sim:borrower-harbor-supply",
          repAsset: isLive
            ? backend.liveConfig!.publicSigning.native_rep_asset
            : scenario.rep_asset,
          originHash: isLive
            ? (backend.registry.getRequest(requestId) as { stakeHash?: string })
                .stakeHash
            : `sim:${originEventId}`,
          previousEventId: originEventId,
          live: backend.live,
        },
      });

      return {
        ...result,
        mode: config.networkMode,
        status: backend.registry.getCreditStatus(
          (record.request as { facility_id: string }).facility_id,
        ),
      };
    } catch (err) {
      reply.code(400);
      return {
        code: "DENY_TRANSACTION_MISMATCH",
        message: err instanceof Error ? err.message : "repay failed",
        mode: config.networkMode,
      };
    }
  });
}
