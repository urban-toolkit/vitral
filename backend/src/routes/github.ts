import { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";

type TokenResponse =
  | { access_token: string; token_type: string; scope: string }
  | { error: string; error_description?: string; error_uri?: string };

export const githubRoutes: FastifyPluginAsync = async (app) => {
    app.get("/start", async (_req, reply) => {

        const state = crypto.randomBytes(16).toString("hex");

        reply.setCookie("gh_oauth_state", state, {
            httpOnly: true,
            sameSite: "lax",
            secure: false, // true in prod (https)
            path: "/",
            maxAge: 10 * 60, // 10 minutes
        });

        const params = new URLSearchParams({
            client_id: process.env.GITHUB_CLIENT_ID!,
            redirect_uri: process.env.GITHUB_CALLBACK_URL!,
            scope: "read:user user:email",
            state
        });

        reply.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
    });

    app.get("/callback", async (request, reply) => {
        const { code, state } = request.query as { code?: string; state?: string };

        if (!code) return reply.status(400).send({ error: "Missing code" });
        if (!state) return reply.status(400).send({ error: "Missing state" });

        const cookieState = request.cookies["gh_oauth_state"];
        if (!cookieState || cookieState !== state) {
            return reply.status(400).send({ error: "Invalid state" });
        }

        // Clear one-time state cookie
        reply.clearCookie("gh_oauth_state", { path: "/" });

        // Exchange code for access token
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: process.env.GITHUB_CLIENT_ID!,
                client_secret: process.env.GITHUB_CLIENT_SECRET!,
                code,
                redirect_uri: process.env.GITHUB_CALLBACK_URL!,
            }),
        });

        if (!tokenRes.ok) {
            const text = await tokenRes.text();
            request.log.error({ status: tokenRes.status, text }, "GitHub token exchange failed");
            return reply.status(502).send({ error: "GitHub token exchange failed" });
        }

        const tokenJson = (await tokenRes.json()) as TokenResponse;

        if ("error" in tokenJson) {
            request.log.error({ tokenJson }, "GitHub token exchange error");
            return reply.status(400).send({ error: tokenJson.error, detail: tokenJson.error_description });
        }

        const accessToken = tokenJson.access_token;

        const userRes = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.github+json",
            },
        });

        if (!userRes.ok) {
            const text = await userRes.text();
            request.log.error({ status: userRes.status, text }, "GitHub user fetch failed");
            return reply.status(502).send({ error: "GitHub user fetch failed" });
        }

        const ghUser = (await userRes.json()) as { id: number; login: string };

        // TODO: store token server-side in DB, and cookie holds session id.
        reply.setCookie("gh_access_token", accessToken, {
            httpOnly: true,
            sameSite: "lax",
            secure: false, // true in prod (https)
            path: "/",
            maxAge: 7 * 24 * 60 * 60, // 7 days 
        });

        reply.setCookie("gh_user", JSON.stringify({ id: ghUser.id, login: ghUser.login }), {
            httpOnly: false, // so frontend can show "Connected as ..."
            sameSite: "lax",
            secure: false,
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
        });

        const frontend = process.env.FRONTEND_URL ?? "http://localhost:5173";
        reply.redirect(`${frontend}/projects?github=connected`);
    });

};
