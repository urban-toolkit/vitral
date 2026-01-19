export type cardType = 'technical' | 'social';
export type cardLabel = 'person' | 'activity' | 'requirement' | 'concept' | 'insight';

export type cardData = {
    label: string, 
    type: cardType,
    title: string,
    description?: string
}

export type llmCardData = {
    entity: string,
    title: string,
    description?: string 
}

export type fileType = 'txt' | 'png' | 'jpg' | 'jpeg' | 'json' | 'csv' | 'ipynb' | 'py' | 'js' | 'ts' | 'html' | 'css' | 'md';

export type fileData = {
    name: string,
    type: fileType,
    content: string,
    lastModified: Date,
}

export type nodeType = {
    id: string, // n123 or 123
    position: {x: number, y: number}, 
    type: string, 
    data: cardData
}

export type edgeType = {
    id: string,
    source: string,
    target: string
}