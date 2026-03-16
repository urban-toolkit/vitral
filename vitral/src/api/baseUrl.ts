export function normalizePathPrefix(path: string): string {
    if (!path) return "/";
    let normalized = path.trim();
    if (!normalized.startsWith("/")) normalized = `/${normalized}`;
    if (!normalized.endsWith("/")) normalized = `${normalized}/`;
    return normalized.replace(/\/+/g, "/");
}

export function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "");
}

export function resolveAppBasePath(): string {
    return normalizePathPrefix(String(import.meta.env.BASE_URL ?? "/"));
}

export function resolveApiBaseUrl(): string {
    const configured = import.meta.env.VITE_BACKEND_URL;

    if (typeof configured === "string" && configured.trim() !== "") {
        return trimTrailingSlash(configured.trim());
    }

    const appBasePath = resolveAppBasePath();

    if (import.meta.env.NODE_ENV == "development") {
        return "/api";
    }

    // In prod with BASE_URL="/vitral/" this becomes "/vitral/api"
    return trimTrailingSlash(`${appBasePath}api`);
}