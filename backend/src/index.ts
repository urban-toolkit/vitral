import 'dotenv/config';
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

import { llmRoutes } from "./routes/llm.ts";
import { stateRoutes } from "./routes/state.ts";
import { githubRoutes } from "./routes/github.ts";
import dbPlugin from "./plugins/db.ts";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });
await app.register(dbPlugin);

await app.register(cookie, {
  secret: process.env.COOKIE_SECRET,
});

app.register(llmRoutes, { prefix: "/api/llm" });
app.register(stateRoutes, { prefix: "/api" });
app.register(githubRoutes, { prefix: "/api/auth/github" });

app.get("/api/db-health", async () => {
  const { rows } = await app.pg.query("SELECT 1 as ok");
  return { ok: rows[0].ok };
});

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) app.log.error(err);
  console.log(`Server listening on ${port}`);
});