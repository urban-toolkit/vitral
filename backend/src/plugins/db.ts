import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import postgres from "@fastify/postgres";

const dbPlugin: FastifyPluginAsync = async (app) => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("Missing DATABASE_URL");
    }

    await app.register(postgres, {
        connectionString,
        // TODO: tune pool defaults 
        // max: 10,
        // idleTimeoutMillis: 30_000,
        // connectionTimeoutMillis: 2_000,
    });

    const { rows } = await app.pg.query("SELECT 1 as ok");
    app.log.info({ ok: rows?.[0]?.ok }, "Postgres connected");
};

export default fp(dbPlugin);
