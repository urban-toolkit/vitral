/**
 * Where the app is mounted, and how a link into it is spelled.
 *
 * This lives on its own because two callers need the same answer and must never disagree: the router
 * (`App.tsx`) and the builder that prints canvas links into an exported report. The app is served
 * from `/` in dev and `/vitral/` in production (`.env.production` sets `VITE_BASE_PATH`), so a second
 * copy of this logic is exactly how production links break while dev links look fine.
 */

/**
 * The router basename: `"/"` or a leading-slash path with no trailing slash.
 *
 * Reads `import.meta.env.BASE_URL`, which Vite substitutes at build time. Kept out of
 * `canvasLinks` so that module stays runnable under plain node in its test.
 */
export function resolveRouterBasename(): string {
    const baseUrl = String(import.meta.env.BASE_URL ?? "/").trim();
    if (baseUrl === "" || baseUrl === "/") return "/";
    const withoutTrailingSlash = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    return withoutTrailingSlash.startsWith("/") ? withoutTrailingSlash : `/${withoutTrailingSlash}`;
}

/**
 * Whether a stored path may be navigated to.
 *
 * `RequireSession` writes the path it turned away into `Navigate state={{ from }}`, and `LoginPage`
 * sends the reader there once they are through. That makes `state.from` a navigation target, and a
 * navigation target reached from anywhere but our own code is an open-redirect primitive — so it is
 * checked here rather than trusted. `//evil.example` is a protocol-relative URL that a browser reads
 * as a different origin, which is why one leading slash is required and two are refused.
 */
export function isSafeInternalPath(value: unknown): value is string {
    if (typeof value !== "string") return false;
    if (!value.startsWith("/")) return false;
    if (value.startsWith("//")) return false;
    // A backslash is treated as a slash by some browsers when resolving a URL, so `/\evil.example`
    // is the same trick spelled differently.
    if (value.startsWith("/\\")) return false;
    return true;
}
