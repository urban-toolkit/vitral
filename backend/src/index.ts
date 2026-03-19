import 'dotenv/config';
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";

import { llmRoutes } from "./routes/llm.js";
import { stateRoutes } from "./routes/state.js";
import { githubEventsRoutes } from "./routes/github_events.js";
import { githubRoutes } from "./routes/github.js";
import { systemPapersRoutes } from "./routes/system_papers.js";
import dbPlugin from "./plugins/db.js";
import s3Plugin from "./plugins/s3.js";
import { doclingRoutes } from './routes/docling.js';

const isProduction = process.env.NODE_ENV === "production";

const app = Fastify({ 
    logger: true,
    bodyLimit: 20 * 1024 * 1024, // 20MB
    trustProxy: isProduction
 });

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:9898",
  "http://localhost:3000",
  "https://arcade.evl.uic.edu",
]);

// const frontendOrigin = (() => {
//     const raw = process.env.FRONTEND_URL;
//     if (!raw) return undefined;
//     try {
//         return new URL(raw).origin;
//     } catch {
//         return undefined;
//     }
// })();

// await app.register(cors, {
//     origin: isProduction ? (frontendOrigin ?? false) : true,
//     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
//     credentials: true,
// });

await app.register(cors, {
  origin: (origin, cb) => {
    // non-browser or same-origin requests may have no Origin header
    if (!origin) {
      cb(null, true);
      return;
    }

    if (!isProduction) {
      cb(null, true);
      return;
    }

    cb(null, allowedOrigins.has(origin));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
});

await app.register(dbPlugin);
await app.register(s3Plugin);
app.register(multipart, {
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
    },
});

await app.register(cookie, {
    secret: process.env.COOKIE_SECRET,
});

app.register(llmRoutes, { prefix: "/api/llm" });
app.register(doclingRoutes, { prefix: "/api/docling" });
app.register(stateRoutes, { prefix: "/api" });
app.register(githubEventsRoutes, { prefix: "/api" });
app.register(githubRoutes, { prefix: "/api/auth/github" });
app.register(systemPapersRoutes, { prefix: "/api" });

app.get("/api/db-health", async () => {
    const { rows } = await app.pg.query("SELECT 1 as ok");
    return { ok: rows[0].ok };
});

const port = Number(process.env.BACKEND_PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }, (err) => {
    if (err) app.log.error(err);
    console.log(`Server listening on ${port}`);
});
