import {
    brotliCompressSync,
    brotliDecompressSync,
    constants as zlibConstants,
    createBrotliCompress,
    gunzipSync,
    type BrotliCompress,
} from "node:zlib";

export const PROJECT_VI_MAGIC = Buffer.from("VITRALVI", "ascii");

/**
 * The byte after the magic names the *container* codec, not the bundle schema.
 *
 * 1 = gzip, 2 = brotli. The payload inside is the same JSON either way, so the
 * bundle's own `version` field stays at 1; only the wrapper changed. Version 1
 * files still import — see `decodeProjectVi`.
 *
 * Why the change: the bundle is a stream of full state snapshots, one per
 * revision, and consecutive snapshots are near-identical. gzip's window is
 * 32 KB, so it could not see across an ~85 KB revision boundary — it compressed
 * every snapshot in isolation and the redundancy that dominates the file was
 * invisible to it. Measured on a 1204-revision project: the revision section
 * went 106 MB -> 14.2 MB under gzip -1 and 106 MB -> 0.17 MB under brotli with
 * a 16 MB window, taking the whole endpoint from 32.70 MB in ~2.29 s to
 * 18.64 MB in ~1.61 s. (zstd scores the same; brotli is what this Node's type
 * definitions already cover, and it does not raise the engine floor.)
 */
export const PROJECT_VI_FORMAT_VERSION = 2;
const PROJECT_VI_GZIP_VERSION = 1;
const PROJECT_VI_BROTLI_VERSION = 2;

/**
 * Quality 4 of 11. The knee of the curve for this payload: q3 compresses the
 * same bundle to 18.39 MB, q4 to 18.27 MB, q5 to 18.10 MB, and every step up
 * costs ~120 ms. The old gzip level of 1 was picked for speed, and q4 is both
 * smaller *and* faster than it, so there is nothing to trade off.
 */
const DEFAULT_BROTLI_QUALITY = 4;
/**
 * 2^24 = a 16 MB match window, against gzip's 32 KB. This is the whole fix: the
 * window has to span several consecutive snapshots for the cross-revision
 * redundancy to be visible at all. 16 MB holds ~190 revisions of a mid-sized
 * graph, and still several of one whose single snapshot runs to megabytes —
 * which is the case that made large exports slow.
 */
const DEFAULT_BROTLI_WINDOW_LOG = 24;
/**
 * Ceiling on the decoded bundle. Not a new restriction: the decoder finishes by
 * turning the buffer into a string, and V8 caps a string at ~512 MB, so a bundle
 * past this never imported — it died on `toString` with a V8 message instead of
 * a readable one. Stating it here also bounds what a hostile upload can expand
 * to, which matters more for brotli than it did for gzip.
 */
const MAX_DECODED_BYTES = 512 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;

export type ProjectViFileEntry = {
    oldId: string;
    name: string;
    mimeType: string | null;
    ext: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    createdAt: string;
    bytesBase64: string;
};

export type ProjectViEmbeddingEntry = {
    nodeId: string;
    nodeText: string;
    embedding: number[];
};

export type ProjectViGithubEventEntry = {
    repoOwner: string;
    repoName: string;
    eventType: string;
    eventKey: string;
    actorLogin: string | null;
    title: string | null;
    url: string | null;
    occurredAt: string;
    issueNumber: number | null;
    prNumber: number | null;
    commitSha: string | null;
    branchName: string | null;
    payload: unknown;
    insertedAt: string;
};

export type ProjectViRevisionEntry = {
    version: number;
    capturedAt: string;
    state: unknown;
    timeline: unknown;
};

export type ProjectViBundleV1 = {
    format: "vitral-project";
    version: 1;
    exportedAt: string;
    source: {
        documentId: string;
        title: string;
    };
    document: {
        title: string;
        description: string | null;
        state: unknown;
        timeline: unknown;
        version: number;
        createdAt: string;
        updatedAt: string;
    };
    files: ProjectViFileEntry[];
    embeddings: ProjectViEmbeddingEntry[];
    githubEvents: ProjectViGithubEventEntry[];
    revisions: ProjectViRevisionEntry[];
};

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function ensureString(value: unknown, field: string): string {
    if (typeof value === "string" && value.trim() !== "") return value;
    throw new Error(`Invalid .vi payload: ${field} must be a non-empty string`);
}

function normalizeNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    const parsed: number[] = [];
    for (const item of value) {
        const numeric = typeof item === "number" ? item : Number(item);
        if (!Number.isFinite(numeric)) continue;
        parsed.push(numeric);
    }
    return parsed;
}

function normalizeFileEntry(value: unknown, index: number): ProjectViFileEntry {
    if (!isRecord(value)) {
        throw new Error(`Invalid .vi payload: files[${index}] must be an object`);
    }
    return {
        oldId: ensureString(value.oldId, `files[${index}].oldId`),
        name: ensureString(value.name, `files[${index}].name`),
        mimeType: typeof value.mimeType === "string" ? value.mimeType : null,
        ext: typeof value.ext === "string" ? value.ext : null,
        sizeBytes: typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes)
            ? value.sizeBytes
            : null,
        sha256: typeof value.sha256 === "string" ? value.sha256 : null,
        createdAt: typeof value.createdAt === "string" && value.createdAt.trim() !== ""
            ? value.createdAt
            : new Date().toISOString(),
        bytesBase64: ensureString(value.bytesBase64, `files[${index}].bytesBase64`),
    };
}

function normalizeEmbeddingEntry(value: unknown, index: number): ProjectViEmbeddingEntry {
    if (!isRecord(value)) {
        throw new Error(`Invalid .vi payload: embeddings[${index}] must be an object`);
    }
    return {
        nodeId: ensureString(value.nodeId, `embeddings[${index}].nodeId`),
        nodeText: typeof value.nodeText === "string" ? value.nodeText : "",
        embedding: normalizeNumberArray(value.embedding),
    };
}

function normalizeGithubEventEntry(value: unknown, index: number): ProjectViGithubEventEntry {
    if (!isRecord(value)) {
        throw new Error(`Invalid .vi payload: githubEvents[${index}] must be an object`);
    }
    return {
        repoOwner: ensureString(value.repoOwner, `githubEvents[${index}].repoOwner`),
        repoName: ensureString(value.repoName, `githubEvents[${index}].repoName`),
        eventType: ensureString(value.eventType, `githubEvents[${index}].eventType`),
        eventKey: ensureString(value.eventKey, `githubEvents[${index}].eventKey`),
        actorLogin: typeof value.actorLogin === "string" ? value.actorLogin : null,
        title: typeof value.title === "string" ? value.title : null,
        url: typeof value.url === "string" ? value.url : null,
        occurredAt: typeof value.occurredAt === "string" && value.occurredAt.trim() !== ""
            ? value.occurredAt
            : new Date().toISOString(),
        issueNumber: typeof value.issueNumber === "number" && Number.isFinite(value.issueNumber)
            ? value.issueNumber
            : null,
        prNumber: typeof value.prNumber === "number" && Number.isFinite(value.prNumber)
            ? value.prNumber
            : null,
        commitSha: typeof value.commitSha === "string" ? value.commitSha : null,
        branchName: typeof value.branchName === "string" ? value.branchName : null,
        payload: value.payload ?? {},
        insertedAt: typeof value.insertedAt === "string" && value.insertedAt.trim() !== ""
            ? value.insertedAt
            : new Date().toISOString(),
    };
}

function normalizeRevisionEntry(value: unknown, index: number): ProjectViRevisionEntry {
    if (!isRecord(value)) {
        throw new Error(`Invalid .vi payload: revisions[${index}] must be an object`);
    }
    const parsedVersion = typeof value.version === "number" ? value.version : Number(value.version);
    return {
        version: Number.isFinite(parsedVersion) ? Math.max(1, Math.trunc(parsedVersion)) : 1,
        capturedAt: typeof value.capturedAt === "string" && value.capturedAt.trim() !== ""
            ? value.capturedAt
            : new Date().toISOString(),
        state: value.state ?? {},
        timeline: value.timeline ?? {},
    };
}

function envInt(name: string, fallback: number, min: number, max: number): number {
    const raw = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(raw)));
}

export function resolveProjectViQuality(): number {
    return envInt("VI_BROTLI_QUALITY", DEFAULT_BROTLI_QUALITY, 0, 11);
}

export function resolveProjectViWindowLog(): number {
    return envInt("VI_BROTLI_WINDOW_LOG", DEFAULT_BROTLI_WINDOW_LOG, 10, 24);
}

function projectViCompressParams(sizeHint?: number): Record<number, number> {
    const params: Record<number, number> = {
        [zlibConstants.BROTLI_PARAM_QUALITY]: resolveProjectViQuality(),
        [zlibConstants.BROTLI_PARAM_LGWIN]: resolveProjectViWindowLog(),
        // The bundle is JSON and base64 all the way down, never raw binary.
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
    };
    if (typeof sizeHint === "number" && sizeHint > 0) {
        params[zlibConstants.BROTLI_PARAM_SIZE_HINT] = sizeHint;
    }
    return params;
}

/**
 * The compressor the streaming export writes through, so the route never has to
 * restate the codec parameters that `decodeProjectVi` has to agree with.
 */
export function createProjectViCompressStream(): BrotliCompress {
    return createBrotliCompress({ params: projectViCompressParams() });
}

export function createProjectViHeader(): Buffer {
    const header = Buffer.alloc(PROJECT_VI_MAGIC.length + 1);
    PROJECT_VI_MAGIC.copy(header, 0);
    header.writeUInt8(PROJECT_VI_FORMAT_VERSION, PROJECT_VI_MAGIC.length);
    return header;
}

export function encodeProjectVi(bundle: ProjectViBundleV1): Buffer {
    const jsonBytes = Buffer.from(JSON.stringify(bundle), "utf8");
    const compressed = brotliCompressSync(jsonBytes, {
        params: projectViCompressParams(jsonBytes.length),
    });
    const header = createProjectViHeader();
    return Buffer.concat([header, compressed]);
}

export function decodeProjectVi(bytes: Buffer): ProjectViBundleV1 {
    if (!Buffer.isBuffer(bytes) || bytes.length <= PROJECT_VI_MAGIC.length + 1) {
        throw new Error("Invalid .vi payload: file is empty or too short");
    }

    const magic = bytes.subarray(0, PROJECT_VI_MAGIC.length);
    if (!magic.equals(PROJECT_VI_MAGIC)) {
        throw new Error("Invalid .vi file signature");
    }

    const version = bytes.readUInt8(PROJECT_VI_MAGIC.length);
    if (version !== PROJECT_VI_GZIP_VERSION && version !== PROJECT_VI_BROTLI_VERSION) {
        throw new Error(`Unsupported .vi format version: ${version}`);
    }

    let parsed: unknown;
    try {
        const payload = bytes.subarray(PROJECT_VI_MAGIC.length + 1);
        // Every bundle exported before the codec swap is a version-1 gzip frame and
        // must keep importing; only the version byte tells the two apart.
        const decompressed = version === PROJECT_VI_GZIP_VERSION
            ? gunzipSync(payload, { maxOutputLength: MAX_DECODED_BYTES })
            : brotliDecompressSync(payload, { maxOutputLength: MAX_DECODED_BYTES });
        parsed = JSON.parse(decompressed.toString("utf8"));
    } catch {
        throw new Error("Invalid .vi payload: unable to decode project data");
    }

    if (!isRecord(parsed)) {
        throw new Error("Invalid .vi payload: root must be an object");
    }

    const format = ensureString(parsed.format, "format");
    if (format !== "vitral-project") {
        throw new Error(`Invalid .vi payload: unexpected format "${format}"`);
    }

    const parsedVersion = typeof parsed.version === "number" ? parsed.version : Number(parsed.version);
    if (parsedVersion !== 1) {
        throw new Error(`Invalid .vi payload: unsupported payload version "${parsed.version}"`);
    }

    if (!isRecord(parsed.source)) {
        throw new Error("Invalid .vi payload: source section is missing");
    }
    if (!isRecord(parsed.document)) {
        throw new Error("Invalid .vi payload: document section is missing");
    }

    const filesRaw = Array.isArray(parsed.files) ? parsed.files : [];
    const embeddingsRaw = Array.isArray(parsed.embeddings) ? parsed.embeddings : [];
    const githubEventsRaw = Array.isArray(parsed.githubEvents) ? parsed.githubEvents : [];
    const revisionsRaw = Array.isArray(parsed.revisions) ? parsed.revisions : [];

    return {
        format: "vitral-project",
        version: 1,
        exportedAt: typeof parsed.exportedAt === "string" && parsed.exportedAt.trim() !== ""
            ? parsed.exportedAt
            : new Date().toISOString(),
        source: {
            documentId: ensureString(parsed.source.documentId, "source.documentId"),
            title: typeof parsed.source.title === "string" && parsed.source.title.trim() !== ""
                ? parsed.source.title
                : "Untitled",
        },
        document: {
            title: typeof parsed.document.title === "string" && parsed.document.title.trim() !== ""
                ? parsed.document.title
                : "Untitled",
            description: typeof parsed.document.description === "string"
                ? parsed.document.description
                : null,
            state: parsed.document.state,
            timeline: parsed.document.timeline,
            version: typeof parsed.document.version === "number" && Number.isFinite(parsed.document.version)
                ? parsed.document.version
                : 1,
            createdAt: typeof parsed.document.createdAt === "string" && parsed.document.createdAt.trim() !== ""
                ? parsed.document.createdAt
                : new Date().toISOString(),
            updatedAt: typeof parsed.document.updatedAt === "string" && parsed.document.updatedAt.trim() !== ""
                ? parsed.document.updatedAt
                : new Date().toISOString(),
        },
        files: filesRaw.map((entry, index) => normalizeFileEntry(entry, index)),
        embeddings: embeddingsRaw.map((entry, index) => normalizeEmbeddingEntry(entry, index)),
        githubEvents: githubEventsRaw.map((entry, index) => normalizeGithubEventEntry(entry, index)),
        revisions: revisionsRaw.map((entry, index) => normalizeRevisionEntry(entry, index)),
    };
}
