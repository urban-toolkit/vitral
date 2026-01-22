const API_BASE = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

export type GitHubDocumentResponse = {
    github_owner?: string,
    github_repo?: string,
    github_default_branch?: string,
    github_linked_at?: string
}

export type GitHubRepo = {
    name: string;
    full_name: string;         
    private: boolean;
    owner: { login: string };
    default_branch: string;
    updated_at: string;
};

export async function githubStatus() {
    const res = await fetch(`${API_BASE}/api/auth/github/status`, {
        credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to check GitHub status");
    return res.json() as Promise<
        | { connected: false }
        | { connected: true; user: { id: number; login: string } }
    >;
}

export async function getGithubDocumentLink(docId: string): Promise<GitHubDocumentResponse> {
    const res = await fetch(`${API_BASE}/api/state/${docId}/github`, {
        credentials: "include",
    });

    if (res.status === 204) return {};
    if (!res.ok) {
        throw new Error(`Github information retrieve failed: ${res.status}`);
    }

    return res.json();
}

export async function getGitHubRepos(): Promise<GitHubRepo[]> {
    const res = await fetch(`${API_BASE}/api/auth/github/repos`, {
        credentials: "include",
    });

    if (res.status === 401) return []; // not connected

    if (!res.ok) {
        throw new Error(`Failed to list repos: ${res.status}`);
    }

    return res.json() as Promise<GitHubRepo[]>;
}