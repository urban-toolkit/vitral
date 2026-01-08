import 'dotenv/config';
import Fastify from "fastify";
import cors from "@fastify/cors";

import { llmRoutes } from "./routes/llm.ts";

const app = Fastify({ logger: true });

app.register(cors, { origin: true });
app.register(llmRoutes, { prefix: "/api/llm" });

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) app.log.error(err);
  console.log(`Server listening on ${port}`);
});