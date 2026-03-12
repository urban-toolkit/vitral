import { gunzipSync, gzipSync } from "node:zlib";

const MAGIC = Buffer.from("VITRALVI", "ascii");
const FORMAT_VERSION = 1;

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

export function encodeProjectVi(bundle: ProjectViBundleV1): Buffer {
    const jsonBytes = Buffer.from(JSON.stringify(bundle), "utf8");
    const compressed = gzipSync(jsonBytes);
    const header = Buffer.alloc(MAGIC.length + 1);
    MAGIC.copy(header, 0);
    header.writeUInt8(FORMAT_VERSION, MAGIC.length);
    return Buffer.concat([header, compressed]);
}

export function decodeProjectVi(bytes: Buffer): ProjectViBundleV1 {
    if (!Buffer.isBuffer(bytes) || bytes.length <= MAGIC.length + 1) {
        throw new Error("Invalid .vi payload: file is empty or too short");
    }

    const magic = bytes.subarray(0, MAGIC.length);
    if (!magic.equals(MAGIC)) {
        throw new Error("Invalid .vi file signature");
    }

    const version = bytes.readUInt8(MAGIC.length);
    if (version !== FORMAT_VERSION) {
        throw new Error(`Unsupported .vi format version: ${version}`);
    }

    let parsed: unknown;
    try {
        const decompressed = gunzipSync(bytes.subarray(MAGIC.length + 1));
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
