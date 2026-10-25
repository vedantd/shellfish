import type { FastifyInstance } from "fastify";

/** Shared demo repay — You (XRPL) + Gita (evidence). */
export async function demoRoutes(app: FastifyInstance) {
  app.post("/v1/demo/repay", async () => ({
    status: "TODO",
    owners: ["You", "Gita"],
    message:
      "Submit actual LoanPay or synthetic event explicitly flagged as simulated",
  }));
}
