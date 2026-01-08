export type cardType = 'technical' | 'social';
export type cardLabel = 'person' | 'event' | 'requirement' | 'concept' | 'prompt';

export type cardData = {
    label: string, 
    type: cardType,
    title: string,
    description: string
}

export type fileType = 'txt' | 'png' | 'jpg' | 'jpeg' | 'json' | 'csv' | 'ipynb' | 'py' | 'js' | 'ts' | 'html' | 'css' | 'md';

export type fileData = {
    name: string,
    type: fileType,
    content: string,
    lastModified: Date,
}