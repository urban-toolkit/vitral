import type { FastifyInstance } from "fastify";

import {
    hashPassword,
    validateCredentials,
    verifyPassword,
    type CredentialProblem,
} from "../utils/passwords.js";
import type { SessionUser } from "../plugins/auth.js";

type AccountBody = {
    username?: unknown;
    password?: unknown;
    email?: unknown;
};

function readCredentials(body: AccountBody): { username: string; password: string; email: string } {
    return {
        username: typeof body.username === "string" ? body.username.trim() : "",
        password: typeof body.password === "string" ? body.password : "",
        email: typeof body.email === "string" ? body.email.trim() : "",
    };
}

function publicUser(user: SessionUser) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at,
    };
}

export async function authRoutes(app: FastifyInstance) {
    /**
     * Who is signed in.
     * GET /api/auth/session
     *
     * Deliberately 200-with-null rather than 401: the frontend calls this on every load to decide
     * which screen to show, and "nobody is signed in" is an answer, not an error.
     */
    app.get("/session", async (request) => {
        const user = await app.currentUser(request);
        return { user: user ? publicUser(user) : null };
    });

    /**
     * Create an account and sign in with it.
     * POST /api/auth/register  { username, password, email? }
     */
    app.post("/register", async (request, reply) => {
        const { username, password, email } = readCredentials((request.body ?? {}) as AccountBody);

        const problems = validateCredentials({ username, password, email });
        if (problems.length > 0) {
            return reply.status(400).send({ error: problems[0].message, problems });
        }

        const usernameLower = username.toLowerCase();

        // Checked here for the message, and again by the UNIQUE index below for the truth — two
        // registrations racing on the same name both pass this and one loses at the insert.
        const existing = await app.pg.query(
            `SELECT 1 FROM app_users WHERE username_lower = $1`,
            [usernameLower],
        );
        if (existing.rows.length > 0) {
            const taken: CredentialProblem[] = [
                { field: "username", message: "That username is taken." },
            ];
            return reply.status(409).send({ error: taken[0].message, problems: taken });
        }

        const passwordHash = await hashPassword(password);

        let rows: SessionUser[];
        try {
            ({ rows } = await app.pg.query<SessionUser>(
                `
                INSERT INTO app_users (username, username_lower, email, password_hash)
                VALUES ($1, $2, $3, $4)
                RETURNING id, username, email, created_at
                `,
                [username, usernameLower, email === "" ? null : email, passwordHash],
            ));
        } catch (error) {
            // 23505 = unique_violation: the race above landed on the losing side.
            if (typeof error === "object" && error !== null && (error as { code?: string }).code === "23505") {
                return reply.status(409).send({
                    error: "That username is taken.",
                    problems: [{ field: "username", message: "That username is taken." }],
                });
            }
            throw error;
        }

        const user = rows[0];
        await app.startSession(reply, user.id);
        return reply.status(201).send({ user: publicUser(user) });
    });

    /**
     * Sign in.
     * POST /api/auth/login  { username, password }
     */
    app.post("/login", async (request, reply) => {
        const { username, password } = readCredentials((request.body ?? {}) as AccountBody);

        if (username === "" || password === "") {
            return reply.status(400).send({ error: "Enter your username and password." });
        }

        const { rows } = await app.pg.query<SessionUser & { password_hash: string }>(
            `
            SELECT id, username, email, created_at, password_hash
            FROM app_users
            WHERE username_lower = $1
            `,
            [username.toLowerCase()],
        );

        const record = rows[0];
        // The same message and roughly the same work either way: telling an unauthenticated caller
        // that a username exists is a free enumeration oracle, and answering "no such user"
        // instantly while a real user costs 100ms of scrypt is the same oracle by timing.
        const ok = record
            ? await verifyPassword(password, record.password_hash)
            : await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");

        if (!record || !ok) {
            return reply.status(401).send({ error: "Wrong username or password." });
        }

        await app.startSession(reply, record.id);
        return { user: publicUser(record) };
    });

    /**
     * Sign out. Idempotent: signing out when nobody is signed in is a success, not a 401.
     * POST /api/auth/logout
     */
    app.post("/logout", async (request, reply) => {
        await app.endSession(request, reply);
        return { ok: true };
    });
}
