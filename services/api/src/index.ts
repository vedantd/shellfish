import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config.js";
import {
  setCreditBackend,
  type CreditBackend,
} from "./credit-context.js";
import { openFixtureCreditBackend } from "./db/fixtures.js";
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
