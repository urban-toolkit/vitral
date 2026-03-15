import { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { getFrontendUrl } from "../utils/urlResolution.js";

type TokenResponse =
    | { access_token: string; token_type: string; scope: string }
    | { error: string; error_description?: string; error_uri?: string };

type GhRepo = {
    name: string;
    full_name: string;
    private: boolean;
    owner: { login: string };
    default_branch: string;
    updated_at: string;
};

export const githubRoutes: FastifyPluginAsync = async (app) => {
    const secureCookies = process.env.COOKIE_SECURE === "true";

    const normalizeReturnToPath = (value: unknown): string => {
        if (typeof value !== "string") return "/projects";
        const trimmed = value.trim();
        if (!trimmed.startsWith("/")) return "/projects";
        if (trimmed.startsWith("//")) return "/projects";
        return trimmed;
    };

    app.get("/start", async (request, reply) => {
        const { returnTo } = request.query as { returnTo?: string };

        const statePayload = {
            csrf: crypto.randomBytes(16).toString("hex"),
            returnTo: normalizeReturnToPath(returnTo),
        };

        const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

        reply.setCookie("gh_oauth_state", state, {
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookies,
            path: "/",
            maxAge: 10 * 60,
        });

        const origin = `${request.protocol}://${request.host}`;
        const redirectUri = new URL(
            process.env.GITHUB_CALLBACK_PATH!,
            `${origin}/`
        ).toString();

        const params = new URLSearchParams({
            client_id: process.env.GITHUB_CLIENT_ID!,
            redirect_uri: redirectUri,
            scope: "read:user user:email repo",
            state,
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

        // Build redirect URI dynamically
        const origin = `${request.protocol}://${request.host}`;

        const redirectUri = new URL(
            process.env.GITHUB_CALLBACK_PATH!,
            `${origin}/`
        ).toString();

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
                redirect_uri: redirectUri,
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
            secure: secureCookies,
            path: "/",
            maxAge: 7 * 24 * 60 * 60, // 7 days 
        });

        reply.setCookie("gh_user", JSON.stringify({ id: ghUser.id, login: ghUser.login }), {
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookies,
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
        });

        // Decode state
        let returnTo = "/projects";
        try {
            const decoded = JSON.parse(
                Buffer.from(state, "base64url").toString("utf8")
            );
            returnTo = normalizeReturnToPath((decoded as { returnTo?: unknown }).returnTo);
        } catch {
            // fallback stays /projects
        }

        // const frontend = process.env.FRONTEND_URL ?? "http://localhost:5173";
        // reply.redirect(`${frontend}${returnTo}?github=connected`);
        reply.redirect(getFrontendUrl(request, normalizeReturnToPath(returnTo)));
    });

    app.get("/status", async (request, reply) => {
        const token = request.cookies["gh_access_token"];
        if (!token) {
            return { connected: false };
        }

        const res = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        });

        if (!res.ok) {
            // Clear expired or revoked tokens
            reply.clearCookie("gh_access_token", { path: "/" });
            reply.clearCookie("gh_user", { path: "/" });
            return { connected: false };
        }

        const user = await res.json();
        return { connected: true, user: { id: user.id, login: user.login } };
    });

    app.get("/repos", async (request, reply) => {
        const token = request.cookies["gh_access_token"];
        if (!token) return reply.status(401).send({ error: "Not connected to GitHub" });

        const params = new URLSearchParams({
            per_page: "100",
            sort: "updated",
            direction: "desc",
            // visibility: "all", // optional
            // affiliation: "owner,collaborator,organization_member", 
        });

        const ghRes = await fetch(`https://api.github.com/user/repos?${params}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        });

        if (!ghRes.ok) {
            const text = await ghRes.text();
            request.log.error({ status: ghRes.status, text }, "GitHub repos fetch failed");
            // token revoked/expired or missing scopes
            return reply.status(502).send({ error: "Failed to fetch repos from GitHub" });
        }

        const repos = (await ghRes.json()) as GhRepo[];

        return repos.map((r) => ({
            owner: r.owner.login,
            repo: r.name,
            fullName: r.full_name,
            private: r.private,
            defaultBranch: r.default_branch,
            updatedAt: r.updated_at,
        }));
    });

};
