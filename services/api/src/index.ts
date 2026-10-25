import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config.js";
import {
  setCreditBackend,
  type CreditBackend,
} from "./credit-context.js";
import { openFixtureCreditBackend } from "./db/fixtures.js";
import { openLiveCreditBackend } from "./live-backend.js";
import { demoRoutes } from "./routes/demo.js";
import { gitaRoutes } from "./routes/gita.js";
import { healthRoutes } from "./routes/health.js";
import { youRoutes } from "./routes/you.js";

const app = Fastify({ logger: true });

let backend: CreditBackend | null = null;

if (config.networkMode === "SIMULATED_LOAN") {
  backend = openFixtureCreditBackend(config.databasePath);
  setCreditBackend(backend);
  app.log.info(
    { databasePath: config.databasePath },
    "Opened fixture credit backend for SIMULATED_LOAN",
  );
} else if (config.networkMode === "LIVE_DEVNET") {
  try {
    backend = await openLiveCreditBackend(config.databasePath, {
      connectLedger: process.env.SHELLFISH_LIVE_CONNECT !== "0",
    });
    setCreditBackend(backend);
    app.log.info(
      {
        databasePath: config.databasePath,
        borrower: backend.liveConfig?.borrowerAddress,
        endpoint: backend.liveConfig?.wsUrl,
      },
      "Opened LIVE_DEVNET credit backend",
    );
  } catch (err) {
    app.log.error(
      { err },
      "LIVE_DEVNET bootstrap failed — API starts without credit backend (routes return errors until env is complete)",
    );
  }
}

await app.register(cors, { origin: true });
await app.register(healthRoutes);
await app.register(youRoutes);
await app.register(gitaRoutes, {
  services: backend?.services,
  mode: config.networkMode,
});
await app.register(demoRoutes);

app.addHook("onClose", async () => {
  backend?.close();
  setCreditBackend(null);
});

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    `Shellfish API listening on http://${config.host}:${config.port} (${config.networkMode})`,
  );
} catch (err) {
  backend?.close();
  setCreditBackend(null);
  app.log.error(err);
  process.exit(1);
}
