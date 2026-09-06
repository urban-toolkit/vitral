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
 * The origin a *citation* should point at, which is not always the one it was exported from.
 *
 * A link printed in a paper outlives the session that generated it. `window.location.origin` — what
 * the markdown report uses, correctly, for a link a reader follows in the same breath — silently
 * writes `http://localhost:5173` into every reference when the file is exported from a dev server,
 * and a `.tex` file is not read again until someone clicks it a year later.
 *
 * So the deployment names itself, and the fallback stays honest rather than clever: with nothing
 * configured this is exactly `window.location.origin`, and the generated file prints whichever was
 * used at the top of itself, so a localhost export is obvious on sight instead of at review time.
 */
export function resolveCitationOrigin(): string {
    const configured = String(import.meta.env.VITE_PUBLIC_ORIGIN ?? "").trim();
    if (configured !== "") return configured.replace(/\/+$/, "");
    return window.location.origin;
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
