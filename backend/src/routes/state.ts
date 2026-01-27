import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";

type SaveBody = {
    title?: string;
    description?: string | null;
    state: unknown;
};

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export const stateRoutes: FastifyPluginAsync = async (app) => {
    /**
     * Create a new document
     * POST /api/state
     */
    app.post("/state", async (request, reply) => {
        const body = request.body as SaveBody;

        if (!body || typeof body !== "object" || body.state === undefined) {
            return reply.status(400).send({ error: "Missing state" });
        }

        const title = (body.title && body.title.trim()) || "Untitled";
        const description = body.description ?? null;

        const { rows } = await app.pg.query(
            `
            INSERT INTO documents (title, description, state)
            VALUES ($1, $2, $3::jsonb)
            RETURNING id, title, description, version, updated_at
            `,
            [title, description, JSON.stringify(body.state)]
        );

        return reply.status(201).send(rows[0]);
    });

    /**
     * Load a document by id
     * GET /api/state/:id
     */
    app.get("/state/:id", async (request, reply) => {
        const { id } = request.params as { id: string };

        const { rows } = await app.pg.query(
            `
            SELECT id, title, description, state, version, updated_at
            FROM documents
            WHERE id = $1
            `,
            [id]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return rows[0];
    });

    /**
     * Load all documents
     * GET /api/state/
     */
    app.get("/state", async (request, reply) => {
        const { rows } = await app.pg.query(
            `
            SELECT id, title, description, version, updated_at
            FROM documents
            `
        );

        return rows;
    });


    /**
     * Delete a document by id
     * DELETE /api/state/:id
     */
    app.delete("/state/:id", async (request, reply) => {
        const { id } = request.params as { id: string };

        const result = await app.pg.query(
            `
            DELETE FROM documents
            WHERE id = $1
            RETURNING id
            `,
            [id]
        );

        if (result.rowCount === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return reply.status(204).send();
    });



    /**
     * Save (overwrite) a document by id (ideal for updating nodes and edges)
     * PUT /api/state/:id
     *
     * This is an UPSERT:
     * - if exists: update state (+ bump version)
     * - if not: create it with that id
     */
    app.put("/state/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as SaveBody;

        if (!body || typeof body !== "object" || body.state === undefined) {
            return reply.status(400).send({ error: "Missing state" });
        }

        const title = body.title?.trim() ?? null;
        const description = body.description ?? null;

        const { rows } = await app.pg.query(
            `
            INSERT INTO documents (id, title, description, state, version)
            VALUES (
                $1,
                COALESCE($2, 'Untitled'),
                $3,
                $4::jsonb,
                1
            )
            ON CONFLICT (id) DO UPDATE
            SET
                title = COALESCE(EXCLUDED.title, documents.title),
                description = COALESCE(EXCLUDED.description, documents.description),
                state = EXCLUDED.state,
                version = documents.version + 1
            RETURNING id, title, description, version, updated_at
            `,
            [id, title, description, JSON.stringify(body.state)]
        );

        return reply.status(200).send(rows[0]);
    });


    /**
     * Update document metadata
     * PATCH /api/state/:id
     */
    app.patch("/state/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as { title?: string; description?: string | null };

        const title = body.title?.trim();
        const description =
            body.description === undefined ? undefined : body.description;

        if (title === undefined && description === undefined) {
            return reply.status(400).send({ error: "Nothing to update" });
        }

        const { rows } = await app.pg.query(
            `
            UPDATE documents
            SET
            title = COALESCE($2, title),
            description = COALESCE($3, description),
            version = version + 1
            WHERE id = $1
            RETURNING id, title, description, version, updated_at
            `,
            [id, title ?? null, description ?? null]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return rows[0];
    });

    /**
     * Link Github repo to document
     * POST /api/state/:id/github/link
     */
    app.post("/state/:id/github/link", async (request, reply) => {
        const { id } = request.params as { id: string };
        const { owner, repo } = request.body as { owner?: string; repo?: string };

        if (!owner || !repo) {
            return reply.status(400).send({ error: "Missing owner or repo" });
        }

        // Validate repo access via GitHub API using user's OAuth token
        const ghToken = request.cookies["gh_access_token"];
        if (!ghToken) {
            return reply.status(401).send({ error: "Not connected to GitHub" });
        }

        // Verify repo exists & user has access
        const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: {
                Authorization: `Bearer ${ghToken}`,
                Accept: "application/vnd.github+json",
            },
        });

        if (!ghRes.ok) {
            return reply.status(403).send({ error: "Cannot access repository" });
        }

        const ghRepo = await ghRes.json();

        const { rows } = await app.pg.query(
            `
                UPDATE documents
                SET
                github_owner = $2,
                github_repo = $3,
                github_default_branch = $4,
                github_linked_at = now()
                WHERE id = $1
                RETURNING id, github_owner, github_repo, github_default_branch
            `,
            [id, owner, repo, ghRepo.default_branch]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return rows[0];
    });

    /**
     * Get linked repo to document
     * GET /api/state/:id/github
     */
    app.get("/state/:id/github", async (request, reply) => {
        const { id } = request.params as { id: string };

        const { rows } = await app.pg.query(
            `
            SELECT github_owner, github_repo, github_default_branch, github_linked_at
            FROM documents
            WHERE id = $1
            `,
            [id]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        if (!rows[0].github_owner) {
            return reply.status(204).send();
        }

        return rows[0];
    });

    /**
     * Remove link between document and github
     * DELETE /api/state/:id/github/link
     */
    app.delete("/state/:id/github/link", async (request, reply) => {
        const { id } = request.params as { id: string };

        const { rowCount } = await app.pg.query(
            `
            UPDATE documents
            SET
            github_owner = NULL,
            github_repo = NULL,
            github_default_branch = NULL,
            github_linked_at = NULL
            WHERE id = $1
            `,
            [id]
        );

        if (rowCount === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return reply.status(204).send();
    });

    /**
     * Get repo contents
     * GET /:id/github/contents
     */
    app.get("/state/:id/github/contents", async (request, reply) => {
        const { id } = request.params as { id: string };
        const { path = "" } = request.query as { path?: string };

        const token = request.cookies["gh_access_token"];
        if (!token) {
            return reply.status(401).send({ error: "Not connected to GitHub" });
        }

        // Get linked repo from DB
        const { rows } = await app.pg.query(
            `
            SELECT github_owner, github_repo
            FROM documents
            WHERE id = $1
            `,
            [id]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const { github_owner: owner, github_repo: repo } = rows[0];

        if (!owner || !repo) {
            return reply.status(400).send({ error: "No GitHub repo linked to document" });
        }

        // Build GitHub API URL
        const safePath = path
            ? "/" + encodeURIComponent(path).replace(/%2F/g, "/")
            : "";

        const url = `https://api.github.com/repos/${owner}/${repo}/contents${safePath}`;

        const ghRes = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        });

        if (!ghRes.ok) {
            const text = await ghRes.text();
            request.log.error(
                { status: ghRes.status, text, owner, repo, path },
                "GitHub contents fetch failed"
            );

            if (ghRes.status === 404) {
                return reply.status(404).send({ error: "Path not found in repository" });
            }

            return reply.status(502).send({ error: "Failed to fetch GitHub contents" });
        }

        const data = await ghRes.json();

        // GitHub returns:
        // - array for directories
        // - object for single file
        const items = Array.isArray(data) ? data : [data];

        return items.map((item: any) => ({
            name: item.name,
            path: item.path,
            type: item.type, // "file" | "dir"
            size: item.size,
            sha: item.sha,
        }));
    });

    /**
     * Create a new file for a document
     * POST /api/state/:id/files
     */
    app.post("/state/:id/files", async (request, reply) => {
        const { id } = request.params as { id: string };

        const { name, mimeType, sizeBytes, content, contentKind } = request.body as {  name: string; mimeType: string; sizeBytes: number; content: string; contentKind: string };

        // Dedupe key = sha256 of stored content string
        const hash = sha256Hex(content);

        const client = await app.pg.connect();
        try {

            const result = await client.query<{id: string}>(
                `
                INSERT INTO document_files (
                    document_id,
                    name,
                    mime_type,
                    size_bytes,
                    sha256,
                    content_text,
                    created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, now())
                ON CONFLICT (document_id, sha256)
                DO NOTHING
                RETURNING id
                `,
                [
                    id,
                    name,
                    mimeType,
                    sizeBytes,
                    hash,
                    content,
                ]
            );

            const fileId = result.rows[0]?.id;
            if (!fileId) {
                return reply.code(500).send();
            }

            return reply.send({ fileId });
        } finally {
            client.release();
        }
    });

    /**
     * Get files from a documetn
     * GET /api/state/:id/files
     */
    app.get("/state/:id/files", async (request, reply) => {
        const { id } = request.params as { id: string };

        const client = await app.pg.connect();

        try {
            const res = await client.query<{
                id: string;
                name: string;
                mime_type: string | null;
                size_bytes: number | null;
                sha256: string | null;
                created_at: string; 
            }>(
                `
                SELECT
                    id,
                    name,
                    mime_type,
                    size_bytes,
                    sha256,
                    created_at
                FROM document_files
                WHERE document_id = $1
                ORDER BY created_at DESC
                `,
                [id]
            );

            const files = res.rows.map((r: any) => {
                const ext = r.name.includes(".")
                    ? r.name.split(".").pop()?.toLowerCase()
                    : undefined;

                return {
                    id: r.id,
                    name: r.name,
                    mimeType: r.mime_type ?? undefined,
                    ext,
                    sizeBytes: r.size_bytes ?? undefined,
                    sha256: r.sha256 ?? undefined,
                    createdAt: new Date(r.created_at).toISOString(),
                };
            });

            return reply.send({ files });
        } finally {
            client.release();
        }
    });
};