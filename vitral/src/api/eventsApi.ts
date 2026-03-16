import type { GitHubEvent } from "@/config/types";
import { resolveApiBaseUrl } from "@/api/baseUrl";

const API_BASE = resolveApiBaseUrl();

export async function getGitHubEvents(
    projectId: string,
    options?: {
        limit?: number;
    }
): Promise<GitHubEvent[]> {
    const params = new URLSearchParams();

    if (options?.limit != null) {
        params.set("limit", String(options.limit));
    }

    const url =
        `${API_BASE}/state/${projectId}/github/events` +
        (params.toString() ? `?${params.toString()}` : "");

    const res = await fetch(url, {
        method: "GET",
        credentials: "include",
    });

    if (res.status === 401) {
        throw new Error("Not authenticated with GitHub");
    }

    if (res.status === 404) {
        throw new Error("Document or repository not found");
    }

    if (res.status === 400) {
        const text = await res.text();
        throw new Error(`GitHub repo not linked (${text})`);
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to load GitHub events (${res.status}): ${text}`);
    }

    return res.json();
}
