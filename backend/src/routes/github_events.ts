import type { FastifyPluginAsync } from "fastify";

type GitHubEventRow = {
    id: string;
    document_id: string;

    repo_owner: string;
    repo_name: string;

    event_type: string;
    event_key: string;

    actor_login: string | null;
    title: string | null;
    url: string | null;

    occurred_at: string;

    issue_number: number | null;
    pr_number: number | null;
    commit_sha: string | null;
    branch_name: string | null;

    payload: any;
    inserted_at: string;
};

type NormalizedEvent = Omit<GitHubEventRow, "id" | "inserted_at">;

function isoWithSafetyWindow(dt: Date, safetyMs = 2 * 60 * 1000) {
    return new Date(dt.getTime() - safetyMs).toISOString();
}

function parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) return null;

    const parts = linkHeader.split(",");
    for (const part of parts) {
        const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
        if (m?.[1]) return m[1];
    }
    return null;
}

// async function ghFetchJSON<T>(
//     request: any,
//     url: string,
//     token: string
// ): Promise<T> {
//     const res = await fetch(url, {
//         headers: {
//             Authorization: `Bearer ${token}`,
//             Accept: "application/vnd.github+json",
//             "User-Agent": "Vitral (Dev)"
//         },
//     });

//     if (!res.ok) {
//         const text = await res.text();
//         request.log.error({ status: res.status, text, url }, "GitHub API failed");
//         throw Object.assign(new Error("GitHub API failed"), { status: res.status, text });
//     }

//     return (await res.json()) as T;

// }

async function ghFetchPage<T extends any[]>(
    request: any,
    url: string,
    token: string
): Promise<{ items: T; nextUrl: string | null }> {
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "Vitral (Dev)",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });

    const text = await res.text();

    console.log("url", url);
    console.log("text", text);

    if (!res.ok) {
        request.log.error({ status: res.status, url, text }, "GitHub API failed");
        throw Object.assign(new Error("GitHub API failed"), {
            status: res.status,
            url,
            text,
        });
    }

    const items = JSON.parse(text) as T;
    const nextUrl = parseNextLink(res.headers.get("link"));
    return { items, nextUrl };
}

/**
 * Fetch all pages up to maxPages.
 */
async function ghFetchAllPages<T extends any[]>(
    request: any,
    url: string,
    token: string,
    opts?: {
        maxPages?: number; // safety cap
        stopWhen?: (items: T) => boolean;
    }
): Promise<T> {
    const maxPages = opts?.maxPages ?? 50;

    let all: any[] = [];
    let nUrl: string | null = url;
    let page = 0;

    while (nUrl && page < maxPages) {
        page++;
        const { items, nextUrl }: { items: T; nextUrl: string | null } = await ghFetchPage<T>(request, nUrl, token);
        all.push(...items);

        if (opts?.stopWhen?.(items)) break;

        if (!items || items.length === 0) break;

        nUrl = nextUrl;
    }

    return all as T;
}

// Events: commit
function normalizeCommit(
    documentId: string,
    owner: string,
    repo: string,
    defaultBranch: string,
    c: any
): NormalizedEvent {
    const sha = c.sha as string;

    // commit timestamp: prefer author.date; fall back to committer.date
    const occurredAt =
        c?.commit?.author?.date ??
        c?.commit?.committer?.date ??
        new Date().toISOString();

    return {
        document_id: documentId,
        repo_owner: owner,
        repo_name: repo,

        event_type: "commit",
        event_key: sha,

        actor_login: c?.author?.login ?? null,
        title: c?.commit?.message?.split("\n")[0] ?? null,
        url: c?.html_url ?? null,

        occurred_at: occurredAt,

        issue_number: null,
        pr_number: null,
        commit_sha: sha,
        branch_name: defaultBranch,

        payload: c,
    };
}

// Events: issue_opened, issue_closed, issue_updated
function normalizeIssue(
    documentId: string,
    owner: string,
    repo: string,
    issue: any
): NormalizedEvent[] {
    const number = issue.number as number;
    const base = {
        document_id: documentId,
        repo_owner: owner,
        repo_name: repo,
        actor_login: issue?.user?.login ?? null,
        title: issue?.title ?? null,
        url: issue?.html_url ?? null,
        issue_number: number,
        pr_number: null,
        commit_sha: null,
        branch_name: null,
        payload: issue,
    };

    const events: NormalizedEvent[] = [];

    if (issue.created_at) {
        events.push({
            ...base,
            event_type: "issue_opened",
            event_key: `issue:${number}:opened`,
            occurred_at: issue.created_at,
        });
    }

    if (issue.closed_at) {
        events.push({
            ...base,
            event_type: "issue_closed",
            event_key: `issue:${number}:closed`,
            occurred_at: issue.closed_at,
        });
    }

    return events;
}

/**
 * pr_opened, pr_merged, pr_closed
 */
function normalizePull(
    documentId: string,
    owner: string,
    repo: string,
    defaultBranch: string,
    pr: any
): NormalizedEvent[] {
    const number = pr.number as number;
    const base = {
        document_id: documentId,
        repo_owner: owner,
        repo_name: repo,
        actor_login: pr?.user?.login ?? null,
        title: pr?.title ?? null,
        url: pr?.html_url ?? null,
        issue_number: null,
        pr_number: number,
        commit_sha: null,
        branch_name: defaultBranch,
        payload: pr,
    };

    const events: NormalizedEvent[] = [];

    if (pr.created_at) {
        events.push({
            ...base,
            event_type: "pr_opened",
            event_key: `pr:${number}:opened`,
            occurred_at: pr.created_at,
        });
    }

    if (pr.merged_at) {
        events.push({
            ...base,
            event_type: "pr_merged",
            event_key: `pr:${number}:merged`,
            occurred_at: pr.merged_at,
        });
    } else if (pr.closed_at) {
        events.push({
            ...base,
            event_type: "pr_closed",
            event_key: `pr:${number}:closed`,
            occurred_at: pr.closed_at,
        });
    }

    return events;
}

export const githubEventsRoutes: FastifyPluginAsync = async (app) => {
    /**
     * Sync + return GitHub events for a linked document repo
     * GET /state/:id/github/events
     */
    app.get("/state/:id/github/events", async (request: any, reply: any) => {
        const { id } = request.params as { id: string };
        const {
            limit = 200,
        } = request.query as { limit?: number };

        const token = request.cookies["gh_access_token"];
        if (!token) return reply.status(401).send({ error: "Not connected to GitHub" });

        // Load doc + repo link + cursor
        const { rows } = await app.pg.query(
            `
            SELECT
                id,
                github_owner,
                github_repo,
                github_default_branch,
                github_last_synced_at
            FROM documents
            WHERE id = $1
            `,
            [id]
        );

        if (rows.length === 0) return reply.status(404).send({ error: "Document not found" });

        const doc = rows[0];
        const owner = doc.github_owner as string | null;
        const repo = doc.github_repo as string | null;
        let defaultBranch: string | null = doc.github_default_branch ?? null;


        if (!owner || !repo || !defaultBranch) {
            return reply.status(400).send({ error: "No GitHub repo linked to document" });
        }

        // Compute "since"
        const lastSynced: Date | null = doc.github_last_synced_at
            ? new Date(doc.github_last_synced_at)
            : null;

        // const baseSince = lastSynced ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // default: 7d window
        const baseSince = lastSynced ?? undefined;
        const sinceIso = baseSince ? isoWithSafetyWindow(baseSince) : undefined;

        // Fetch from GitHub (only default branch)
        // Commits on default branch since cursor
        const commitsUrl =
            `https://api.github.com/repos/${owner}/${repo}/commits` +
            `?sha=${encodeURIComponent(defaultBranch as string)}` +
            (sinceIso ? `&since=${encodeURIComponent(sinceIso)}` : "") +
            `&per_page=100`;

        // Issues updated since cursor (includes PRs)
        const issuesUrl =
            `https://api.github.com/repos/${owner}/${repo}/issues` +
            `?state=all` +
            (sinceIso ? `&since=${encodeURIComponent(sinceIso)}` : "") +
            `&per_page=100`;

        // PRs: GitHub doesn't offer "since" on pulls list; filter on client-side by updated_at >= since
        const pullsUrl =
            `https://api.github.com/repos/${owner}/${repo}/pulls` +
            `?state=all&sort=updated&direction=desc&per_page=100`;

        let commits: any[] = [];
        let issues: any[] = [];
        let pulls: any[] = [];

        const sinceMs = sinceIso ? new Date(sinceIso).getTime() : undefined;

        try {
            [commits, issues, pulls] = await Promise.all([
                ghFetchAllPages<any[]>(request, commitsUrl, token, {
                    maxPages: 50, 
                }),

                ghFetchAllPages<any[]>(request, issuesUrl, token, {
                    maxPages: 50,
                }),

                ghFetchAllPages<any[]>(request, pullsUrl, token, {
                    maxPages: 50,
                    stopWhen: (pageItems) => {
                        if (!sinceMs) return false; // first sync: fetch all (up to cap)

                        // If GitHub returns PRs sorted by updated desc, the last item in the page is oldest in that page
                        const last = pageItems[pageItems.length - 1];
                        const lastUpdated = last?.updated_at
                            ? new Date(last.updated_at).getTime()
                            : Infinity;

                        return lastUpdated < sinceMs;
                    },
                }),
            ]);

        } catch (e) {
            return reply.status(502).send({ error: `Failed to fetch GitHub events ${(e as any).message}` });
        }

        const normalized: NormalizedEvent[] = [];

        // commits already scoped to sha=defaultBranch
        for (const c of commits) normalized.push(normalizeCommit(id, owner, repo, defaultBranch as string, c));

        // issues: filter out PR-shaped items
        for (const it of issues) {
            if (it.pull_request) continue;
            normalized.push(...normalizeIssue(id, owner, repo, it));
        }

        // pulls: only PRs whose base is default branch
        for (const pr of pulls) {
            if (pr?.base?.ref !== defaultBranch) continue;
            const updated = pr.updated_at ? new Date(pr.updated_at).getTime() : 0;
            if(sinceMs && updated < sinceMs) continue;
            normalized.push(...normalizePull(id, owner, repo, defaultBranch as string, pr));
        }

        // Upsert into DB in a transaction
        const client = await app.pg.connect();
        try {
            await client.query("BEGIN");

            for (const ev of normalized) {
                await client.query(
                    `
          INSERT INTO document_github_events (
            document_id,
            repo_owner, repo_name,
            event_type, event_key,
            actor_login, title, url,
            occurred_at,
            issue_number, pr_number, commit_sha, branch_name,
            payload
          )
          VALUES (
            $1,
            $2, $3,
            $4, $5,
            $6, $7, $8,
            $9,
            $10, $11,
            $12, $13, $14
          )
          ON CONFLICT (document_id, event_type, event_key)
          DO UPDATE SET
            occurred_at = EXCLUDED.occurred_at,
            actor_login = EXCLUDED.actor_login,
            title = EXCLUDED.title,
            url = EXCLUDED.url,
            issue_number = EXCLUDED.issue_number,
            pr_number = EXCLUDED.pr_number,
            commit_sha = EXCLUDED.commit_sha,
            branch_name = EXCLUDED.branch_name,
            payload = EXCLUDED.payload
          `,
                    [
                        ev.document_id,
                        ev.repo_owner,
                        ev.repo_name,
                        ev.event_type,
                        ev.event_key,
                        ev.actor_login,
                        ev.title,
                        ev.url,
                        ev.occurred_at,
                        ev.issue_number,
                        ev.pr_number,
                        ev.commit_sha,
                        ev.branch_name,
                        ev.payload,
                    ]
                );
            }

            await client.query(
                `
                UPDATE documents
                SET github_last_synced_at = now(), updated_at = now()
                WHERE id = $1
                `,
                [id]
            );

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            request.log.error({ err: e }, "GitHub events upsert failed");
            return reply.status(500).send({ error: "Failed to store GitHub events" });
        } finally {
            client.release();
        }

        // Return timeline (most recent first)
        const { rows: events } = await app.pg.query<GitHubEventRow>(
            `
            SELECT *
            FROM document_github_events
            WHERE document_id = $1
            ORDER BY occurred_at DESC
            LIMIT $2
            `,
            [id, Number(limit)]
        );

        return events.map((e:GitHubEventRow) => ({
            id: e.id,
            type: e.event_type,
            key: e.event_key,
            occurredAt: e.occurred_at,
            actor: e.actor_login,
            title: e.title,
            url: e.url,
            issueNumber: e.issue_number,
            prNumber: e.pr_number,
            commitSha: e.commit_sha,
            branch: e.branch_name,
            payload: e.payload, 
        }));
    });
}
