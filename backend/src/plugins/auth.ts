import crypto from "node:crypto";
import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

/**
 * Server-side sessions in a cookie.
 *
 * The cookie carries an opaque 32-byte random token and nothing else — no user id, no claims, no
 * signature to verify. What is stored in `user_sessions` is the token's SHA-256, so the database
 * cannot be read back into a working login, and logging out is a `DELETE` that actually ends the
 * session rather than a client-side promise to forget a JWT.
 *
 * The cookie is unsigned, matching the GitHub OAuth cookies already set in `routes/github.ts`.
 * Signing would add nothing: the token is unguessable and is checked against the table on every
 * request, so a forged value fails the lookup.
 */
export const SESSION_COOKIE_NAME = "vitral_session";

const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Mirrors `routes/github.ts`: `COOKIE_SECURE` is false in dev, true in production. */
function secureCookies(): boolean {
    return process.env.COOKIE_SECURE === "true";
}

export type SessionUser = {
    id: string;
    username: string;
    email: string | null;
    created_at: string;
};

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

declare module "fastify" {
    interface FastifyInstance {
        /** The signed-in user for this request, or `null`. Cached per request. */
        currentUser(request: FastifyRequest): Promise<SessionUser | null>;
        /** `currentUser`, but sends a 401 and returns `null` when there is nobody signed in. */
        requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null>;
        /** Mints a session for `userId` and puts its token in the reply's cookie. */
        startSession(reply: FastifyReply, userId: string): Promise<void>;
        /** Ends the session this request carries, if any, and clears the cookie. */
        endSession(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    }

    interface FastifyRequest {
        /**
         * Per-request memo for `currentUser`. `undefined` means "not looked up yet", `null` means
         * "looked up, nobody" — a route that asks twice must not cost two queries, and several do.
         */
        sessionUser?: SessionUser | null;
    }
}

const authPlugin: FastifyPluginAsync = async (app) => {
    app.decorateRequest("sessionUser", undefined);

    app.decorate("currentUser", async (request: FastifyRequest): Promise<SessionUser | null> => {
        if (request.sessionUser !== undefined) return request.sessionUser;

        const token = request.cookies[SESSION_COOKIE_NAME];
        if (!token) {
            request.sessionUser = null;
            return null;
        }

        const { rows } = await app.pg.query<SessionUser>(
            `
            SELECT u.id, u.username, u.email, u.created_at
            FROM user_sessions s
            JOIN app_users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at > now()
            `,
            [hashToken(token)],
        );

        const user = rows[0] ?? null;
        request.sessionUser = user;
        return user;
    });

    app.decorate("requireUser", async (
        request: FastifyRequest,
        reply: FastifyReply,
    ): Promise<SessionUser | null> => {
        const user = await app.currentUser(request);
        if (!user) {
            reply.status(401).send({ error: "Sign in to do that." });
            return null;
        }
        return user;
    });

    app.decorate("startSession", async (reply: FastifyReply, userId: string): Promise<void> => {
        const token = crypto.randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

        await app.pg.query(
            `INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
            [userId, hashToken(token), expiresAt.toISOString()],
        );

        // Opportunistic sweep of this account's dead sessions. Cheap, indexed, and it keeps the
        // table from growing without a scheduled job the deployment does not have.
        await app.pg.query(
            `DELETE FROM user_sessions WHERE user_id = $1 AND expires_at <= now()`,
            [userId],
        );

        reply.setCookie(SESSION_COOKIE_NAME, token, {
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookies(),
            path: "/",
            maxAge: SESSION_TTL_MS / 1000,
        });
    });

    app.decorate("endSession", async (
        request: FastifyRequest,
        reply: FastifyReply,
    ): Promise<void> => {
        const token = request.cookies[SESSION_COOKIE_NAME];
        if (token) {
            await app.pg.query(`DELETE FROM user_sessions WHERE token_hash = $1`, [hashToken(token)]);
        }
        request.sessionUser = null;
        reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    });
};

export default fp(authPlugin, { dependencies: [] });
