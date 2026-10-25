import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { contentHash } from "@shellfish/registry";
import { ScenarioFixture } from "@shellfish/schemas";
import { repayLoan } from "@shellfish/xrpl";
import { config } from "../config.js";
import { requireCreditBackend } from "../credit-context.js";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures",
);

/** Shared demo repay — You (XRPL) + Gita (registry accounting). */
export async function demoRoutes(app: FastifyInstance) {
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
