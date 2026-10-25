import type { FastifyInstance } from "fastify";

/**
 * Routes owned by Gita (evidence + lender evaluate + Nick match).
 * Stub responses only — wire @shellfish/evidence and @shellfish/compatibility next.
 */
export async function gitaRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/v1/evidence/:id", async (req) => ({
    status: "TODO",
    owner: "Gita",
    subjectId: req.params.id,
    message: "Return fixture-backed evidence passport — @shellfish/evidence",
  }));

  app.post<{ Params: { id: string } }>(
    "/v1/lenders/:id/evaluate",
    async (req) => ({
      status: "TODO",
      owner: "Gita",
      lenderId: req.params.id,
      message:
        "APPROVE or DECLINE with facility/offer refs — @shellfish/compatibility",
    }),
  );

  app.post("/v1/offers/match", async () => ({
    status: "TODO",
    owner: "Gita",
    message:
      "Matched offers or DENY_* — Nick matcher via @shellfish/compatibility",
  }));
}
