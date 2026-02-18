import type { llmCardData, nodeType, cardType, llmConnectionData, edgeType, DesignStudyEvent, Stage } from '@/config/types';
import type { filePendingUpload } from '@/config/types';
import { readAsDataURL } from './FileParser';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// async function docLingFileParse(fileData: filePendingUpload) {

// }

export async function requestCardsLLM(fileData: filePendingUpload): Promise<{ cards: { id: number, entity: string, title: string, description?: string }[], connections: { source: number, target: number }[] }> {

    let { name, ext, previewText } = fileData;

    let content = previewText;

    // TODO: deal with other formats like .docx or .pdf

    if (content == undefined && fileData.mimeType.startsWith("image/")) {
        content = await readAsDataURL(fileData.file);
    }

    const userText = JSON.stringify({ name, ext, content });

    const response = await fetch(API_BASE_URL + "/api/llm/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: userText, prompt: "CardsFromFile" }),
    });

    if (!response.ok) {
        alert("Request failed");
        return {
            cards: [],
            connections: []
        }
    }

    const data = await response.json();

    try {
        const parsedData = JSON.parse(data.output);

        return parsedData;
    } catch {
        alert("Request failed");
    }

    return {
        cards: [],
        connections: []
    }
}

export async function requestCardsLLMTextInput(userText: string): Promise<{ cards: { id: number, entity: string, title: string, description?: string }[], connections: { source: number, target: number }[] }> {

    const response = await fetch(API_BASE_URL + "/api/llm/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: userText, prompt: "CardsFromTextInput" }),
    });

    if (!response.ok) {
        alert("Request failed");
        return {
            cards: [],
            connections: []
        }
    }

    const data = await response.json();

    try {
        const parsedData = JSON.parse(data.output);

        return parsedData;
    } catch {
        alert("Request failed");
    }

    return {
        cards: [],
        connections: []
    }
}

// export function getHighestId(nodes: nodeType[]): number {
//     let highestId = 0;

//     try{
//         for(const node of nodes){
//             let id = parseInt(node.id.replaceAll('n', ''));
//             if(id > highestId)
//                 highestId = id;
//         }

//         return highestId;
//     } catch (err) {
//         throw new Error("Could not parse node id.");
//     }
// }

export function llmCardsToNodes(llmCards: llmCardData[], offset?: { x: number, y: number }): { nodes: nodeType[], idMap: { [old: string]: string } } {
    // let id = getHighestId(nodes) + 1;

    let positionX = 0;
    let positionY = 0;

    if (offset) {
        positionX = offset.x;
        positionY = offset.y;
    }

    let resultingNodes: nodeType[] = [];

    let idMapping: { [old: string]: string } = {};

    for (const card of llmCards) {

        let cardType = 'social';

        switch (card.entity) {
            case 'requirement':
                cardType = 'technical';
                break;
            case 'insight':
                cardType = 'technical';
                break
        }

        let newId = crypto.randomUUID();

        resultingNodes.push({
            id: newId,
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

        positionX += 300;
        idMapping[card.id] = newId;
    }

    return { nodes: resultingNodes, idMap: idMapping };
}

export function llmConnectionsToEdges(llmConnections: llmConnectionData[], idMap: { [old: string]: string }): edgeType[] {
    let resultingEdges: edgeType[] = []

    try {
        for (const connection of llmConnections) {
            resultingEdges.push({
                id: crypto.randomUUID(),
                source: idMap[connection.source],
                target: idMap[connection.target]
            });
        }
    } catch (err) {
        console.log("Edge generation failed for some connections in: " + llmConnections)
    }

    return resultingEdges;
}

export async function requestMilestonesLLM(milestones: DesignStudyEvent[]): Promise<DesignStudyEvent[]> {
    const contentMilestones = JSON.stringify(milestones);

    const response = await fetch(API_BASE_URL + "/api/llm/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: contentMilestones, prompt: "Milestones" }),
    });

    if (!response.ok) {
        alert("Request failed");
        return []
    }

    const data = await response.json();

    try {
        const parsedData = JSON.parse(data.output);

        let milestones: DesignStudyEvent[] = parsedData.milestones;

        milestones = milestones.map((milestone) => {
            return {
                ...milestone,
                id: crypto.randomUUID()
            }
        });

        return milestones;
    } catch {
        alert("Request failed");
    }

    return [];
}