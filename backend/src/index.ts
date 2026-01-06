import 'dotenv/config';
import Fastify from "fastify";
import cors from "@fastify/cors";

import { llmRoutes } from "./routes/llm.ts";

const app = Fastify({ logger: true });
app.register(llmRoutes, { prefix: "/api/llm" });

app.register(cors, { origin: true });

const port = Number(process.env.PORT ?? 3000);
app.listen({ port }, (err) => {
  if (err) app.log.error(err);
  console.log(`Server listening on ${port}`);
});