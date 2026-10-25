import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config.js";
import { demoRoutes } from "./routes/demo.js";
import { gitaRoutes } from "./routes/gita.js";
import { healthRoutes } from "./routes/health.js";
import { youRoutes } from "./routes/you.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(healthRoutes);
await app.register(youRoutes);
await app.register(gitaRoutes);
await app.register(demoRoutes);

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    `Shellfish API listening on http://${config.host}:${config.port} (${config.networkMode})`,
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
