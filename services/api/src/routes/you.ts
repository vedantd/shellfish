import type { FastifyInstance } from "fastify";

/**
 * Routes owned by You (Shellfish + XRPL + receipts).
 * Stub responses only — wire @shellfish/authorization and @shellfish/xrpl next.
 */
export async function youRoutes(app: FastifyInstance) {
  app.post("/v1/mandates", async () => ({
    status: "TODO",
    owner: "You",
    message: "Store signed mandate — implement via @shellfish/authorization",
  }));

  app.post("/v1/authorizations", async () => ({
    status: "TODO",
    owner: "You",
    message: "ALLOW/DENY + hashes — implement via @shellfish/authorization",
  }));

  app.post("/v1/loans/originate", async () => ({
    status: "TODO",
    owner: "You",
    message:
      "Idempotent reserve → sign → submit → reconcile — @shellfish/xrpl + registry",
  }));

  app.get<{ Params: { id: string } }>("/v1/loans/:id", async (req) => ({
    status: "TODO",
    owner: "You",
    loanId: req.params.id,
    message: "Local workflow state + verified on-chain Loan ID if available",
  }));

  app.get<{ Params: { id: string } }>("/v1/receipts/:id", async (req) => ({
    status: "TODO",
    owner: "You",
    receiptId: req.params.id,
    message: "Decision, signatures, tx status, timestamps, evidence refs",
  }));
}
