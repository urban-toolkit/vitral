export type cardType = 'technical' | 'social';
export type cardLabel = 'person' | 'activity' | 'requirement' | 'concept' | 'insight';

export type cardData = {
    label: string,
    type: cardType,
    title: string,
    description?: string
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
    ext: string,
    sizeBytes: number,
    mimeType: string,
    content: string,
    contentKind: "text" | "base64",
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

export type FileEntity = {
  id: string;
  documentId: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  // optional: contentText only when loaded/opened
  contentText?: string;
};