import { resolveApiBaseUrl } from "@/api/baseUrl";
import { apiCredentials } from "@/api/guestMode";

const API_BASE = resolveApiBaseUrl();

export type GitHubDocumentResponse = {
    github_owner?: string,
    github_repo?: string,
    github_default_branch?: string,
    github_linked_at?: string
}

export type GitHubRepo = {
    owner: string;
    repo: string;
    fullName: string;
    private: boolean;
    defaultBranch: string;
    updatedAt: string;
};

export type GitHubContentItem = {
    name: string;
    path: string;
    type: "file" | "dir";
    size?: number;
    sha?: string;
};

export async function githubStatus() {
    const res = await fetch(`${API_BASE}/auth/github/status`, {
        credentials: apiCredentials(),
    });
    if (!res.ok) throw new Error("Failed to check GitHub status");
    return res.json() as Promise<
        | { connected: false }
        | { connected: true; user: { id: number; login: string } }
    >;
}

export async function getGithubDocumentLink(
    docId: string
): Promise<GitHubDocumentResponse> {
    const res = await fetch(`${API_BASE}/state/${docId}/github`, {
        credentials: apiCredentials(),
    });

    if (res.status === 204) return {};
    if (!res.ok) {
        throw new Error(`Github information retrieve failed: ${res.status}`);
    }

    return res.json();
}

export async function getGitHubRepos(): Promise<GitHubRepo[]> {
    const res = await fetch(`${API_BASE}/auth/github/repos`, {
        credentials: apiCredentials(),
    });

    if (res.status === 401) return []; // not connected

    if (!res.ok) {
        throw new Error(`Failed to list repos: ${res.status}`);
    }

    return res.json() as Promise<GitHubRepo[]>;
}

export async function linkRepoToDocument(
    docId: string,
    owner: string,
    repo: string
): Promise<{ id: string, github_owner: string, github_repo: string, github_default_branch: string }> {
    const res = await fetch(`${API_BASE}/state/${docId}/github/link`, {
        method: "POST",
        credentials: apiCredentials(),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo }),
    });

    if (!res.ok) {
        throw new Error(`Link repository failed: ${res.status}`);
    }

    return res.json();
}

export async function getGitHubContents(
    projectId: string,
    path: string = ""
): Promise<GitHubContentItem[]> {
    const url =
        `${API_BASE}/state/${projectId}/github/contents` +
        (path ? `?path=${encodeURIComponent(path)}` : "");

    const res = await fetch(url, {
        method: "GET",
        credentials: apiCredentials(),
    });

    if (res.status === 401) {
        throw new Error("Not authenticated with GitHub");
    }

    if (res.status === 404) {
        throw new Error("Document or repository not found");
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to load GitHub contents (${res.status}): ${text}`);
    }

    return res.json();
}
