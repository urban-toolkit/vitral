export type cardType = 'technical' | 'social';
export type cardLabel = 'person' | 'event' | 'requirement' | 'concept' | 'prompt';

export type cardData = {
    label: string, 
    type: cardType,
    title: string,
    description: string
}