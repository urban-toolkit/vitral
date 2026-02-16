export type cardType = 'technical' | 'social';
export type cardLabel = 'person' | 'activity' | 'requirement' | 'concept' | 'insight';

export type fileExtension = 'txt' | 'png' | 'jpg' | 'jpeg' | 'json' | 'csv' | 'ipynb' | 'py' | 'js' | 'ts' | 'html' | 'css' | 'md';

export type cardData = {
    label: string,
    type: cardType,
    title: string,
    attachmentIds?: string[];
    description?: string;
}

export type llmCardData = {
    id: number,
    entity: string,
    title: string,
    description?: string
}

export type llmConnectionData = {
    source: number,
    target: number
}

// Frontend file record
export type filePendingUpload = {
    id: string;            
    name: string;
    ext: fileExtension;
    sizeBytes: number;
    mimeType: string;

    file: File;               

    previewText?: string;
};

// Backend file record
export type fileRecord = {
    id: string;
    docId: string;
    name: string;
    ext: fileExtension;
    sizeBytes: number;
    mimeType: string;
    createdAt: string; // ISO string

    sha256?: string;

    // Minio info
    storage?: { bucket: string; key: string };
};

export type nodeType = {
    id: string, // n123 or 123
    position: { x: number, y: number },
    type: string,
    data: cardData
}

export type edgeType = {
    id: string,
    source: string,
    target: string
}

export type GitHubEventType =
    | "commit"
    | "issue_opened"
    | "issue_closed"
    | "pr_opened"
    | "pr_closed"
    | "pr_merged";

export interface GitHubEvent {
    id: string;
    type: GitHubEventType;
    key: string;

    occurredAt: string; // ISO timestamp

    actor: string | null;
    title: string | null;
    url: string | null;

    issueNumber: number | null;
    prNumber: number | null;
    commitSha: string | null;
    branch: string | null;

    payload: any;
}

export type LaneType = "codebase" | "knowledge" | "designStudy";

export type Stage = {
    id: string;
    name: string;
    start: Date | string;
    end: Date | string;
};