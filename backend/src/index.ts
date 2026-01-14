import 'dotenv/config';
import Fastify from "fastify";
import cors from "@fastify/cors";

import { llmRoutes } from "./routes/llm.ts";
import { stateRoutes } from "./routes/state.ts";
import dbPlugin from "./plugins/db.ts";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(dbPlugin);
app.register(llmRoutes, { prefix: "/api/llm" });
app.register(stateRoutes, { prefix: "/api" });

app.get("/api/db-health", async () => {
  const { rows } = await app.pg.query("SELECT 1 as ok");
  return { ok: rows[0].ok };
});

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) app.log.error(err);
  console.log(`Server listening on ${port}`);
});