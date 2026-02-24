import { FastifyPluginAsync } from "fastify";
import OpenAI from "openai";
import { loadPrompt } from "../prompts/loadPrompt.ts";
import FormData from "form-data";
import fetch from "node-fetch";
import { Buffer } from "node:buffer";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});


export const llmRoutes: FastifyPluginAsync = async (app: any) => {
    app.post("/chat", async (request: any, reply: any) => {
        try {

            const body = request.body as { input: string, prompt?: string };

            if (!body?.input) {
                return reply.status(400).send({ error: "Invalid input" });
            }

            let promptContent = "";

            if (body?.prompt) {
                promptContent = await loadPrompt(body?.prompt);
            } else {
                promptContent = await loadPrompt("CardsFromText");
            }

            let inputContent: any[] = [];

            if (body.prompt === "CardsFromImage" || body.prompt === "CardsFromCode") {
                let parsed: { name?: string; ext?: string; content?: string; images?: { id: string; dataUrl: string }[] } | undefined;
                try {
                    parsed = JSON.parse(body.input);
                } catch {
                    return reply.status(400).send({ error: "Invalid multimodal payload" });
                }

                const textContent = parsed?.content ?? "";
                const images = Array.isArray(parsed?.images) ? parsed!.images : [];

                inputContent.push({
                    type: "input_text",
                    text: promptContent + (textContent ? "\n" + textContent : ""),
                });

                if (images.length === 0 && parsed?.content && typeof parsed.content === "string" && parsed.content.startsWith("data:")) {
                    inputContent.push({
                        type: "input_image",
                        image_url: parsed.content,
                        detail: "low"
                    });
                } else {
                    for (const img of images) {
                        if (!img?.dataUrl || typeof img.dataUrl !== "string") continue;
                        if (img?.id && typeof img.id === "string") {
                            inputContent.push({
                                type: "input_text",
                                text: `Image ${img.id}:`,
                            });
                        }
                        inputContent.push({
                            type: "input_image",
                            image_url: img.dataUrl,
                            detail: "low"
                        });
                    }
                }
            } else {
                inputContent = [
                    {
                        type: "input_text",
                        text: promptContent + "\n" + body.input,
                    },
                ];
            }

            const response = await client.responses.create({
                model: "gpt-5-nano",
                // model: "gpt-4.1-mini",
                // model: "gpt-5-mini",
                // model: "gpt-5.2",
                input: [
                    {
                        role: "user",
                        content: inputContent,
                    }
                ],
            });

            return { output: response.output_text };
        } catch (err) {
            console.error("OpenAI API error:", err);
            return reply.status(500).send({ error: "LLM request failed" });
        }
    });

};
