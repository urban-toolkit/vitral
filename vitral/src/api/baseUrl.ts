function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "");
}

function normalizePathPrefix(value: string): string {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "/") return "";
    const normalized = trimmed.replace(/^\/+|\/+$/g, "");
    return normalized ? `/${normalized}` : "";
}

export function resolveAppBasePath(): string {
    return normalizePathPrefix(String(import.meta.env.BASE_URL ?? "/"));
}

export function resolveApiBaseUrl(): string {
    const configured = import.meta.env.VITE_BACKEND_URL;
    if (typeof configured === "string") {
        return trimTrailingSlash(configured.trim());
    }

    if (import.meta.env.DEV) {
        return "http://localhost:3000";
    }

    return resolveAppBasePath();
}
