import type { llmCardData, nodeType, cardType } from '@/config/types';
import type { fileData } from '@/config/types';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

export async function requestCardsLLM(fileData: fileData): Promise<{cards: {entity: string, title: string, description: string}[]}>{

    const userText = JSON.stringify(fileData);

    const response = await fetch(API_BASE_URL+"/api/llm/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: userText }),
    });

    if (!response.ok) {
        alert("Request failed");
        return {
            cards: []
        }
    }

    const data = await response.json();

    try{
        const parsedData = JSON.parse(data.output);
        

        return parsedData;
    }catch{
        alert("Request failed");
    }

    return {
        cards: []
    }
}

function getHighestId(nodes: nodeType[]): number {
    let highestId = 0;

    try{
        for(const node of nodes){
            let id = parseInt(node.id.replaceAll('n', ''));
            if(id > highestId)
                highestId = id;
        }

        return highestId;
    } catch (err) {
        throw new Error("Could not parse node id.");
    }
}

export function llmCardsToNodes(llmCards: llmCardData[], nodes: nodeType[]): nodeType[] {
    let id = getHighestId(nodes) + 1;

    let positionX = 0;
    let positionY = 0;

    let resultingNodes: nodeType[] = [];

    for(const card of llmCards){

        let cardType = 'social';

        switch (card.entity) {
            case 'requirement':
                cardType = 'technical';
                break;
            case 'insight':
                cardType = 'technical';
                break
        }

        resultingNodes.push({
            id: id.toString(),
            position: {
                x: positionX,
                y: positionY
            },
            type: 'card',
            data: {
                label: card.entity,
                type: cardType as cardType,
                title: card.title,
                description: card.description
            }
        });

        positionX += 100;
        id += 1;
    }

    return resultingNodes;
}