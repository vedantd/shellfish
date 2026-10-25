import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    ok: true,
    service: "shellfish-api",
    networkMode: config.networkMode,
    xrplNetwork: config.xrplNetwork,
  }));
}
