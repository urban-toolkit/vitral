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

function getCommitFilesFromPayload(payload: any): string[] {
    if (!payload) return [];

    if (Array.isArray(payload.filesAffected)) {
        return payload.filesAffected.filter((f: any) => typeof f === "string");
    }

    if (!Array.isArray(payload.files)) return [];

    const files = payload.files
        .map((file: any) => file?.filename)
        .filter((name: any) => typeof name === "string");

    return Array.from(new Set(files));
}

function githubHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Vitral (Dev)",
        "X-GitHub-Api-Version": "2022-11-28",
    };
}

async function ghFetchPage<T extends any[]>(
    request: any,
    url: string,
    token: string
): Promise<{ items: T; nextUrl: string | null }> {
    const res = await fetch(url, {
        headers: githubHeaders(token),
    });

    const text = await res.text();

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

async function ghFetchCommitWithAllFiles(
    request: any,
    owner: string,
    repo: string,
    commitSha: string,
    token: string
): Promise<{files: string[]}> {
    const baseUrl =
        `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(commitSha)}`;

    let pageUrl: string | null = `${baseUrl}?per_page=100&page=1`;
    const allFiles: string[] = [];

    while (pageUrl) {
        const res = await fetch(pageUrl, {
            headers: githubHeaders(token),
        });

        const text = await res.text();

        if (!res.ok) {
            request.log.error(
                { status: res.status, text, url: pageUrl, commitSha },
                "GitHub commit details API failed"
            );
            throw Object.assign(new Error("GitHub commit details API failed"), {
                status: res.status,
                text,
            });
        }

        const pagePayload = JSON.parse(text) as any;

        if (Array.isArray(pagePayload?.files)) {

            let cleanedFiles = pagePayload.files.map((file: any) => {
                return file.filename;
            });

            allFiles.push(...cleanedFiles);
        }

        pageUrl = parseNextLink(res.headers.get("link"));
    }

    let allFilesSet = new Set(allFiles);
    let dedupedFiles = [...allFilesSet];

    return {files: dedupedFiles};
}

async function mapWithConcurrency<T, U>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<U>
): Promise<U[]> {
    if (items.length === 0) return [];

    const results = new Array<U>(items.length);
    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    let nextIndex = 0;

    const worker = async () => {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            if (currentIndex >= items.length) return;

            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
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
        const numericLimit = Number(limit);
        const safeLimit =
            Number.isFinite(numericLimit)
                ? Math.max(1, Math.min(Math.trunc(numericLimit), 10000))
                : 200;

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

        const baseSince = lastSynced ?? undefined;
        const sinceIso = baseSince ? isoWithSafetyWindow(baseSince) : undefined;

        // Fetch from GitHub (commits only, default branch, since cursor)
        const commitsUrl =
            `https://api.github.com/repos/${owner}/${repo}/commits` +
            `?sha=${encodeURIComponent(defaultBranch as string)}` +
            (sinceIso ? `&since=${encodeURIComponent(sinceIso)}` : "") +
            `&per_page=100`;

        let commits: any[] = [];

        try {
            commits = await ghFetchAllPages<any[]>(request, commitsUrl, token, {
                maxPages: 50,
            });
        } catch (e) {
            return reply.status(502).send({ error: `Failed to fetch GitHub events ${(e as any).message}` });
        }

        const normalized: NormalizedEvent[] = [];

        // commits already scoped to sha=defaultBranch
        for (const commit of commits) {
            normalized.push(normalizeCommit(id, owner, repo, defaultBranch as string, commit));
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
              AND event_type = 'commit'
            ORDER BY occurred_at DESC
            LIMIT $2
            `,
            [id, safeLimit]
        );

        const syncedCommitShas = new Set(
            normalized
                .filter((ev) => ev.event_type === "commit" && !!ev.commit_sha)
                .map((ev) => ev.commit_sha as string)
        );

        const enrichedEvents = await mapWithConcurrency(
            events,
            8,
            async (eventRow: GitHubEventRow) => {
                if (eventRow.event_type !== "commit" || !eventRow.commit_sha) return eventRow;

                const hasCompleteFileHydration = eventRow.payload?._vitralFilesComplete === true;

                if (hasCompleteFileHydration) {
                    return eventRow;
                }

                // Avoid N additional API calls for older rows already stored in DB.
                if (!syncedCommitShas.has(eventRow.commit_sha)) {
                    return eventRow;
                }

                try {
                    const filesAffected = await ghFetchCommitWithAllFiles(
                        request,
                        owner,
                        repo,
                        eventRow.commit_sha,
                        token
                    );

                    let augmentedPayload = {
                        ...eventRow.payload,
                        filesAffected: filesAffected.files,
                        _vitralFilesComplete: true,
                    };

                    await app.pg.query(
                        `UPDATE document_github_events SET payload = $1 WHERE id = $2`,
                        [augmentedPayload, eventRow.id]
                    );

                    return { ...eventRow, payload: augmentedPayload };
                } catch (error) {
                    request.log.warn(
                        { sha: eventRow.commit_sha, err: (error as any)?.message },
                        "Failed to enrich commit payload with files"
                    );
                    return eventRow;
                }
            }
        );

        return enrichedEvents.map((e: GitHubEventRow) => ({
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
            filesAffected: getCommitFilesFromPayload(e.payload),
            payload: e.payload,
        }));
    });
}
