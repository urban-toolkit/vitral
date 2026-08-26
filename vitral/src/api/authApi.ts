import { resolveApiBaseUrl } from "@/api/baseUrl";

const API_BASE = resolveApiBaseUrl();

export type AccountUser = {
    id: string;
    username: string;
    email: string | null;
    created_at: string;
};

export type CredentialProblem = {
    field: "username" | "password" | "email";
    message: string;
};

/**
 * A failed sign-in is an answer, not a crash: the form needs the message and, where the server gave
 * one, the field it belongs to. A bare `Error("400")` would put "400" in front of the researcher.
 */
export class AuthError extends Error {
    readonly status: number;
    readonly problems: CredentialProblem[];

    constructor(message: string, status: number, problems: CredentialProblem[] = []) {
        super(message);
        this.name = "AuthError";
        this.status = status;
        this.problems = problems;
    }
}

async function authFetch(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        // The session lives in an httpOnly cookie, so every call has to carry it. Without this the
        // browser sends nothing cross-origin and every request looks signed out.
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
    });

    let payload: unknown = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const body = (payload ?? {}) as { error?: unknown; problems?: unknown };
        const message = typeof body.error === "string" && body.error.trim() !== ""
            ? body.error
            : "Something went wrong. Try again.";
        const problems = Array.isArray(body.problems) ? (body.problems as CredentialProblem[]) : [];
        throw new AuthError(message, response.status, problems);
    }

    return payload;
}

/** The signed-in account, or `null`. Never throws for "nobody is signed in" — that is the answer. */
export async function fetchSession(): Promise<AccountUser | null> {
    const payload = await authFetch("/auth/session") as { user?: AccountUser | null };
    return payload?.user ?? null;
}

export async function registerAccount(input: {
    username: string;
    password: string;
    email?: string;
}): Promise<AccountUser> {
    const payload = await authFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({
            username: input.username,
            password: input.password,
            // An empty box means "not given", not an empty address.
            ...(input.email && input.email.trim() !== "" ? { email: input.email.trim() } : {}),
        }),
    }) as { user: AccountUser };
    return payload.user;
}

export async function loginAccount(input: {
    username: string;
    password: string;
}): Promise<AccountUser> {
    const payload = await authFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
    }) as { user: AccountUser };
    return payload.user;
}

export async function logoutAccount(): Promise<void> {
    await authFetch("/auth/logout", { method: "POST" });
}
