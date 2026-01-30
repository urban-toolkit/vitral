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

export type fileData = {
    id: string,
    name: string,
    ext: fileExtension,
    sizeBytes: number,
    mimeType: string,
    content: string,
    sha256?: string; // for dedupe
}

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
