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

// export type fileData = {
//     id: string,
//     name: string,
//     ext: fileExtension,
//     sizeBytes: number,
//     mimeType: string,
//     contentBackend: string,
//     created_at: Date,
//     sha256?: string, // for dedupe
//     content?: string, // undefined for binary
//     storage?: { bucket: string, key: string } // if stored in minio
// }

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
    name: string;
    ext: fileExtension;
    sizeBytes: number;
    mimeType: string;
    createdAt: string; // ISO string

    sha256?: string;

    // Where the bytes live
    contentBackend: "postgres" | "minio";

    // Only present when contentBackend === "postgres"
    content?: string;

    // Only present when contentBackend === "minio"
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
