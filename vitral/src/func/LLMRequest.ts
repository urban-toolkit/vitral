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